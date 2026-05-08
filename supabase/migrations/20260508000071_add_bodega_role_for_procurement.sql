INSERT INTO public.role_permissions (role, permission)
SELECT role_name, permission_name
FROM (
    VALUES
        ('bodega', 'UPLOAD_EXCEL'),
        ('bodega', 'MANAGE_INVENTORY'),
        ('bodega', 'MANAGE_PRICING'),
        ('bodega', 'VIEW_PROCUREMENT'),
        ('bodega', 'REQUEST_PRODUCTS'),
        ('bodega', 'MANAGE_PROCUREMENT')
) AS seed(role_name, permission_name)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = seed.role_name
      AND rp.permission = seed.permission_name
);

DROP POLICY IF EXISTS "Procurement product requests read" ON public.product_requests;
CREATE POLICY "Procurement product requests read"
ON public.product_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission IN ('VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'MANAGE_PROCUREMENT')
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement product requests insert" ON public.product_requests;
CREATE POLICY "Procurement product requests insert"
ON public.product_requests
FOR INSERT
TO authenticated
WITH CHECK (
    requester_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'REQUEST_PRODUCTS'
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement product requests requester update" ON public.product_requests;
CREATE POLICY "Procurement product requests requester update"
ON public.product_requests
FOR UPDATE
TO authenticated
USING (
    requester_id = auth.uid()
    AND status = 'pending'
    AND EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'REQUEST_PRODUCTS'
        WHERE p.id = auth.uid()
    )
)
WITH CHECK (
    requester_id = auth.uid()
    AND linked_shipment_id IS NULL
    AND status IN ('pending', 'closed')
);

DROP POLICY IF EXISTS "Procurement product requests manage" ON public.product_requests;
CREATE POLICY "Procurement product requests manage"
ON public.product_requests
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipments read" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments read"
ON public.inbound_shipments
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission IN ('VIEW_PROCUREMENT', 'MANAGE_PROCUREMENT')
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipments manage insert" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments manage insert"
ON public.inbound_shipments
FOR INSERT
TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipments manage update" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments manage update"
ON public.inbound_shipments
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipments manage delete" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments manage delete"
ON public.inbound_shipments
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipment items read" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items read"
ON public.inbound_shipment_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission IN ('VIEW_PROCUREMENT', 'MANAGE_PROCUREMENT')
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipment items manage insert" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items manage insert"
ON public.inbound_shipment_items
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipment items manage update" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items manage update"
ON public.inbound_shipment_items
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
);

DROP POLICY IF EXISTS "Procurement shipment items manage delete" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items manage delete"
ON public.inbound_shipment_items
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_PROCUREMENT'
        WHERE p.id = auth.uid()
    )
);

NOTIFY pgrst, 'reload schema';
