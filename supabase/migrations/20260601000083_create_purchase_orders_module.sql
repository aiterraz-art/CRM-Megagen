CREATE SEQUENCE IF NOT EXISTS public.purchase_order_folio_seq;

CREATE TABLE IF NOT EXISTS public.suppliers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email text NOT NULL,
    contact_name text,
    phone text,
    tax_id text,
    country text,
    city text,
    address text,
    preferred_currency text CHECK (preferred_currency IN ('CLP', 'USD')),
    notes text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_status ON public.suppliers (status);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers (name);
CREATE INDEX IF NOT EXISTS idx_suppliers_email ON public.suppliers (email);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    folio bigint NOT NULL UNIQUE DEFAULT nextval('public.purchase_order_folio_seq'),
    supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    supplier_name_snapshot text NOT NULL,
    supplier_email_snapshot text NOT NULL,
    currency text NOT NULL CHECK (currency IN ('CLP', 'USD')),
    issued_at timestamptz NOT NULL DEFAULT now(),
    needed_by_date date,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'send_failed', 'cancelled')),
    subtotal numeric NOT NULL DEFAULT 0,
    total_discount numeric NOT NULL DEFAULT 0,
    total_amount numeric NOT NULL DEFAULT 0,
    general_notes text,
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    sent_at timestamptz,
    email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'not_sent')),
    email_error text,
    pdf_storage_path text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_id ON public.purchase_orders (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_by ON public.purchase_orders (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    inventory_id uuid REFERENCES public.inventory(id) ON DELETE SET NULL,
    sku_snapshot text NOT NULL,
    product_name_snapshot text NOT NULL,
    qty integer NOT NULL CHECK (qty > 0),
    unit_price numeric NOT NULL CHECK (unit_price >= 0),
    discount_amount numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    line_notes text,
    line_total numeric NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_purchase_order_id
    ON public.purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_inventory_id
    ON public.purchase_order_items (inventory_id);

CREATE TABLE IF NOT EXISTS public.purchase_order_email_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    triggered_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sender_email text NOT NULL,
    to_recipients text[] NOT NULL DEFAULT '{}',
    status text NOT NULL CHECK (status IN ('sent', 'failed')),
    error_message text,
    gmail_message_id text,
    gmail_thread_id text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_email_logs_po_id
    ON public.purchase_order_email_logs (purchase_order_id, created_at DESC);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_email_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_email_logs TO authenticated;

INSERT INTO public.role_permissions (role, permission)
SELECT v.role, v.permission
FROM (
    VALUES
        ('admin', 'VIEW_PURCHASE_ORDERS'),
        ('admin', 'MANAGE_PURCHASE_ORDERS'),
        ('bodega', 'VIEW_PURCHASE_ORDERS'),
        ('bodega', 'MANAGE_PURCHASE_ORDERS')
) AS v(role, permission)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = v.role
      AND rp.permission = v.permission
);

DO $$
BEGIN
    IF to_regprocedure('public.auth_user_has_permission(text)') IS NULL THEN
        EXECUTE $auth_user_has_permission$
            CREATE FUNCTION public.auth_user_has_permission(p_permission text)
            RETURNS boolean
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public
            AS $fn$
                SELECT EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    JOIN public.role_permissions rp
                      ON rp.role = lower(coalesce(p.role, ''))
                     AND rp.permission = p_permission
                    WHERE p.id = auth.uid()
                );
            $fn$;
        $auth_user_has_permission$;
    END IF;
END;
$$;

DO $$
BEGIN
    IF to_regprocedure('public.auth_user_has_any_role(text[])') IS NULL THEN
        EXECUTE $auth_user_has_any_role$
            CREATE FUNCTION public.auth_user_has_any_role(p_roles text[])
            RETURNS boolean
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = public
            AS $fn$
                SELECT EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND lower(coalesce(p.role, '')) = ANY (p_roles)
                );
            $fn$;
        $auth_user_has_any_role$;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_has_any_role(text[]) TO authenticated;

