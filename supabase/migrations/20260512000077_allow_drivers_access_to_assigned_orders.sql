ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers view assigned route orders" ON public.orders;
CREATE POLICY "Drivers view assigned route orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = orders.route_id
          AND r.driver_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Drivers update assigned route orders" ON public.orders;
CREATE POLICY "Drivers update assigned route orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = orders.route_id
          AND r.driver_id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = orders.route_id
          AND r.driver_id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Drivers view assigned route clients" ON public.clients;
CREATE POLICY "Drivers view assigned route clients"
ON public.clients
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.orders o
        JOIN public.delivery_routes r
          ON r.id = o.route_id
        WHERE o.client_id = clients.id
          AND r.driver_id = auth.uid()
    )
);

NOTIFY pgrst, 'reload schema';
