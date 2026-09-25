-- Fix RLS Policies for Profiles to allow User Registration and Admin Management

-- 1. Ensure RLS is enabled
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Allow users to insert their OWN profile (Registration)
-- Without this, the UserContext code fails to create the profile
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- 3. Allow users to view their OWN profile
-- Without this, users can't load their own data after logging in
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- 4. Allow Admins/Managers to do EVERYTHING (Select, Update, Delete) on ALL profiles
DROP POLICY IF EXISTS "Admins have full control" ON public.profiles;
CREATE POLICY "Admins have full control"
ON public.profiles FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles as p
        WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'manager', 'supervisor', 'jefe')
    )
    -- Bootstrap: Allow usage if the user is the specific super admin email (to prevent lockout if role is missing)
    OR (auth.jwt() ->> 'email' = 'aterraza@3dental.cl')
);

-- Note: We use auth.jwt() ->> 'email' as a failsafe to bootstrap the first admin.