DROP POLICY IF EXISTS "Suppliers read purchase orders" ON public.suppliers;
CREATE POLICY "Suppliers read purchase orders"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_permission('VIEW_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Suppliers manage purchase orders" ON public.suppliers;
CREATE POLICY "Suppliers manage purchase orders"
ON public.suppliers
FOR ALL
TO authenticated
USING (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
)
WITH CHECK (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase orders read access" ON public.purchase_orders;
CREATE POLICY "Purchase orders read access"
ON public.purchase_orders
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_permission('VIEW_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase orders manage access" ON public.purchase_orders;
CREATE POLICY "Purchase orders manage access"
ON public.purchase_orders
FOR ALL
TO authenticated
USING (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
)
WITH CHECK (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase order items read access" ON public.purchase_order_items;
CREATE POLICY "Purchase order items read access"
ON public.purchase_order_items
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_permission('VIEW_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase order items manage access" ON public.purchase_order_items;
CREATE POLICY "Purchase order items manage access"
ON public.purchase_order_items
FOR ALL
TO authenticated
USING (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
)
WITH CHECK (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase order email logs read access" ON public.purchase_order_email_logs;
CREATE POLICY "Purchase order email logs read access"
ON public.purchase_order_email_logs
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_permission('VIEW_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase order email logs manage access" ON public.purchase_order_email_logs;
CREATE POLICY "Purchase order email logs manage access"
ON public.purchase_order_email_logs
FOR ALL
TO authenticated
USING (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
)
WITH CHECK (
    public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('purchase-order-pdfs', 'purchase-order-pdfs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Purchase order pdfs read" ON storage.objects;
CREATE POLICY "Purchase order pdfs read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'purchase-order-pdfs'
    AND (
        public.auth_user_has_permission('VIEW_PURCHASE_ORDERS')
        OR public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
    )
);

DROP POLICY IF EXISTS "Purchase order pdfs upload" ON storage.objects;
CREATE POLICY "Purchase order pdfs upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'purchase-order-pdfs'
    AND public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase order pdfs update" ON storage.objects;
CREATE POLICY "Purchase order pdfs update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'purchase-order-pdfs'
    AND public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
)
WITH CHECK (
    bucket_id = 'purchase-order-pdfs'
    AND public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

DROP POLICY IF EXISTS "Purchase order pdfs delete" ON storage.objects;
CREATE POLICY "Purchase order pdfs delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'purchase-order-pdfs'
    AND public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
);

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_supplier_id uuid;
    v_supplier public.suppliers%ROWTYPE;
    v_order_id uuid;
    v_folio bigint;
    v_currency text;
    v_needed_by_date date;
    v_general_notes text;
    v_lines jsonb;
    v_line jsonb;
    v_inventory public.inventory%ROWTYPE;
    v_qty integer;
    v_unit_price numeric;
    v_discount numeric;
    v_line_notes text;
    v_line_total numeric;
    v_subtotal numeric := 0;
    v_total_discount numeric := 0;
    v_total_amount numeric := 0;
    v_sku text;
    v_name text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS') THEN
        RAISE EXCEPTION 'No tienes permisos para crear órdenes de compra';
    END IF;

    v_supplier_id := NULLIF(trim(COALESCE(p_payload->>'supplierId', '')), '')::uuid;
    v_currency := upper(trim(COALESCE(p_payload->>'currency', '')));
    v_needed_by_date := NULLIF(trim(COALESCE(p_payload->>'neededByDate', '')), '')::date;
    v_general_notes := NULLIF(trim(COALESCE(p_payload->>'generalNotes', '')), '');
    v_lines := COALESCE(p_payload->'lines', '[]'::jsonb);

    IF v_supplier_id IS NULL THEN
        RAISE EXCEPTION 'Proveedor obligatorio';
    END IF;

    IF v_currency NOT IN ('CLP', 'USD') THEN
        RAISE EXCEPTION 'Moneda inválida';
    END IF;

    IF jsonb_typeof(v_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(v_lines) = 0 THEN
        RAISE EXCEPTION 'Debes agregar al menos un producto';
    END IF;

    SELECT *
    INTO v_supplier
    FROM public.suppliers
    WHERE id = v_supplier_id
      AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Proveedor no encontrado o inactivo';
    END IF;

    IF NULLIF(trim(v_supplier.email), '') IS NULL THEN
        RAISE EXCEPTION 'El proveedor no tiene correo principal configurado';
    END IF;

    INSERT INTO public.purchase_orders (
        supplier_id,
        supplier_name_snapshot,
        supplier_email_snapshot,
        currency,
        needed_by_date,
        general_notes,
        created_by
    )
    VALUES (
        v_supplier.id,
        v_supplier.name,
        lower(trim(v_supplier.email)),
        v_currency,
        v_needed_by_date,
        v_general_notes,
        v_actor_id
    )
    RETURNING id, folio
    INTO v_order_id, v_folio;

    FOR v_line IN
        SELECT value
        FROM jsonb_array_elements(v_lines)
    LOOP
        IF NULLIF(trim(COALESCE(v_line->>'inventoryId', '')), '') IS NULL THEN
            RAISE EXCEPTION 'Cada línea debe tener un producto de inventario';
        END IF;

        SELECT *
        INTO v_inventory
        FROM public.inventory
        WHERE id = (v_line->>'inventoryId')::uuid;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Producto de inventario no encontrado';
        END IF;

        v_qty := GREATEST(0, COALESCE((v_line->>'qty')::integer, 0));
        v_unit_price := COALESCE((v_line->>'unitPrice')::numeric, v_inventory.price, 0);
        v_discount := GREATEST(0, COALESCE((v_line->>'discountAmount')::numeric, 0));
        v_line_notes := NULLIF(trim(COALESCE(v_line->>'lineNotes', '')), '');

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
        END IF;

        IF v_unit_price < 0 THEN
            RAISE EXCEPTION 'El precio unitario no puede ser negativo';
        END IF;

        IF v_discount > (v_qty * v_unit_price) THEN
            RAISE EXCEPTION 'El descuento no puede superar el total de la línea';
        END IF;

        v_sku := COALESCE(NULLIF(trim(v_inventory.sku), ''), 'SIN-SKU');
        v_name := trim(v_inventory.name);
        v_line_total := (v_qty * v_unit_price) - v_discount;

        INSERT INTO public.purchase_order_items (
            purchase_order_id,
            inventory_id,
            sku_snapshot,
            product_name_snapshot,
            qty,
            unit_price,
            discount_amount,
            line_notes,
            line_total
        )
        VALUES (
            v_order_id,
            v_inventory.id,
            v_sku,
            v_name,
            v_qty,
            v_unit_price,
            v_discount,
            v_line_notes,
            v_line_total
        );

        v_subtotal := v_subtotal + (v_qty * v_unit_price);
        v_total_discount := v_total_discount + v_discount;
    END LOOP;

    v_total_amount := v_subtotal - v_total_discount;

    UPDATE public.purchase_orders
    SET subtotal = v_subtotal,
        total_discount = v_total_discount,
        total_amount = v_total_amount,
        updated_at = now()
    WHERE id = v_order_id;

    RETURN jsonb_build_object(
        'purchase_order_id', v_order_id,
        'folio', v_folio,
        'email_status', 'pending'
    );
EXCEPTION
    WHEN others THEN
        IF v_order_id IS NOT NULL THEN
            DELETE FROM public.purchase_orders WHERE id = v_order_id;
        END IF;
        RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order(jsonb) TO authenticated;
