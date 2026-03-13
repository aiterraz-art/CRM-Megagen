-- Harden quotation -> order conversion RPC.
-- Goals:
-- 1) enforce authorization server-side
-- 2) block conversion when discount approval is pending/rejected
-- 3) support legacy quotation items (missing product_id) by resolving via SKU/name
-- 4) prevent partial conversions or silent item skips

CREATE OR REPLACE FUNCTION public.convert_quotation_to_order(
    p_quotation_id uuid,
    p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quote public.quotations%ROWTYPE;
    v_existing_order_id uuid;
    v_order_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_qty integer;
    v_unit_price numeric;
    v_stock integer;
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_target_user_id uuid;
    v_item_product_id_raw text;
    v_item_code text;
    v_item_detail text;
    v_inserted_items integer := 0;
BEGIN
    IF p_quotation_id IS NULL THEN
        RAISE EXCEPTION 'p_quotation_id es obligatorio';
    END IF;

    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(p.role, ''))
    INTO v_actor_role
    FROM public.profiles p
    WHERE p.id = v_actor_id;

    IF v_actor_role IS NULL OR v_actor_role = '' THEN
        RAISE EXCEPTION 'Perfil de usuario no encontrado';
    END IF;

    SELECT * INTO v_quote
    FROM public.quotations
    WHERE id = p_quotation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cotización no encontrada';
    END IF;

    IF v_actor_role = 'seller' AND v_quote.seller_id IS DISTINCT FROM v_actor_id THEN
        RAISE EXCEPTION 'No autorizado para convertir esta cotización';
    END IF;

    IF lower(coalesce(v_quote.status, '')) = 'rejected' THEN
        RAISE EXCEPTION 'No se puede vender una cotización rechazada';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.approval_requests ar
        WHERE ar.entity_id = v_quote.id
          AND ar.module = 'sales'
          AND ar.approval_type = 'extra_discount'
          AND ar.status IN ('pending', 'rejected')
    ) THEN
        RAISE EXCEPTION 'La cotización tiene una aprobación de descuento pendiente o rechazada';
    END IF;

    SELECT id INTO v_existing_order_id
    FROM public.orders
    WHERE quotation_id = p_quotation_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'order_id', v_existing_order_id,
            'already_exists', true
        );
    END IF;

    v_target_user_id := v_quote.seller_id;
    IF v_target_user_id IS NULL THEN
        v_target_user_id := COALESCE(p_user_id, v_actor_id);
    END IF;

    IF v_target_user_id IS NULL THEN
        RAISE EXCEPTION 'No se pudo determinar el vendedor de la venta';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = v_target_user_id
    ) THEN
        RAISE EXCEPTION 'El vendedor asociado a la venta no existe';
    END IF;

    INSERT INTO public.orders (
        id,
        client_id,
        user_id,
        quotation_id,
        visit_id,
        status,
        total_amount,
        notes,
        interaction_type
    )
    VALUES (
        gen_random_uuid(),
        v_quote.client_id,
        v_target_user_id,
        v_quote.id,
        NULL,
        'completed',
        COALESCE(v_quote.total_amount, 0),
        v_quote.comments,
        v_quote.interaction_type
    )
    RETURNING id INTO v_order_id;

    IF jsonb_typeof(v_quote.items) <> 'array' OR jsonb_array_length(v_quote.items) = 0 THEN
        RAISE EXCEPTION 'La cotización no tiene ítems válidos para convertir';
    END IF;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(v_quote.items)
    LOOP
        v_product_id := NULL;

        v_item_product_id_raw := trim(coalesce(v_item->>'product_id', ''));
        v_item_code := lower(trim(coalesce(v_item->>'code', '')));
        v_item_detail := lower(trim(coalesce(v_item->>'detail', '')));

        -- Safe UUID parse (avoid invalid_input_syntax errors).
        IF v_item_product_id_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            v_product_id := v_item_product_id_raw::uuid;
        END IF;

        IF v_product_id IS NULL AND v_item_code <> '' THEN
            SELECT i.id
            INTO v_product_id
            FROM public.inventory i
            WHERE lower(coalesce(i.sku, '')) = v_item_code
            LIMIT 1;
        END IF;

        IF v_product_id IS NULL AND v_item_detail <> '' THEN
            SELECT i.id
            INTO v_product_id
            FROM public.inventory i
            WHERE lower(coalesce(i.name, '')) = v_item_detail
            LIMIT 1;
        END IF;

        IF v_product_id IS NULL THEN
            RAISE EXCEPTION 'Ítem sin producto válido en inventario (%). Edita la cotización y selecciona el producto.', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END IF;

        BEGIN
            v_qty := GREATEST(COALESCE(NULLIF(trim(v_item->>'qty'), '')::integer, 1), 1);
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Cantidad inválida en ítem %', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END;

        BEGIN
            v_unit_price := COALESCE(
                NULLIF(trim(v_item->>'net_price'), '')::numeric,
                NULLIF(trim(v_item->>'price'), '')::numeric,
                0
            );
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Precio inválido en ítem %', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END;

        SELECT stock_qty
        INTO v_stock
        FROM public.inventory
        WHERE id = v_product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Producto % no existe en inventario', v_product_id;
        END IF;

        IF COALESCE(v_stock, 0) < v_qty THEN
            RAISE EXCEPTION 'Stock insuficiente para producto % (stock %, solicitado %)', v_product_id, COALESCE(v_stock, 0), v_qty;
        END IF;

        INSERT INTO public.order_items (
            id,
            order_id,
            product_id,
            quantity,
            unit_price,
            total_price
        )
        VALUES (
            gen_random_uuid(),
            v_order_id,
            v_product_id,
            v_qty,
            v_unit_price,
            v_unit_price * v_qty
        );

        UPDATE public.inventory
        SET stock_qty = COALESCE(stock_qty, 0) - v_qty
        WHERE id = v_product_id;

        v_inserted_items := v_inserted_items + 1;
    END LOOP;

    IF v_inserted_items = 0 THEN
        RAISE EXCEPTION 'No se pudieron generar ítems del pedido';
    END IF;

    UPDATE public.quotations
    SET status = 'approved'
    WHERE id = v_quote.id;

    RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'already_exists', false,
        'items_count', v_inserted_items
    );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_quotation_to_order(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_order(uuid, uuid) TO authenticated;
