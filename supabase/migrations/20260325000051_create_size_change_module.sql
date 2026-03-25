CREATE TABLE IF NOT EXISTS public.size_change_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    folio bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'sent', 'closed', 'cancelled')),
    client_name_snapshot text NOT NULL,
    client_rut_snapshot text,
    client_address_snapshot text,
    client_comuna_snapshot text,
    seller_name_snapshot text NOT NULL,
    request_comment text,
    sent_note text,
    close_note text,
    cancel_note text,
    exchange_completed_successfully boolean NOT NULL DEFAULT false,
    return_products_collected boolean NOT NULL DEFAULT false,
    sent_at timestamptz,
    sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    closed_at timestamptz,
    closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    cancelled_at timestamptz,
    cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.size_change_request_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES public.size_change_requests(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
    sku_snapshot text NOT NULL,
    product_name_snapshot text NOT NULL,
    qty numeric NOT NULL CHECK (qty > 0),
    unit_price numeric NOT NULL CHECK (unit_price >= 0),
    line_total numeric NOT NULL CHECK (line_total >= 0),
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_size_change_requests_status ON public.size_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_size_change_requests_seller_id ON public.size_change_requests(seller_id);
CREATE INDEX IF NOT EXISTS idx_size_change_requests_client_id ON public.size_change_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_size_change_requests_created_at_desc ON public.size_change_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_size_change_request_items_request_id ON public.size_change_request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_size_change_request_items_product_id ON public.size_change_request_items(product_id);

CREATE OR REPLACE FUNCTION public.size_change_requests_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = timezone('utc', now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_size_change_requests_touch_updated_at ON public.size_change_requests;
CREATE TRIGGER trg_size_change_requests_touch_updated_at
BEFORE UPDATE ON public.size_change_requests
FOR EACH ROW
EXECUTE FUNCTION public.size_change_requests_touch_updated_at();

ALTER TABLE public.size_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.size_change_request_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.size_change_requests TO authenticated;
GRANT SELECT ON public.size_change_request_items TO authenticated;

DROP POLICY IF EXISTS "Size change requests read" ON public.size_change_requests;
CREATE POLICY "Size change requests read"
ON public.size_change_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
              lower(coalesce(p.role, '')) IN ('admin', 'facturador')
              OR (
                  lower(coalesce(p.role, '')) = 'seller'
                  AND seller_id = auth.uid()
              )
          )
    )
);

DROP POLICY IF EXISTS "Size change request items read" ON public.size_change_request_items;
CREATE POLICY "Size change request items read"
ON public.size_change_request_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.size_change_requests r
        JOIN public.profiles p
          ON p.id = auth.uid()
        WHERE r.id = size_change_request_items.request_id
          AND (
              lower(coalesce(p.role, '')) IN ('admin', 'facturador')
              OR (
                  lower(coalesce(p.role, '')) = 'seller'
                  AND r.seller_id = auth.uid()
              )
          )
    )
);

