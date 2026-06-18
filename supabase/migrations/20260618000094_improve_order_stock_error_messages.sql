CREATE OR REPLACE FUNCTION public.convert_quotation_to_order(
    p_quotation_id uuid,
    p_user_id uuid,
    p_payment_proof_path text DEFAULT NULL,
    p_payment_proof_name text DEFAULT NULL,
    p_payment_proof_mime_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quote public.quotations%ROWTYPE;
    v_existing_order_id uuid;
    v_existing_order_folio integer;
    v_existing_payment_email_status text;
    v_order_id uuid;
    v_order_folio integer;
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
    v_client_credit_days integer := 0;
    v_payment_proof_path text := nullif(trim(coalesce(p_payment_proof_path, '')), '');
    v_payment_proof_name text := nullif(trim(coalesce(p_payment_proof_name, '')), '');
    v_payment_proof_mime_type text := nullif(trim(coalesce(p_payment_proof_mime_type, '')), '');
    v_is_service_item boolean := false;
    v_allow_sale_without_stock boolean := false;
    v_reserved_qty integer := 0;
    v_quote_seller_role text;
    v_max_discount_pct numeric := 0;
    v_item_discount_pct numeric := 0;
    v_item_list_price numeric := 0;
    v_item_net_price numeric := 0;
    v_latest_discount_approval_status text;
    v_insufficient_items_message text := '';
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

    SELECT * INTO v_quote
    FROM public.quotations
    WHERE id = p_quotation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cotizacion no encontrada';
    END IF;

    IF v_quote.seller_id IS DISTINCT FROM v_actor_id
       AND coalesce(v_actor_role, '') NOT IN ('admin', 'facturador', 'administrativo') THEN
        RAISE EXCEPTION 'Solo el vendedor duenio, admin o facturacion pueden convertir la cotizacion a pedido';
    END IF;

    SELECT id, folio, payment_email_status
    INTO v_existing_order_id, v_existing_order_folio, v_existing_payment_email_status
    FROM public.orders
    WHERE quotation_id = p_quotation_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'order_id', v_existing_order_id,
            'order_folio', v_existing_order_folio,
            'already_exists', true,
            'payment_email_status', coalesce(v_existing_payment_email_status, 'not_required')
        );
    END IF;

    SELECT coalesce(c.credit_days, 0)
    INTO v_client_credit_days
    FROM public.clients c
    WHERE c.id = v_quote.client_id;

    IF coalesce(v_client_credit_days, 0) = 0
       AND (v_payment_proof_path IS NULL OR v_payment_proof_name IS NULL) THEN
        RAISE EXCEPTION 'Debes adjuntar comprobante de pago para clientes sin credito';
    END IF;

    v_target_user_id := v_quote.seller_id;
    IF v_target_user_id IS NULL THEN
        v_target_user_id := coalesce(p_user_id, v_actor_id);
    END IF;

    IF v_target_user_id IS NULL THEN
        RAISE EXCEPTION 'No se pudo determinar el vendedor de la venta';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = v_target_user_id
    ) THEN
        RAISE EXCEPTION 'El vendedor asociado a la venta no existe';
    END IF;

    IF jsonb_typeof(v_quote.items) <> 'array' OR jsonb_array_length(v_quote.items) = 0 THEN
        RAISE EXCEPTION 'La cotizacion no tiene items validos para convertir';
    END IF;

    SELECT lower(coalesce(p.role, ''))
    INTO v_quote_seller_role
    FROM public.profiles p
    WHERE p.id = v_quote.seller_id;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(v_quote.items)
    LOOP
        BEGIN
            v_item_list_price := coalesce(
                nullif(trim(v_item->>'price'), '')::numeric,
                0
            );
        EXCEPTION WHEN others THEN
            v_item_list_price := 0;
        END;

        BEGIN
            v_item_net_price := coalesce(
                nullif(trim(v_item->>'net_price'), '')::numeric,
                nullif(trim(v_item->>'netPrice'), '')::numeric,
                v_item_list_price
            );
        EXCEPTION WHEN others THEN
            v_item_net_price := v_item_list_price;
        END;

        BEGIN
            v_item_discount_pct := greatest(
                coalesce(
                    nullif(trim(v_item->>'discount'), '')::numeric,
                    nullif(trim(v_item->>'discountPct'), '')::numeric,
                    CASE
                        WHEN v_item_list_price > 0 THEN round(((v_item_list_price - v_item_net_price) / v_item_list_price) * 100, 2)
                        ELSE 0
                    END
                ),
                0
            );
        EXCEPTION WHEN others THEN
            v_item_discount_pct := 0;
        END;

        v_max_discount_pct := greatest(v_max_discount_pct, coalesce(v_item_discount_pct, 0));
    END LOOP;

    IF coalesce(v_quote_seller_role, '') = 'seller' AND v_max_discount_pct > 5 THEN
        SELECT ar.status
        INTO v_latest_discount_approval_status
        FROM public.approval_requests ar
        WHERE ar.entity_id = v_quote.id
          AND ar.module = 'sales'
          AND ar.approval_type = 'extra_discount'
        ORDER BY ar.requested_at DESC NULLS LAST, ar.id DESC
        LIMIT 1;

        IF v_latest_discount_approval_status = 'approved' THEN
            NULL;
        ELSIF v_latest_discount_approval_status = 'pending' THEN
            RAISE EXCEPTION 'La cotizacion tiene una aprobacion de descuento pendiente';
        ELSIF v_latest_discount_approval_status = 'rejected' THEN
            RAISE EXCEPTION 'La cotizacion tiene una aprobacion de descuento rechazada';
        ELSE
            RAISE EXCEPTION 'La cotizacion requiere autorizacion de descuento antes de generar el pedido';
        END IF;
    END IF;

    DROP TABLE IF EXISTS tmp_validated_order_items;
    CREATE TEMP TABLE tmp_validated_order_items (
        line_no integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        order_item_id uuid NOT NULL,
        product_id uuid NOT NULL,
        quantity integer NOT NULL,
        unit_price numeric NOT NULL,
        total_price numeric NOT NULL,
        is_service_item boolean NOT NULL DEFAULT false
    ) ON COMMIT DROP;

    DROP TABLE IF EXISTS tmp_insufficient_order_items;
    CREATE TEMP TABLE tmp_insufficient_order_items (
        line_no integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        product_id uuid NOT NULL,
        sku text NOT NULL,
        product_name text NOT NULL,
        stock_qty integer NOT NULL,
        requested_qty integer NOT NULL
    ) ON COMMIT DROP;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(v_quote.items)
    LOOP
        DECLARE
            v_product_sku text := 'SIN-SKU';
            v_product_name text := 'Producto sin nombre';
        BEGIN
            v_product_id := NULL;
            v_is_service_item := false;
            v_allow_sale_without_stock := false;
            v_reserved_qty := 0;

            v_item_product_id_raw := trim(coalesce(v_item->>'product_id', ''));
            v_item_code := trim(coalesce(v_item->>'code', ''));
            v_item_detail := trim(coalesce(v_item->>'detail', ''));

            IF v_item_product_id_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
                SELECT i.id
                INTO v_product_id
                FROM public.inventory i
                WHERE i.id = v_item_product_id_raw::uuid
                LIMIT 1;
            END IF;

            IF v_product_id IS NULL AND lower(v_item_code) <> '' THEN
                SELECT i.id
                INTO v_product_id
                FROM public.inventory i
                WHERE lower(coalesce(i.sku, '')) = lower(v_item_code)
                LIMIT 1;
            END IF;

            IF v_product_id IS NULL AND lower(v_item_detail) <> '' THEN
                SELECT i.id
                INTO v_product_id
                FROM public.inventory i
                WHERE lower(coalesce(i.name, '')) = lower(v_item_detail)
                LIMIT 1;
            END IF;

            IF v_product_id IS NULL THEN
                RAISE EXCEPTION 'Item sin producto valido en inventario (%). Edita la cotizacion y selecciona el producto.', coalesce(nullif(v_item_detail, ''), nullif(v_item_code, ''), 'sin referencia');
            END IF;

            BEGIN
                v_qty := greatest(coalesce(nullif(trim(v_item->>'qty'), '')::integer, 1), 1);
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION 'Cantidad invalida en item %', coalesce(nullif(v_item_detail, ''), nullif(v_item_code, ''), 'sin referencia');
            END;

            BEGIN
                v_unit_price := coalesce(
                    nullif(trim(v_item->>'net_price'), '')::numeric,
                    nullif(trim(v_item->>'price'), '')::numeric,
                    0
                );
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION 'Precio invalido en item %', coalesce(nullif(v_item_detail, ''), nullif(v_item_code, ''), 'sin referencia');
            END;

            SELECT
                stock_qty,
                coalesce(is_service_item, false),
                coalesce(allow_sale_without_stock, false),
                coalesce(nullif(trim(sku), ''), 'SIN-SKU'),
                coalesce(nullif(trim(name), ''), 'Producto sin nombre')
            INTO
                v_stock,
                v_is_service_item,
                v_allow_sale_without_stock,
                v_product_sku,
                v_product_name
            FROM public.inventory
            WHERE id = v_product_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Producto % no existe en inventario', v_product_id;
            END IF;

            IF NOT v_is_service_item AND NOT v_allow_sale_without_stock THEN
                SELECT coalesce(sum(t.quantity), 0)
                INTO v_reserved_qty
                FROM tmp_validated_order_items t
                WHERE t.product_id = v_product_id
                  AND t.is_service_item = false;

                IF coalesce(v_stock, 0) < v_reserved_qty + v_qty THEN
                    INSERT INTO tmp_insufficient_order_items (
                        product_id,
                        sku,
                        product_name,
                        stock_qty,
                        requested_qty
                    )
                    VALUES (
                        v_product_id,
                        v_product_sku,
                        v_product_name,
                        coalesce(v_stock, 0),
                        v_reserved_qty + v_qty
                    );
                    CONTINUE;
                END IF;
            END IF;

            INSERT INTO tmp_validated_order_items (
                order_item_id,
                product_id,
                quantity,
                unit_price,
                total_price,
                is_service_item
            )
            VALUES (
                gen_random_uuid(),
                v_product_id,
                v_qty,
                v_unit_price,
                v_unit_price * v_qty,
                v_is_service_item
            );

            v_inserted_items := v_inserted_items + 1;
        END;
    END LOOP;

    SELECT coalesce(string_agg(
        format('%s - %s (stock %s, solicitado %s)', sku, product_name, stock_qty, requested_qty),
        '; ' ORDER BY line_no
    ), '')
    INTO v_insufficient_items_message
    FROM tmp_insufficient_order_items;

    IF v_insufficient_items_message <> '' THEN
        RAISE EXCEPTION 'Stock insuficiente para los siguientes productos: %', v_insufficient_items_message;
    END IF;

    IF v_inserted_items = 0 THEN
        RAISE EXCEPTION 'No se pudieron generar items del pedido';
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
        interaction_type,
        payment_proof_path,
        payment_proof_name,
        payment_proof_mime_type,
        payment_proof_uploaded_at,
        payment_email_status
    )
    VALUES (
        gen_random_uuid(),
        v_quote.client_id,
        v_target_user_id,
        v_quote.id,
        NULL,
        'completed',
        coalesce(v_quote.total_amount, 0),
        v_quote.comments,
        v_quote.interaction_type,
        v_payment_proof_path,
        v_payment_proof_name,
        v_payment_proof_mime_type,
        CASE WHEN v_payment_proof_path IS NOT NULL THEN now() ELSE NULL END,
        'pending'
    )
    RETURNING id, folio INTO v_order_id, v_order_folio;

    CREATE TEMP TABLE tmp_inventory_sale_base ON COMMIT DROP AS
    SELECT
        t.product_id,
        coalesce(i.stock_qty, 0)::integer AS stock_before,
        coalesce(i.price, 0) AS unit_price_snapshot
    FROM (
        SELECT DISTINCT product_id
        FROM tmp_validated_order_items
        WHERE is_service_item = false
    ) t
    JOIN public.inventory i
      ON i.id = t.product_id;

    INSERT INTO public.order_items (
        id,
        order_id,
        product_id,
        quantity,
        unit_price,
        total_price
    )
    SELECT
        t.order_item_id,
        v_order_id,
        t.product_id,
        t.quantity,
        t.unit_price,
        t.total_price
    FROM tmp_validated_order_items t;

    UPDATE public.inventory i
    SET stock_qty = sale_base.stock_before - movement.total_qty,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = v_actor_id
    FROM (
        SELECT
            t.product_id,
            sum(t.quantity)::integer AS total_qty
        FROM tmp_validated_order_items t
        WHERE t.is_service_item = false
        GROUP BY t.product_id
    ) AS movement
    JOIN tmp_inventory_sale_base sale_base
      ON sale_base.product_id = movement.product_id
    WHERE i.id = movement.product_id;

    INSERT INTO public.inventory_movements (
        inventory_id,
        movement_type,
        direction,
        qty,
        stock_before,
        stock_after,
        unit_price_snapshot,
        reason_code,
        reason_note,
        source_table,
        source_id,
        order_id,
        order_item_id,
        performed_by
    )
    SELECT
        t.product_id,
        'sale_outbound',
        'out',
        t.quantity,
        sale_base.stock_before - coalesce(sum(t.quantity) OVER (
            PARTITION BY t.product_id
            ORDER BY t.line_no
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0),
        sale_base.stock_before - sum(t.quantity) OVER (
            PARTITION BY t.product_id
            ORDER BY t.line_no
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ),
        t.unit_price,
        'sale',
        format('Pedido generado desde cotización #%s', coalesce(v_quote.folio::text, '')),
        'order_items',
        t.order_item_id,
        v_order_id,
        t.order_item_id,
        v_actor_id
    FROM tmp_validated_order_items t
    JOIN tmp_inventory_sale_base sale_base
      ON sale_base.product_id = t.product_id
    WHERE t.is_service_item = false
    ORDER BY t.product_id, t.line_no;

    UPDATE public.quotations
    SET status = 'approved'
    WHERE id = v_quote.id;

    UPDATE public.clients
    SET status = 'active'
    WHERE id = v_quote.client_id
      AND (
        status = 'prospect'
        OR status LIKE 'prospect\_%' ESCAPE '\'
      );

    RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'order_folio', v_order_folio,
        'already_exists', false,
        'items_count', v_inserted_items,
        'client_credit_days', v_client_credit_days,
        'payment_email_status', 'pending'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_quotation_to_order(uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
