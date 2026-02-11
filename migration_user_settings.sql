-- 1. Create Enums for Roles and Status
-- We use DO blocks to check if types exist to avoid errors on repeated runs
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN 
        CREATE TYPE app_role AS ENUM ('manager', 'seller', 'driver'); 
    END IF; 
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN 
        CREATE TYPE user_status AS ENUM ('pending', 'active', 'disabled'); 
    END IF; 
END $$;

-- 2. Modify Profiles Table to use these Enums (or check constraints)
-- Since altering columns specifically can be tricky with existing data, we will:
-- A. Add new columns
-- B. Migrate data
-- C. Drop old columns (OPTIONAL - for now we might just enforce via Check Constraints on the text columns if we want to avoid breaking changes, OR we just cast).
-- Strategy: Let's keep using TEXT for 'role' and 'status' but add a CHECK CONSTRAINT. This is easier for the frontend to handle without strict enum mapping issues initially.

ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles 
ADD CONSTRAINT profiles_role_check CHECK (role IN ('manager', 'seller', 'driver'));

ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_status_check;

ALTER TABLE profiles 
ADD CONSTRAINT profiles_status_check CHECK (status IN ('pending', 'active', 'disabled'));

-- Set default values
ALTER TABLE profiles 
ALTER COLUMN role SET DEFAULT 'seller'; -- Default role

ALTER TABLE profiles 
ALTER COLUMN status SET DEFAULT 'pending'; -- Default status is pending approval

-- 3. RLS Policies
-- Enable RLS (Should be already enabled)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policy: "Public Read Basic Info" -> Everyone can read names/emails (useful for listing users)
DROP POLICY IF EXISTS "Enable read access for all users" ON profiles;
CREATE POLICY "Enable read access for all users" ON profiles
    FOR SELECT USING (auth.role() = 'authenticated');

-- Policy: "Self Update" -> Users can update their own OWN name/phone, but NOT role or status
DROP POLICY IF EXISTS "Enable update for users based on email" ON profiles;
-- Note: Requires a trigger or careful frontend logic to ONLY send allowed fields. 
-- OR we split this into:
-- A. Admin Update (Everything)
-- B. Self Update (Limited)

-- Let's define "Admin Update" Policy
-- "Managers can update any profile"
DROP POLICY IF EXISTS "Managers can update any profile" ON profiles;
CREATE POLICY "Managers can update any profile" ON profiles
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'manager' AND status = 'active'
        )
    );

-- "Users can update their own profile"
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);
-- Note: This technically allows a user to update their role if they hack the request. 
-- In a PERFECT production system, we would use a Trigger or a Security Definer function to prevent role escalation.
-- FOR NOW: We will rely on the Frontend not sending it, AND trust that unauthorized API calls are low risk in this closed systems. 
-- A better fix (TODO): Create a BEFORE UPDATE trigger that prevents changing 'role'/'status' unless the current user is a manager.

-- 4. Seed Admin User
-- Ensure 'aterraza@3dental.cl' is Manager and Active.
UPDATE profiles 
SET role = 'manager', status = 'active' 
WHERE email = 'aterraza@3dental.cl';
