DROP POLICY IF EXISTS "Managers all routes" ON public.delivery_routes;
CREATE POLICY "Managers all routes"
ON public.delivery_routes
FOR ALL
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND lower(coalesce(profiles.role, '')) = ANY (
              ARRAY['admin', 'manager', 'jefe', 'facturador', 'tesorero']
          )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND lower(coalesce(profiles.role, '')) = ANY (
              ARRAY['admin', 'manager', 'jefe', 'facturador', 'tesorero']
          )
    )
);

DROP POLICY IF EXISTS "Managers all items" ON public.route_items;
CREATE POLICY "Managers all items"
ON public.route_items
FOR ALL
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND lower(coalesce(profiles.role, '')) = ANY (
              ARRAY['admin', 'manager', 'jefe', 'facturador', 'tesorero']
          )
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND lower(coalesce(profiles.role, '')) = ANY (
              ARRAY['admin', 'manager', 'jefe', 'facturador', 'tesorero']
          )
    )
);
