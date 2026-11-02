-- El importador de stock dejó de actualizar el nombre de los productos existentes
-- desde 20260824000003: al conservar el SKU original también conservaba el nombre.
-- El nombre del archivo vuelve a reemplazar al guardado; el SKU se sigue conservando.
-- El resto de la función es idéntico a la versión de 20260925000031.
CREATE OR REPLACE FUNCTION public.replace_inventory_stock_import(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        t.name AS target_name
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
$function$
;

NOTIFY pgrst, 'reload schema';
