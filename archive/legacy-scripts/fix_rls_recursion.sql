-- FIX INFINITE RECURSION IN RLS
-- This script replaces the direct table check with a SECURITY DEFINER function
-- preventing the "infinite recursion" error that blocks the Settings page.

-- 1. Create a Secure Function to check roles (Bypasses RLS loop)
CREATE OR REPLACE FUNCTION public.check_user_role()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'supervisor', 'jefe')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; -- SECURITY DEFINER is critical here

-- 2. Update the Policy to use the function
DROP POLICY IF EXISTS "Admins have full control" ON public.profiles;

CREATE POLICY "Admins have full control"
ON public.profiles FOR ALL
TO authenticated
USING (
    -- Now we use the secure function instead of direct SELECT
    public.check_user_role()
    -- Keep the failsafe for your specific email
    OR (auth.jwt() ->> 'email' = 'aterraza@3dental.cl')
);
