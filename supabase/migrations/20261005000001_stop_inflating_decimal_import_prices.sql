-- The importer already parses the spreadsheet price into a JSON number, but this
-- function re-parsed it as text. A number like 3343.07096774 has more than two
-- decimals, so the text parser stripped the dot as a thousands separator and
-- stored 334307096774. Numbers are now taken as-is (rounded to cents); only
-- text values still go through the text parser.

CREATE OR REPLACE FUNCTION public.replace_inventory_pricing_import(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            CASE
                WHEN jsonb_typeof(value->'price') = 'number'
                    THEN round(greatest((value->'price')::numeric, 0), 2)
                ELSE public.parse_inventory_import_price(value->>'price')
            END AS price
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
$function$
;
