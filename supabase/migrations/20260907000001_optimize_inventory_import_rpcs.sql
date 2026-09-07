-- Importaciones masivas: resolver SKU normalizados una sola vez por tabla.
-- Las versiones anteriores ejecutaban búsquedas laterales por cada fila y
-- recorrían todo el catálogo de precios repetidamente.

CREATE INDEX IF NOT EXISTS idx_inventory_normalized_sku
    ON public.inventory (public.normalize_inventory_sku(sku));

CREATE INDEX IF NOT EXISTS idx_inventory_price_catalog_normalized_sku
    ON public.inventory_price_catalog (public.normalize_inventory_sku(sku));

CREATE INDEX IF NOT EXISTS idx_inventory_movements_order_outbound_inventory
    ON public.inventory_movements (inventory_id)
    WHERE direction = 'out' AND source_table = 'order_items';

CREATE OR REPLACE FUNCTION public.replace_inventory_stock_import(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_processed_count integer := 0;
    v_deleted_count integer := 0;
    v_preserved_count integer := 0;
    v_changed_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('UPLOAD_EXCEL') THEN
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
            public.normalize_inventory_sku(value->>'sku') AS sku,
            trim(coalesce(value->>'name', '')) AS name,
            CASE
                WHEN jsonb_typeof(value->'stock_qty') = 'number' THEN greatest(floor((value->>'stock_qty')::numeric)::integer, 0)
                WHEN regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g') ~ '^-?[0-9]+$'
                    THEN greatest((regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g'))::integer, 0)
                ELSE 0
            END AS stock_qty
        FROM jsonb_array_elements(p_items) AS value
    ) src
    WHERE sku <> ''
      AND name <> ''
    ORDER BY sku;

    SELECT count(*) INTO v_processed_count FROM tmp_stock_import;

    IF v_processed_count = 0 THEN
        RAISE EXCEPTION 'No se encontraron datos válidos para importar stock';
    END IF;

    CREATE TEMP TABLE tmp_inventory_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.id,
        ranked.sku,
        ranked.name,
        ranked.stock_qty,
        ranked.price,
        ranked.category,
        ranked.min_stock_alert,
        ranked.target_coverage_days
    FROM (
        SELECT
            public.normalize_inventory_sku(i.sku) AS normalized_sku,
            i.*,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(i.sku)
                ORDER BY
                    CASE WHEN i.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN i.supplier_id IS NOT NULL THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(i.price, 0) > 0 THEN 0 ELSE 1 END,
                    i.created_at ASC,
                    i.id ASC
            ) AS rn
        FROM public.inventory i
        WHERE public.normalize_inventory_sku(i.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_inventory_match (normalized_sku);

    CREATE TEMP TABLE tmp_catalog_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.price
    FROM (
        SELECT
            public.normalize_inventory_sku(pc.sku) AS normalized_sku,
            pc.price,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(pc.sku)
                ORDER BY
                    CASE WHEN pc.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(pc.price, 0) > 0 THEN 0 ELSE 1 END,
                    pc.updated_at DESC,
                    pc.created_at ASC,
                    pc.sku ASC
            ) AS rn
        FROM public.inventory_price_catalog pc
        WHERE public.normalize_inventory_sku(pc.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_catalog_match (normalized_sku);

    CREATE TEMP TABLE tmp_stock_existing ON COMMIT DROP AS
    SELECT
        t.sku,
        t.name,
        t.stock_qty,
        coalesce(i.id, gen_random_uuid()) AS inventory_id,
        i.id AS existing_id,
        coalesce(i.stock_qty, 0)::integer AS stock_before,
        coalesce(pc.price, i.price, 0) AS price,
        coalesce(i.category, 'General') AS category,
        coalesce(i.min_stock_alert, 5)::integer AS min_stock_alert,
        coalesce(i.target_coverage_days, 30)::integer AS target_coverage_days,
        coalesce(nullif(trim(coalesce(i.sku, '')), ''), t.sku) AS target_sku,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), t.name) AS target_name
    FROM tmp_stock_import t
    LEFT JOIN tmp_inventory_match i
      ON i.normalized_sku = t.sku
    LEFT JOIN tmp_catalog_match pc
      ON pc.normalized_sku = t.sku;

    INSERT INTO public.inventory (
        id,
        sku,
        name,
        stock_qty,
        price,
        category,
        is_service_item,
        min_stock_alert,
        target_coverage_days,
        last_stock_reviewed_at,
        last_stock_reviewed_by
    )
    SELECT
        inventory_id,
        target_sku,
        target_name,
        stock_qty,
        price,
        category,
        false,
        min_stock_alert,
        target_coverage_days,
        now(),
        auth.uid()
    FROM tmp_stock_existing
    ON CONFLICT (id) DO UPDATE
    SET sku = excluded.sku,
        name = excluded.name,
        stock_qty = excluded.stock_qty,
        price = excluded.price,
        category = excluded.category,
        min_stock_alert = excluded.min_stock_alert,
        target_coverage_days = excluded.target_coverage_days,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid();

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
        performed_by
    )
    SELECT
        tse.inventory_id,
        'manual_correction',
        'adjust',
        abs(tse.stock_qty - tse.stock_before),
        tse.stock_before,
        tse.stock_qty,
        tse.price,
        'stock_count',
        'Importación masiva de stock',
        'inventory_stock_import',
        null,
        auth.uid()
    FROM tmp_stock_existing tse
    WHERE tse.existing_id IS NOT NULL
      AND tse.stock_before <> tse.stock_qty;

    GET DIAGNOSTICS v_changed_count = ROW_COUNT;

    CREATE TEMP TABLE tmp_order_outbound_inventory (
        inventory_id uuid PRIMARY KEY
    ) ON COMMIT DROP;

    INSERT INTO tmp_order_outbound_inventory (inventory_id)
    SELECT DISTINCT im.inventory_id
    FROM public.inventory_movements im
    WHERE im.inventory_id IS NOT NULL
      AND im.direction = 'out'
      AND im.source_table = 'order_items';

    CREATE TEMP TABLE tmp_unlisted_inventory ON COMMIT DROP AS
    SELECT
        i.id,
        (order_outbound.inventory_id IS NOT NULL) AS has_order_outbound
    FROM public.inventory i
    LEFT JOIN tmp_stock_import t
      ON t.sku = public.normalize_inventory_sku(i.sku)
    LEFT JOIN tmp_order_outbound_inventory order_outbound
      ON order_outbound.inventory_id = i.id
    WHERE t.sku IS NULL
      AND coalesce(i.stock_qty, 0) <> 0
      AND coalesce(i.is_service_item, false) = false;

    UPDATE public.inventory i
    SET stock_qty = 0,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid()
    FROM tmp_unlisted_inventory u
    WHERE i.id = u.id
      AND u.has_order_outbound;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    UPDATE public.inventory i
    SET stock_qty = 0,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid()
    FROM tmp_unlisted_inventory u
    WHERE i.id = u.id
      AND NOT u.has_order_outbound;

    GET DIAGNOSTICS v_preserved_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'processed_count', v_processed_count,
        'deleted_count', v_deleted_count,
        'preserved_historical_count', v_preserved_count,
        'changed_count', v_changed_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_inventory_pricing_import(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stored_count integer := 0;
    v_synced_count integer := 0;
    v_catalog_only_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('UPLOAD_EXCEL') THEN
        RAISE EXCEPTION 'No tienes permisos para importar precios';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'p_items debe ser un arreglo JSON';
    END IF;

    CREATE TEMP TABLE tmp_pricing_import (
        sku text PRIMARY KEY,
        price numeric NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_pricing_import (sku, price)
    SELECT DISTINCT ON (sku)
        sku,
        price
    FROM (
        SELECT
            public.normalize_inventory_sku(value->>'sku') AS sku,
            public.parse_inventory_import_price(value->>'price') AS price
        FROM jsonb_array_elements(p_items) AS value
    ) src
    WHERE sku <> ''
      AND price IS NOT NULL
    ORDER BY sku;

    IF NOT EXISTS (SELECT 1 FROM tmp_pricing_import) THEN
        RAISE EXCEPTION 'No se encontraron datos válidos para importar precios';
    END IF;

    CREATE TEMP TABLE tmp_inventory_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.id,
        ranked.name
    FROM (
        SELECT
            public.normalize_inventory_sku(i.sku) AS normalized_sku,
            i.id,
            i.name,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(i.sku)
                ORDER BY
                    CASE WHEN i.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN i.supplier_id IS NOT NULL THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(i.price, 0) > 0 THEN 0 ELSE 1 END,
                    i.created_at ASC,
                    i.id ASC
            ) AS rn
        FROM public.inventory i
        WHERE public.normalize_inventory_sku(i.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_inventory_match (normalized_sku);

    CREATE TEMP TABLE tmp_catalog_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.sku,
        ranked.product_name
    FROM (
        SELECT
            public.normalize_inventory_sku(c.sku) AS normalized_sku,
            c.sku,
            c.product_name,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(c.sku)
                ORDER BY
                    CASE WHEN c.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(c.price, 0) > 0 THEN 0 ELSE 1 END,
                    c.updated_at DESC,
                    c.created_at ASC,
                    c.sku ASC
            ) AS rn
        FROM public.inventory_price_catalog c
        WHERE public.normalize_inventory_sku(c.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_catalog_match (normalized_sku);

    CREATE TEMP TABLE tmp_pricing_apply ON COMMIT DROP AS
    SELECT
        coalesce(c.sku, p.sku) AS catalog_sku,
        p.sku AS normalized_sku,
        p.price,
        i.id AS inventory_id,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), c.product_name) AS product_name
    FROM tmp_pricing_import p
    LEFT JOIN tmp_inventory_match i
      ON i.normalized_sku = p.sku
    LEFT JOIN tmp_catalog_match c
      ON c.normalized_sku = p.sku;

    INSERT INTO public.inventory_price_catalog (
        sku,
        product_name,
        price,
        created_at,
        updated_at
    )
    SELECT
        catalog_sku,
        product_name,
        price,
        timezone('utc', now()),
        timezone('utc', now())
    FROM tmp_pricing_apply
    ON CONFLICT (sku) DO UPDATE
    SET product_name = coalesce(excluded.product_name, public.inventory_price_catalog.product_name),
        price = excluded.price,
        updated_at = timezone('utc', now());
    GET DIAGNOSTICS v_stored_count = ROW_COUNT;

    UPDATE public.inventory i
    SET price = a.price
    FROM tmp_pricing_apply a
    WHERE i.id = a.inventory_id;
    GET DIAGNOSTICS v_synced_count = ROW_COUNT;

    SELECT count(*)
    INTO v_catalog_only_count
    FROM tmp_pricing_apply
    WHERE inventory_id IS NULL;

    RETURN jsonb_build_object(
        'stored_count', v_stored_count,
        'synced_inventory_count', v_synced_count,
        'catalog_only_count', v_catalog_only_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_inventory_stock_import(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_inventory_pricing_import(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
