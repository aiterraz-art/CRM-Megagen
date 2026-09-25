-- FIX RLS ON DELIVERY MODULE
-- Replaces recursive policies with the secure check_user_role() function
-- This ensures Admins/Managers can view "Simulated" data belonging to other drivers

-- 1. Drop existing problematic policies
DROP POLICY IF EXISTS "Managers manage all routes" ON public.delivery_routes;
DROP POLICY IF EXISTS "Managers manage all route items" ON public.route_items;

-- 2. Create new robust policies for ROUTES
CREATE POLICY "Managers manage all routes"
ON public.delivery_routes
FOR ALL
TO authenticated
USING (
    public.check_user_role() = true
);

-- 3. Create new robust policies for ROUTE ITEMS
CREATE POLICY "Managers manage all route items"
ON public.route_items
FOR ALL
TO authenticated
USING (
    public.check_user_role() = true
);

-- Note: Driver policies remain unchanged as they only check auth.uid() which is safe
