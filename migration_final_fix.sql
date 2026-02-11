-- FINAL FIX SCRIPT
-- PROBLEM: The previous scripts failed because existing constraints blocked the data correction updates.
-- SOLUTION: We must DROP the constraints FIRST, then fix the data, then re-apply constraints.

-- 1. DROP CONSTRAINTS FIRST (Crucial Step)
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_status_check;

-- 2. NOW FIX DATA (Safe to run without constraints blocking)
-- Normalize Roles
UPDATE profiles 
SET role = 'manager' 
WHERE role IN ('admin', 'jefe', 'supervisor', 'Admin', 'Manager');

UPDATE profiles 
SET role = 'seller' 
WHERE role IN ('vendedor', 'user', 'seller', 'Vendedor') OR role IS NULL;

UPDATE profiles 
SET role = 'driver' 
WHERE role IN ('chofer', 'repartidor', 'driver', 'Driver');

-- Normalize Status
UPDATE profiles 
SET status = 'active'
WHERE status IS NULL OR status = 'approved' OR status NOT IN ('pending', 'active', 'disabled');

-- Ensure Admin User is Correct
UPDATE profiles 
SET role = 'manager', status = 'active' 
WHERE email = 'aterraza@3dental.cl';

-- 3. RE-CREATE TYPES (Idempotent)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN 
        CREATE TYPE app_role AS ENUM ('manager', 'seller', 'driver'); 
    END IF; 
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN 
        CREATE TYPE user_status AS ENUM ('pending', 'active', 'disabled'); 
    END IF; 
END $$;

-- 4. RE-APPLY CONSTRAINTS (Safe now that data is clean)
ALTER TABLE profiles 
ADD CONSTRAINT profiles_role_check CHECK (role IN ('manager', 'seller', 'driver'));

ALTER TABLE profiles 
ADD CONSTRAINT profiles_status_check CHECK (status IN ('pending', 'active', 'disabled'));

-- Set Defaults
ALTER TABLE profiles 
ALTER COLUMN role SET DEFAULT 'seller'; 

ALTER TABLE profiles 
ALTER COLUMN status SET DEFAULT 'pending';

-- 5. APPLY RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON profiles;
CREATE POLICY "Enable read access for all users" ON profiles
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Managers can update any profile" ON profiles;
CREATE POLICY "Managers can update any profile" ON profiles
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'manager' AND status = 'active'
        )
    );

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);
