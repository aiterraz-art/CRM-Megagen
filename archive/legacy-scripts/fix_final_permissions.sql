-- fix_final_permissions.sql

-- 1. Create/Replace a secure function to get role (Bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_user_role_secure()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER -- Critical: Runs as owner, ignores RLS
SET search_path = public -- Critical: Prevents search_path hijacking
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

-- 2. Drop ALL existing policies on delivery_routes to clean up mess
DROP POLICY IF EXISTS "Managers can view all routes" ON delivery_routes;
DROP POLICY IF EXISTS "Managers manage all routes" ON delivery_routes;
DROP POLICY IF EXISTS "Drivers view assigned routes" ON delivery_routes;
DROP POLICY IF EXISTS "Drivers update their own route status" ON delivery_routes;
DROP POLICY IF EXISTS "Enable read access for all users" ON delivery_routes;

-- 3. Create CLEAN policies for delivery_routes

-- Policy A: Managers (Admin/Manager) can do EVERYTHING
CREATE POLICY "Managers full access routes"
ON delivery_routes FOR ALL
TO authenticated
USING (
  get_user_role_secure() IN ('manager', 'admin')
);

-- Policy B: Drivers can VIEW assigned routes
CREATE POLICY "Drivers view own routes"
ON delivery_routes FOR SELECT
TO authenticated
USING (
  driver_id = auth.uid()
);

-- Policy C: Drivers can UPDATE status of own routes (if strictly needed, usually handled by API/Functions)
-- Keeping it simple mainly for status updates
CREATE POLICY "Drivers update own routes"
ON delivery_routes FOR UPDATE
TO authenticated
USING (
  driver_id = auth.uid()
);

-- 4. Do the same for route_items just in case
DROP POLICY IF EXISTS "Managers can view all route items" ON route_items;
DROP POLICY IF EXISTS "Managers manage all route items" ON route_items;
DROP POLICY IF EXISTS "Drivers view assigned items" ON route_items;

CREATE POLICY "Managers full access items"
ON route_items FOR ALL
TO authenticated
USING (
  get_user_role_secure() IN ('manager', 'admin')
);

CREATE POLICY "Drivers view own items"
ON route_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM delivery_routes 
    WHERE id = route_items.route_id 
    AND driver_id = auth.uid()
  )
);
