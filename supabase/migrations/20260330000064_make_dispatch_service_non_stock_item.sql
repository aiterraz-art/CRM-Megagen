ALTER TABLE public.inventory
ADD COLUMN IF NOT EXISTS is_service_item boolean NOT NULL DEFAULT false;

UPDATE public.inventory
SET is_service_item = true,
    category = COALESCE(NULLIF(category, ''), 'Servicios'),
    price = COALESCE(price, 0)
WHERE upper(trim(coalesce(sku, ''))) = 'SERV-DESPACHO';

INSERT INTO public.inventory (
    id,
    sku,
    name,
    price,
    stock_qty,
    category,
    is_service_item,
    created_at
)
VALUES (
    gen_random_uuid(),
    'SERV-DESPACHO',
    'SERVICIO DE DESPACHO',
    0,
    0,
    'Servicios',
    true,
    timezone('utc', now())
)
ON CONFLICT (sku)
DO UPDATE
SET
    name = EXCLUDED.name,
    price = 0,
    category = 'Servicios',
    is_service_item = true;

CREATE OR REPLACE FUNCTION public.replace_inventory_stock_import(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_processed_count integer := 0;
    v_deleted_count integer := 0;
    v_preserved_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'jefe', 'facturador', 'tesorero') THEN
        RAISE EXCEPTION 'No tienes permisos para importar inventario';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'p_items debe ser un arreglo JSON';
    END IF;

    CREATE TEMP TABLE tmp_stock_import (
        sku text PRIMARY KEY,
        name text NOT NULL,
        stock_qty integer NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_stock_import (sku, name, stock_qty)
    SELECT DISTINCT ON (sku)
        sku,
        name,
        stock_qty
    FROM (
        SELECT
            upper(trim(coalesce(value->>'sku', ''))) AS sku,
            trim(coalesce(value->>'name', '')) AS name,
            CASE
                WHEN jsonb_typeof(value->'stock_qty') = 'number' THEN greatest(floor((value->>'stock_qty')::numeric)::integer, 0)
                ELSE
                    CASE
                        WHEN regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g') ~ '^-?[0-9]+$'
                            THEN greatest((regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g'))::integer, 0)
                        ELSE 0
                    END
            END AS stock_qty
        FROM jsonb_array_elements(p_items) AS value
    ) src
    WHERE sku <> ''
      AND name <> ''
    ORDER BY sku;

    SELECT COUNT(*) INTO v_processed_count FROM tmp_stock_import;

    IF v_processed_count = 0 THEN
        RAISE EXCEPTION 'No se encontraron datos válidos para importar stock';
    END IF;

    CREATE TEMP TABLE tmp_stock_existing ON COMMIT DROP AS
    SELECT
        t.sku,
        t.name,
        t.stock_qty,
        i.id AS existing_id,
        coalesce(pc.price, i.price, 0) AS price,
        coalesce(i.category, 'General') AS category
    FROM tmp_stock_import t
    LEFT JOIN public.inventory i
      ON upper(trim(coalesce(i.sku, ''))) = t.sku
    LEFT JOIN public.inventory_price_catalog pc
      ON pc.sku = t.sku;

    INSERT INTO public.inventory (id, sku, name, stock_qty, price, category, is_service_item)
    SELECT
        coalesce(existing_id, gen_random_uuid()),
        sku,
        name,
        stock_qty,
        price,
        category,
        false
    FROM tmp_stock_existing
    ON CONFLICT (id) DO UPDATE
    SET sku = EXCLUDED.sku,
        name = EXCLUDED.name,
        stock_qty = EXCLUDED.stock_qty,
        price = EXCLUDED.price,
        category = EXCLUDED.category;

    CREATE TEMP TABLE tmp_obsolete_inventory ON COMMIT DROP AS
    SELECT i.id
    FROM public.inventory i
    WHERE coalesce(i.is_service_item, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM tmp_stock_import t
        WHERE t.sku = upper(trim(coalesce(i.sku, '')))
    );

    DELETE FROM public.inventory i
    USING tmp_obsolete_inventory o
    WHERE i.id = o.id
      AND NOT EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.product_id = o.id
      );
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    UPDATE public.inventory i
    SET stock_qty = 0
    FROM tmp_obsolete_inventory o
    WHERE i.id = o.id
      AND EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.product_id = o.id
      );
    GET DIAGNOSTICS v_preserved_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'processed_count', v_processed_count,
        'deleted_count', v_deleted_count,
        'preserved_historical_count', v_preserved_count
    );
