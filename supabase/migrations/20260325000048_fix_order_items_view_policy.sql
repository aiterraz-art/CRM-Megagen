DROP POLICY IF EXISTS "View items" ON public.order_items;

CREATE POLICY "View items"
ON public.order_items
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.orders
        WHERE orders.id = order_items.order_id
          AND (
              orders.user_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND lower(coalesce(p.role, '')) = ANY (ARRAY['admin', 'manager', 'jefe', 'facturador'])
              )
          )
    )
);
