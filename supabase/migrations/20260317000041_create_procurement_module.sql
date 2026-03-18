CREATE TABLE IF NOT EXISTS public.inbound_shipments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_name text NOT NULL,
    origin_country text NOT NULL,
    origin_city text NOT NULL,
    transport_mode text NOT NULL CHECK (transport_mode IN ('air', 'sea')),
    departure_date date,
    eta_date date,
    status text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'arrived_chile', 'received')),
    notes text,
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid REFERENCES public.inventory(id) ON DELETE SET NULL,
    sku_snapshot text NOT NULL,
    product_name_snapshot text NOT NULL,
    current_stock_snapshot integer NOT NULL DEFAULT 0,
    requested_qty integer NOT NULL CHECK (requested_qty > 0),
    reason_type text NOT NULL CHECK (reason_type IN ('low_stock', 'no_stock', 'planned_large_sale', 'other')),
    priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    needed_by_date date,
    request_note text,
    manager_note text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_purchase', 'included', 'closed')),
    linked_shipment_id uuid REFERENCES public.inbound_shipments(id) ON DELETE SET NULL,
    requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.inbound_shipment_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id uuid NOT NULL REFERENCES public.inbound_shipments(id) ON DELETE CASCADE,
    product_id uuid REFERENCES public.inventory(id) ON DELETE SET NULL,
    sku_snapshot text NOT NULL,
    product_name_snapshot text NOT NULL,
    qty integer NOT NULL CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS idx_product_requests_status ON public.product_requests(status);
CREATE INDEX IF NOT EXISTS idx_product_requests_product_id ON public.product_requests(product_id);
CREATE INDEX IF NOT EXISTS idx_product_requests_requester_id ON public.product_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_product_requests_linked_shipment_id ON public.product_requests(linked_shipment_id);
CREATE INDEX IF NOT EXISTS idx_product_requests_needed_by_date ON public.product_requests(needed_by_date);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_status ON public.inbound_shipments(status);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_eta_date ON public.inbound_shipments(eta_date);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_created_by ON public.inbound_shipments(created_by);
CREATE INDEX IF NOT EXISTS idx_inbound_shipment_items_shipment_id ON public.inbound_shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipment_items_product_id ON public.inbound_shipment_items(product_id);

CREATE OR REPLACE FUNCTION public.procurement_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();

    IF TG_TABLE_NAME = 'product_requests' THEN
        IF NEW.status = 'closed' THEN
            NEW.closed_at = COALESCE(NEW.closed_at, now());
        ELSE
            NEW.closed_at = NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_requests_touch_updated_at ON public.product_requests;
CREATE TRIGGER trg_product_requests_touch_updated_at
BEFORE UPDATE ON public.product_requests
FOR EACH ROW
EXECUTE FUNCTION public.procurement_touch_updated_at();

DROP TRIGGER IF EXISTS trg_inbound_shipments_touch_updated_at ON public.inbound_shipments;
CREATE TRIGGER trg_inbound_shipments_touch_updated_at
BEFORE UPDATE ON public.inbound_shipments
FOR EACH ROW
EXECUTE FUNCTION public.procurement_touch_updated_at();

ALTER TABLE public.product_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_shipment_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.product_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_shipments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inbound_shipment_items TO authenticated;

DROP POLICY IF EXISTS "Procurement product requests read" ON public.product_requests;
CREATE POLICY "Procurement product requests read"
ON public.product_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
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
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
    )
);

INSERT INTO public.role_permissions (role, permission)
SELECT v.role, v.permission
FROM (
    VALUES
        ('admin', 'VIEW_PROCUREMENT'),
        ('admin', 'REQUEST_PRODUCTS'),
        ('admin', 'MANAGE_PROCUREMENT'),
        ('jefe', 'VIEW_PROCUREMENT'),
        ('jefe', 'REQUEST_PRODUCTS'),
        ('jefe', 'MANAGE_PROCUREMENT'),
        ('seller', 'VIEW_PROCUREMENT'),
        ('seller', 'REQUEST_PRODUCTS')
) AS v(role, permission)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = v.role
      AND rp.permission = v.permission
);
