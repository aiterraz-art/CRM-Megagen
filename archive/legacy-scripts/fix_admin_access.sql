-- EMERGENCY RESCUE SCRIPT
-- Run this in Supabase SQL Editor to restore access for aterraza@3dental.cl

-- 1. Reset RLS Policies to a clean state
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop all variants of policies we might have created
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins have full control" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;
DROP POLICY IF EXISTS "Managers can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- 2. Re-create Essential Policies
-- Allow Self-Registration
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Allow Self-View
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Allow Admin Full Access (Manager role OR specific email bootstrap)
CREATE POLICY "Admins have full control"
ON public.profiles FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles as p
        WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'manager', 'supervisor', 'jefe')
    )
    OR (auth.jwt() ->> 'email' = 'aterraza@3dental.cl')
);

-- 3. Force-Provision the Admin User
-- This ensures the user exists in 'profiles' and has the correct role, bypasses RLS for this op if run as Service Role (SQL Editor is usually Admin/Postgres role)
INSERT INTO public.profiles (id, email, role, status, full_name, zone)
SELECT 
    id, 
    email, 
    'manager', 
    'active', 
    raw_user_meta_data->>'full_name', 
    'Gerencia'
FROM auth.users
WHERE email = 'aterraza@3dental.cl'
ON CONFLICT (id) DO UPDATE
SET 
    role = 'manager',
    status = 'active',
    email = EXCLUDED.email; -- Refresh email just in case

-- Verify result
SELECT * FROM public.profiles WHERE email = 'aterraza@3dental.cl';