END;
$$;

DROP FUNCTION IF EXISTS public.convert_quotation_to_order(uuid, uuid);

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
BEGIN
    IF p_quotation_id IS NULL THEN
        RAISE EXCEPTION 'p_quotation_id es obligatorio';
    END IF;

    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT * INTO v_quote
    FROM public.quotations
    WHERE id = p_quotation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cotizacion no encontrada';
    END IF;

    IF v_quote.seller_id IS DISTINCT FROM v_actor_id THEN
        RAISE EXCEPTION 'Solo el vendedor duenio de la cotizacion puede convertirla a pedido';
    END IF;

    IF lower(coalesce(v_quote.status, '')) = 'rejected' THEN
        RAISE EXCEPTION 'No se puede vender una cotizacion rechazada';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.approval_requests ar
        WHERE ar.entity_id = v_quote.id
          AND ar.module = 'sales'
          AND ar.approval_type = 'extra_discount'
          AND ar.status IN ('pending', 'rejected')
    ) THEN
        RAISE EXCEPTION 'La cotizacion tiene una aprobacion de descuento pendiente o rechazada';
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

    IF jsonb_typeof(v_quote.items) <> 'array' OR jsonb_array_length(v_quote.items) = 0 THEN
        RAISE EXCEPTION 'La cotizacion no tiene items validos para convertir';
    END IF;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(v_quote.items)
    LOOP
        v_product_id := NULL;
        v_is_service_item := false;

        v_item_product_id_raw := trim(coalesce(v_item->>'product_id', ''));
        v_item_code := lower(trim(coalesce(v_item->>'code', '')));
        v_item_detail := lower(trim(coalesce(v_item->>'detail', '')));

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
            RAISE EXCEPTION 'Item sin producto valido en inventario (%). Edita la cotizacion y selecciona el producto.', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END IF;

        BEGIN
            v_qty := greatest(coalesce(nullif(trim(v_item->>'qty'), '')::integer, 1), 1);
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Cantidad invalida en item %', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END;

        BEGIN
            v_unit_price := coalesce(
                nullif(trim(v_item->>'net_price'), '')::numeric,
                nullif(trim(v_item->>'price'), '')::numeric,
                0
            );
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Precio invalido en item %', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END;

        SELECT stock_qty, coalesce(is_service_item, false)
        INTO v_stock, v_is_service_item
        FROM public.inventory
        WHERE id = v_product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Producto % no existe en inventario', v_product_id;
        END IF;

        IF NOT v_is_service_item AND coalesce(v_stock, 0) < v_qty THEN
            RAISE EXCEPTION 'Stock insuficiente para producto % (stock %, solicitado %)', v_product_id, coalesce(v_stock, 0), v_qty;
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

        IF NOT v_is_service_item THEN
            UPDATE public.inventory
            SET stock_qty = coalesce(stock_qty, 0) - v_qty
            WHERE id = v_product_id;
        END IF;

        v_inserted_items := v_inserted_items + 1;
    END LOOP;

    IF v_inserted_items = 0 THEN
        RAISE EXCEPTION 'No se pudieron generar items del pedido';
    END IF;

    UPDATE public.quotations
    SET status = 'approved'
    WHERE id = v_quote.id;

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

GRANT EXECUTE ON FUNCTION public.replace_inventory_stock_import(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_order(uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