DROP FUNCTION IF EXISTS public.create_size_change_request(jsonb);
CREATE OR REPLACE FUNCTION public.create_size_change_request(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_client_id uuid;
    v_seller_id uuid;
    v_request_comment text;
    v_request_id uuid;
    v_folio bigint;
    v_client public.clients%ROWTYPE;
    v_seller public.profiles%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('seller', 'admin') THEN
        RAISE EXCEPTION 'No tienes permisos para crear cambios de medida';
    END IF;

    IF jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'El payload del cambio debe ser un objeto JSON';
    END IF;

    v_client_id := nullif(trim(coalesce(p_payload->>'client_id', '')), '')::uuid;
    v_seller_id := nullif(trim(coalesce(p_payload->>'seller_id', '')), '')::uuid;
    v_request_comment := nullif(trim(coalesce(p_payload->>'request_comment', '')), '');

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Debes seleccionar un cliente';
    END IF;

    IF v_seller_id IS NULL THEN
        RAISE EXCEPTION 'Debes seleccionar un vendedor';
    END IF;

    IF v_actor_role = 'seller' AND v_seller_id <> auth.uid() THEN
        RAISE EXCEPTION 'Solo puedes crear solicitudes a tu nombre';
    END IF;

    SELECT *
    INTO v_client
    FROM public.clients
    WHERE id = v_client_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El cliente seleccionado no existe';
    END IF;

    SELECT *
    INTO v_seller
    FROM public.profiles
    WHERE id = v_seller_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El vendedor seleccionado no existe';
    END IF;

    IF lower(coalesce(v_seller.role, '')) <> 'seller' THEN
        RAISE EXCEPTION 'El usuario asignado debe tener rol vendedor';
    END IF;

    IF lower(coalesce(v_seller.status, 'active')) <> 'active' THEN
        RAISE EXCEPTION 'El vendedor asignado debe estar activo';
    END IF;

    IF jsonb_typeof(p_payload->'items') <> 'array' THEN
        RAISE EXCEPTION 'Debes agregar al menos un producto';
    END IF;

    CREATE TEMP TABLE tmp_size_change_items (
        product_id uuid,
        qty numeric,
        unit_price numeric
    ) ON COMMIT DROP;

    INSERT INTO tmp_size_change_items (product_id, qty, unit_price)
    SELECT
        nullif(trim(coalesce(value->>'product_id', '')), '')::uuid,
        COALESCE(NULLIF(trim(coalesce(value->>'qty', '')), '')::numeric, 0),
        COALESCE(NULLIF(trim(coalesce(value->>'unit_price', '')), '')::numeric, 0)
    FROM jsonb_array_elements(p_payload->'items') AS rows(value);

    IF NOT EXISTS (SELECT 1 FROM tmp_size_change_items) THEN
        RAISE EXCEPTION 'Debes agregar al menos un producto';
    END IF;

    IF EXISTS (SELECT 1 FROM tmp_size_change_items WHERE product_id IS NULL) THEN
        RAISE EXCEPTION 'Todos los productos deben existir en inventario';
    END IF;

    IF EXISTS (SELECT 1 FROM tmp_size_change_items WHERE qty <= 0) THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a cero en todas las líneas';
    END IF;

    IF EXISTS (SELECT 1 FROM tmp_size_change_items WHERE unit_price < 0) THEN
        RAISE EXCEPTION 'El valor unitario no puede ser negativo';
    END IF;

    IF EXISTS (
        SELECT product_id
        FROM tmp_size_change_items
        GROUP BY product_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'No puedes repetir el mismo producto en más de una línea';
    END IF;

    CREATE TEMP TABLE tmp_size_change_resolved ON COMMIT DROP AS
    SELECT
        t.product_id,
        t.qty,
        t.unit_price,
        i.sku,
        i.name
    FROM tmp_size_change_items t
    JOIN public.inventory i
      ON i.id = t.product_id;

    IF (SELECT COUNT(*) FROM tmp_size_change_resolved) <> (SELECT COUNT(*) FROM tmp_size_change_items) THEN
        RAISE EXCEPTION 'Uno o más productos del cambio no existen en inventario';
    END IF;

    INSERT INTO public.size_change_requests (
        client_id,
        seller_id,
        created_by,
        status,
        client_name_snapshot,
        client_rut_snapshot,
        client_address_snapshot,
        client_comuna_snapshot,
        seller_name_snapshot,
        request_comment
    )
    VALUES (
        v_client_id,
        v_seller_id,
        auth.uid(),
        'requested',
        v_client.name,
        v_client.rut,
        v_client.address,
        v_client.comuna,
        coalesce(nullif(trim(v_seller.full_name), ''), split_part(coalesce(v_seller.email, ''), '@', 1), 'Vendedor'),
        v_request_comment
    )
    RETURNING id, folio INTO v_request_id, v_folio;

    INSERT INTO public.size_change_request_items (
        request_id,
        product_id,
        sku_snapshot,
        product_name_snapshot,
        qty,
        unit_price,
        line_total
    )
    SELECT
        v_request_id,
        product_id,
        coalesce(sku, ''),
        name,
        qty,
        unit_price,
        qty * unit_price
    FROM tmp_size_change_resolved;

    RETURN jsonb_build_object(
        'id', v_request_id,
        'folio', v_folio,
        'status', 'requested'
    );
END;
$$;

DROP FUNCTION IF EXISTS public.update_size_change_request(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.update_size_change_request(p_request_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_request public.size_change_requests%ROWTYPE;
    v_client_id uuid;
    v_seller_id uuid;
    v_request_comment text;
    v_client public.clients%ROWTYPE;
    v_seller public.profiles%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('seller', 'admin') THEN
        RAISE EXCEPTION 'No tienes permisos para editar cambios de medida';
    END IF;

    SELECT *
    INTO v_request
    FROM public.size_change_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La solicitud de cambio no existe';
    END IF;

    IF v_request.status <> 'requested' THEN
        RAISE EXCEPTION 'Solo puedes editar solicitudes en estado solicitado';
    END IF;

    IF v_actor_role = 'seller' AND v_request.seller_id <> auth.uid() THEN
        RAISE EXCEPTION 'Solo puedes editar tus propias solicitudes';
    END IF;

    IF jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'El payload del cambio debe ser un objeto JSON';
    END IF;

    v_client_id := nullif(trim(coalesce(p_payload->>'client_id', '')), '')::uuid;
    v_seller_id := nullif(trim(coalesce(p_payload->>'seller_id', '')), '')::uuid;
    v_request_comment := nullif(trim(coalesce(p_payload->>'request_comment', '')), '');

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Debes seleccionar un cliente';
    END IF;

    IF v_seller_id IS NULL THEN
        RAISE EXCEPTION 'Debes seleccionar un vendedor';
    END IF;

    IF v_actor_role = 'seller' AND v_seller_id <> auth.uid() THEN
        RAISE EXCEPTION 'Solo puedes crear solicitudes a tu nombre';
    END IF;

    SELECT *
    INTO v_client
    FROM public.clients
    WHERE id = v_client_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El cliente seleccionado no existe';
    END IF;

    SELECT *
    INTO v_seller
    FROM public.profiles
    WHERE id = v_seller_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El vendedor seleccionado no existe';
    END IF;

    IF lower(coalesce(v_seller.role, '')) <> 'seller' THEN
        RAISE EXCEPTION 'El usuario asignado debe tener rol vendedor';
    END IF;

    IF lower(coalesce(v_seller.status, 'active')) <> 'active' THEN
        RAISE EXCEPTION 'El vendedor asignado debe estar activo';
    END IF;

    IF jsonb_typeof(p_payload->'items') <> 'array' THEN
        RAISE EXCEPTION 'Debes agregar al menos un producto';
    END IF;

    CREATE TEMP TABLE tmp_size_change_items (
        product_id uuid,
        qty numeric,
        unit_price numeric
    ) ON COMMIT DROP;

    INSERT INTO tmp_size_change_items (product_id, qty, unit_price)
    SELECT
        nullif(trim(coalesce(value->>'product_id', '')), '')::uuid,
        COALESCE(NULLIF(trim(coalesce(value->>'qty', '')), '')::numeric, 0),
        COALESCE(NULLIF(trim(coalesce(value->>'unit_price', '')), '')::numeric, 0)
    FROM jsonb_array_elements(p_payload->'items') AS rows(value);

    IF NOT EXISTS (SELECT 1 FROM tmp_size_change_items) THEN
        RAISE EXCEPTION 'Debes agregar al menos un producto';
    END IF;

    IF EXISTS (SELECT 1 FROM tmp_size_change_items WHERE product_id IS NULL) THEN
        RAISE EXCEPTION 'Todos los productos deben existir en inventario';
    END IF;

    IF EXISTS (SELECT 1 FROM tmp_size_change_items WHERE qty <= 0) THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a cero en todas las líneas';
    END IF;

    IF EXISTS (SELECT 1 FROM tmp_size_change_items WHERE unit_price < 0) THEN
        RAISE EXCEPTION 'El valor unitario no puede ser negativo';
    END IF;

    IF EXISTS (
        SELECT product_id
        FROM tmp_size_change_items
        GROUP BY product_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'No puedes repetir el mismo producto en más de una línea';
    END IF;

    CREATE TEMP TABLE tmp_size_change_resolved ON COMMIT DROP AS
    SELECT
        t.product_id,
        t.qty,
        t.unit_price,
        i.sku,
        i.name
    FROM tmp_size_change_items t
    JOIN public.inventory i
      ON i.id = t.product_id;

    IF (SELECT COUNT(*) FROM tmp_size_change_resolved) <> (SELECT COUNT(*) FROM tmp_size_change_items) THEN
        RAISE EXCEPTION 'Uno o más productos del cambio no existen en inventario';
    END IF;

    UPDATE public.size_change_requests
    SET client_id = v_client_id,
        seller_id = v_seller_id,
        client_name_snapshot = v_client.name,
        client_rut_snapshot = v_client.rut,
        client_address_snapshot = v_client.address,
        client_comuna_snapshot = v_client.comuna,
        seller_name_snapshot = coalesce(nullif(trim(v_seller.full_name), ''), split_part(coalesce(v_seller.email, ''), '@', 1), 'Vendedor'),
        request_comment = v_request_comment,
        sent_note = NULL,
        close_note = NULL,
        cancel_note = NULL,
        exchange_completed_successfully = false,
        return_products_collected = false,
        sent_at = NULL,
        sent_by = NULL,
        closed_at = NULL,
        closed_by = NULL,
        cancelled_at = NULL,
        cancelled_by = NULL,
        updated_at = timezone('utc', now())
    WHERE id = p_request_id;

    DELETE FROM public.size_change_request_items
    WHERE request_id = p_request_id;

    INSERT INTO public.size_change_request_items (
        request_id,
        product_id,
        sku_snapshot,
        product_name_snapshot,
        qty,
        unit_price,
        line_total
    )
    SELECT
        p_request_id,
        product_id,
        coalesce(sku, ''),
        name,
        qty,
        unit_price,
        qty * unit_price
    FROM tmp_size_change_resolved;

    RETURN jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'requested'
    );
END;
$$;

DROP FUNCTION IF EXISTS public.mark_size_change_sent(uuid, text);
CREATE OR REPLACE FUNCTION public.mark_size_change_sent(p_request_id uuid, p_sent_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_request public.size_change_requests%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'facturador') THEN
        RAISE EXCEPTION 'No tienes permisos para enviar cambios de medida';
    END IF;

    SELECT *
    INTO v_request
    FROM public.size_change_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La solicitud de cambio no existe';
    END IF;

    IF v_request.status <> 'requested' THEN
        RAISE EXCEPTION 'Solo puedes enviar solicitudes en estado solicitado';
    END IF;

    UPDATE public.size_change_requests
    SET status = 'sent',
        sent_at = timezone('utc', now()),
        sent_by = auth.uid(),
        sent_note = nullif(trim(coalesce(p_sent_note, '')), ''),
        updated_at = timezone('utc', now())
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'sent'
    );
END;
$$;

DROP FUNCTION IF EXISTS public.close_size_change_request(uuid, text);
CREATE OR REPLACE FUNCTION public.close_size_change_request(p_request_id uuid, p_close_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_request public.size_change_requests%ROWTYPE;
    v_insufficient_item record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'facturador') THEN
        RAISE EXCEPTION 'No tienes permisos para cerrar cambios de medida';
    END IF;

    SELECT *
    INTO v_request
    FROM public.size_change_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La solicitud de cambio no existe';
    END IF;

    IF v_request.status <> 'sent' THEN
        RAISE EXCEPTION 'Solo puedes cerrar solicitudes en estado enviado';
    END IF;

    PERFORM 1
    FROM public.inventory i
    JOIN public.size_change_request_items items
      ON items.product_id = i.id
    WHERE items.request_id = p_request_id
    FOR UPDATE OF i;

    SELECT
        items.sku_snapshot,
        items.product_name_snapshot,
        items.qty,
        coalesce(i.stock_qty, 0) AS current_stock
    INTO v_insufficient_item
    FROM public.size_change_request_items items
    JOIN public.inventory i
      ON i.id = items.product_id
    WHERE items.request_id = p_request_id
      AND coalesce(i.stock_qty, 0) < items.qty
    ORDER BY items.created_at
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para % (%). Disponible: %, solicitado: %',
            v_insufficient_item.product_name_snapshot,
            coalesce(v_insufficient_item.sku_snapshot, 'SIN SKU'),
            v_insufficient_item.current_stock,
            v_insufficient_item.qty;
    END IF;

    UPDATE public.inventory i
    SET stock_qty = coalesce(i.stock_qty, 0) - items.qty
    FROM public.size_change_request_items items
    WHERE items.request_id = p_request_id
      AND items.product_id = i.id;

    UPDATE public.size_change_requests
    SET status = 'closed',
        close_note = nullif(trim(coalesce(p_close_note, '')), ''),
        closed_at = timezone('utc', now()),
        closed_by = auth.uid(),
        exchange_completed_successfully = true,
        return_products_collected = true,
        updated_at = timezone('utc', now())
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'closed'
    );
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_size_change_request(uuid, text);
CREATE OR REPLACE FUNCTION public.cancel_size_change_request(p_request_id uuid, p_cancel_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_request public.size_change_requests%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    SELECT *
    INTO v_request
    FROM public.size_change_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La solicitud de cambio no existe';
    END IF;

    IF v_actor_role = 'seller' THEN
        IF v_request.seller_id <> auth.uid() THEN
            RAISE EXCEPTION 'Solo puedes cancelar tus propias solicitudes';
        END IF;
        IF v_request.status <> 'requested' THEN
            RAISE EXCEPTION 'Solo puedes cancelar solicitudes en estado solicitado';
        END IF;
    ELSIF v_actor_role IN ('admin', 'facturador') THEN
        IF v_request.status NOT IN ('requested', 'sent') THEN
            RAISE EXCEPTION 'Solo puedes cancelar solicitudes abiertas';
        END IF;
    ELSE
        RAISE EXCEPTION 'No tienes permisos para cancelar cambios de medida';
    END IF;

    UPDATE public.size_change_requests
    SET status = 'cancelled',
        cancel_note = nullif(trim(coalesce(p_cancel_note, '')), ''),
        cancelled_at = timezone('utc', now()),
        cancelled_by = auth.uid(),
        updated_at = timezone('utc', now())
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'cancelled'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_size_change_request(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_size_change_request(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_size_change_sent(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_size_change_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_size_change_request(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_size_change_request(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_size_change_request(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_size_change_sent(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_size_change_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_size_change_request(uuid, text) TO authenticated;

INSERT INTO public.role_permissions (role, permission)
SELECT v.role, v.permission
FROM (
    VALUES
        ('admin', 'VIEW_SIZE_CHANGES'),
        ('admin', 'CREATE_SIZE_CHANGES'),
        ('admin', 'MANAGE_SIZE_CHANGES'),
        ('seller', 'VIEW_SIZE_CHANGES'),
        ('seller', 'CREATE_SIZE_CHANGES'),
        ('facturador', 'VIEW_SIZE_CHANGES'),
        ('facturador', 'MANAGE_SIZE_CHANGES')
) AS v(role, permission)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = v.role
      AND rp.permission = v.permission
);
