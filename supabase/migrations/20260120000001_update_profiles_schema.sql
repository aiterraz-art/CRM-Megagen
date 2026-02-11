-- Add status column with default 'pending'
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'suspended'));

-- Add full_name column
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS full_name text;

-- Ensure super admin is active and has full name
UPDATE profiles 
SET status = 'active', role = 'admin', full_name = 'Super Admin'
WHERE email = 'aterraza@3dental.cl';

-- Policy: Allow admins to view all profiles
CREATE POLICY "Admins can view all profiles" 
ON profiles FOR SELECT 
TO authenticated 
USING (
  auth.uid() IN (
    SELECT id FROM profiles WHERE role = 'admin'
  )
);

-- Policy: Allow admins to update all profiles
CREATE POLICY "Admins can update all profiles" 
ON profiles FOR UPDATE 
TO authenticated 
USING (
  auth.uid() IN (
    SELECT id FROM profiles WHERE role = 'admin'
  )
);
