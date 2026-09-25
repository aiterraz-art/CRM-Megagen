-- FIX SCRIPT: Data Normalization & Migration
-- This script cleans existing data BEFORE applying strict constraints.

-- 1. Create Enums (Idempotent)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN 
        CREATE TYPE app_role AS ENUM ('manager', 'seller', 'driver'); 
    END IF; 
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN 
        CREATE TYPE user_status AS ENUM ('pending', 'active', 'disabled'); 
    END IF; 
END $$;

-- 2. NORMALIZE DATA (Fixing the "Constraint Violation" error)
-- Check what your current values are and map them to the new whitelist.

-- Map Admins/Supervisors -> 'manager'
UPDATE profiles 
SET role = 'manager' 
WHERE role IN ('admin', 'jefe', 'supervisor', 'Admin', 'Manager');

-- Map Sellers/Users -> 'seller'
UPDATE profiles 
SET role = 'seller' 
WHERE role IN ('vendedor', 'user', 'seller', 'Vendedor') OR role IS NULL;

-- Map Drivers -> 'driver'
UPDATE profiles 
SET role = 'driver' 
WHERE role IN ('chofer', 'repartidor', 'driver', 'Driver');

-- Normalize Defaults for Status
UPDATE profiles 
SET status = 'active'
WHERE status IS NULL OR status = 'approved';

-- 3. APPLY CONSTRAINTS (Now safe to run)
ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles 
ADD CONSTRAINT profiles_role_check CHECK (role IN ('manager', 'seller', 'driver'));

ALTER TABLE profiles 
DROP CONSTRAINT IF EXISTS profiles_status_check;

ALTER TABLE profiles 
ADD CONSTRAINT profiles_status_check CHECK (status IN ('pending', 'active', 'disabled'));

-- Set Defaults
ALTER TABLE profiles 
ALTER COLUMN role SET DEFAULT 'seller'; 

ALTER TABLE profiles 
ALTER COLUMN status SET DEFAULT 'pending';

-- 4. APPLY RLS POLICIES
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

-- 5. ENSURE YOU ARE ADMIN
-- Force update your specific user to ensure you don't lock yourself out
UPDATE profiles 
SET role = 'manager', status = 'active' 
WHERE email = 'aterraza@3dental.cl';
