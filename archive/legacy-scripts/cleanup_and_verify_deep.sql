-- cleanup_and_verify_deep.sql

-- 1. CLEANUP: Drop ALL extra policies on profiles to avoid conflicts
DROP POLICY IF EXISTS "Staff can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins have full control" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Managers view all profiles" ON public.profiles; -- We will recreate this one clean
DROP POLICY IF EXISTS "Users view own profile or supervisor view all" ON public.profiles;

-- 2. RESTORE: Create the SINGLE "Manager Access" policy (plus self-view)
CREATE POLICY "Managers view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  get_user_role_secure() IN ('manager', 'admin')
);

CREATE POLICY "Users view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (
  id = auth.uid()
);

-- 3. DEBUG: Check Foreign Keys on delivery_routes
-- We need to know if there is more than one FK to profiles
SELECT conname as constraint_name, 
       pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.delivery_routes'::regclass;

-- 4. DEBUG: Simulate the query manually
SELECT COUNT(*) as visible_routes_with_join
FROM delivery_routes dr
JOIN profiles p ON dr.driver_id = p.id;
