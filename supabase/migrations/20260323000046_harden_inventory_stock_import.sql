DROP FUNCTION IF EXISTS public.replace_inventory_stock_import(jsonb);

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

    IF v_actor_role NOT IN ('admin', 'jefe', 'facturador') THEN
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
        coalesce(i.price, 0) AS price,
        coalesce(i.category, 'General') AS category
    FROM tmp_stock_import t
    LEFT JOIN public.inventory i
      ON upper(trim(coalesce(i.sku, ''))) = t.sku;

    INSERT INTO public.inventory (id, sku, name, stock_qty, price, category)
    SELECT
        coalesce(existing_id, gen_random_uuid()),
        sku,
        name,
        stock_qty,
        price,
        category
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
    WHERE NOT EXISTS (
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

GRANT EXECUTE ON FUNCTION public.replace_inventory_stock_import(jsonb) TO authenticated;
