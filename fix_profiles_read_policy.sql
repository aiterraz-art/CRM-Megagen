-- fix_profiles_read_policy.sql

-- 1. Ensure the secure function exists (just in case they missed the previous script)
CREATE OR REPLACE FUNCTION public.get_user_role_secure()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();
  RETURN v_role;
END;
$$;

-- 2. Clean up old profile policies that might be restrictive
DROP POLICY IF EXISTS "Managers view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- 3. Create a clear policy for Managers to see ALL profiles
CREATE POLICY "Managers view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  get_user_role_secure() IN ('manager', 'admin')
);

-- 4. Ensure Users can still see their OWN profile (critical for basic functioning)
-- Check if it exists first, or just create it safely
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (
  id = auth.uid()
);

-- 5. Optional: Allow drivers to see other profiles? 
-- Maybe not needed yet. Keep it strict. Managers + Self only.
