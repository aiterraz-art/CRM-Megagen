-- ensure_manager_view.sql

-- 1. Drop restrict policies if they exist (to clear conflicts)
DROP POLICY IF EXISTS "Managers can view all routes" ON delivery_routes;
DROP POLICY IF EXISTS "Managers can view all route items" ON route_items;

-- 2. Create broader permissive policies for managers using the secure check function
CREATE POLICY "Managers can view all routes"
ON delivery_routes FOR SELECT
TO authenticated
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin')
  OR
  driver_id = auth.uid()
);

CREATE POLICY "Managers can view all route items"
ON route_items FOR SELECT
TO authenticated
USING (
  (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('manager', 'admin')
  OR
  EXISTS (
    SELECT 1 FROM delivery_routes 
    WHERE id = route_items.route_id 
    AND driver_id = auth.uid()
  )
);
