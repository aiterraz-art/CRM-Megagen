-- MIGRATION V3: ADD COLUMNS & FIX DATA
-- This script is "Idempotent" - it checks if things exist before creating them.

-- 1. ADD MISSING COLUMNS (If they don't exist)
DO $$ 
BEGIN 
    -- Add 'role' if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'role') THEN 
        ALTER TABLE profiles ADD COLUMN role TEXT DEFAULT 'seller'; 
    END IF;

    -- Add 'status' if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'status') THEN 
        ALTER TABLE profiles ADD COLUMN status TEXT DEFAULT 'pending'; 
    END IF;
END $$;

-- 2. DROP EXISTING CONSTRAINTS (To allow cleaning)
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_status_check;

-- 3. NORMALIZE DATA (Now that we know columns exist)
-- Map Roles
UPDATE profiles 
SET role = 'manager' 
WHERE role IN ('admin', 'jefe', 'supervisor', 'Admin', 'Manager');

UPDATE profiles 
SET role = 'seller' 
WHERE role IN ('vendedor', 'user', 'seller', 'Vendedor') OR role IS NULL;

UPDATE profiles 
SET role = 'driver' 
WHERE role IN ('chofer', 'repartidor', 'driver', 'Driver');

-- Map Status
UPDATE profiles 
SET status = 'active'
WHERE status IS NULL OR status = 'approved' OR status NOT IN ('pending', 'active', 'disabled');

-- Force Admin
UPDATE profiles 
SET role = 'manager', status = 'active' 
WHERE email = 'aterraza@3dental.cl';

-- 4. CREATE TYPES (Idempotent)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN 
        CREATE TYPE app_role AS ENUM ('manager', 'seller', 'driver'); 
    END IF; 
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN 
        CREATE TYPE user_status AS ENUM ('pending', 'active', 'disabled'); 
    END IF; 
END $$;

-- 5. APPLY STRICT CONSTRAINTS
ALTER TABLE profiles 
ADD CONSTRAINT profiles_role_check CHECK (role IN ('manager', 'seller', 'driver'));

ALTER TABLE profiles 
ADD CONSTRAINT profiles_status_check CHECK (status IN ('pending', 'active', 'disabled'));

-- 6. RLS POLICIES
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
