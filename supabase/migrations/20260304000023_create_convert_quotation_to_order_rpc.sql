-- Creates missing RPC used by Quotations page to generate sales orders atomically.

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
BEGIN
    IF p_quotation_id IS NULL THEN
        RAISE EXCEPTION 'p_quotation_id es obligatorio';
    END IF;

    SELECT * INTO v_quote
    FROM public.quotations
    WHERE id = p_quotation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cotización no encontrada';
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
        COALESCE(p_user_id, v_quote.seller_id),
        v_quote.id,
        NULL,
        'completed',
        COALESCE(v_quote.total_amount, 0),
        v_quote.comments,
        v_quote.interaction_type
    )
    RETURNING id INTO v_order_id;

    IF jsonb_typeof(v_quote.items) = 'array' THEN
        FOR v_item IN
            SELECT value FROM jsonb_array_elements(v_quote.items)
        LOOP
            v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
            v_qty := GREATEST(COALESCE(NULLIF(v_item->>'qty', '')::integer, 1), 1);
            v_unit_price := COALESCE(
                NULLIF(v_item->>'net_price', '')::numeric,
                NULLIF(v_item->>'price', '')::numeric,
                0
            );

            IF v_product_id IS NULL THEN
                CONTINUE;
            END IF;

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
        END LOOP;
    END IF;

    UPDATE public.quotations
    SET status = 'approved'
    WHERE id = v_quote.id;

    RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'already_exists', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.convert_quotation_to_order(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_order(uuid, uuid) TO authenticated;
