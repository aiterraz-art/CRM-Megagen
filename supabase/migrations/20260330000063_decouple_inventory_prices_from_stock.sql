CREATE TABLE IF NOT EXISTS public.inventory_price_catalog (
    sku text PRIMARY KEY,
    product_name text NULL,
    price numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS inventory_price_catalog_updated_at_idx
    ON public.inventory_price_catalog (updated_at DESC);

INSERT INTO public.inventory_price_catalog (sku, product_name, price)
SELECT
    upper(trim(coalesce(i.sku, ''))) AS sku,
    nullif(trim(coalesce(i.name, '')), '') AS product_name,
    greatest(coalesce(i.price, 0), 0) AS price
FROM public.inventory i
WHERE upper(trim(coalesce(i.sku, ''))) <> ''
ON CONFLICT (sku) DO UPDATE
SET product_name = COALESCE(EXCLUDED.product_name, public.inventory_price_catalog.product_name);

CREATE OR REPLACE FUNCTION public.sync_inventory_price_catalog_from_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sku text;
BEGIN
    v_sku := upper(trim(coalesce(NEW.sku, '')));

    IF v_sku = '' THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.inventory_price_catalog (
        sku,
        product_name,
        price,
        created_at,
        updated_at
    )
    VALUES (
        v_sku,
        nullif(trim(coalesce(NEW.name, '')), ''),
        greatest(coalesce(NEW.price, 0), 0),
        timezone('utc', now()),
        timezone('utc', now())
    )
    ON CONFLICT (sku) DO UPDATE
    SET product_name = COALESCE(EXCLUDED.product_name, public.inventory_price_catalog.product_name),
        price = greatest(coalesce(EXCLUDED.price, 0), 0),
        updated_at = timezone('utc', now());

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_inventory_price_catalog_from_inventory ON public.inventory;
CREATE TRIGGER sync_inventory_price_catalog_from_inventory
AFTER INSERT OR UPDATE OF sku, name, price
ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.sync_inventory_price_catalog_from_inventory();

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

DROP FUNCTION IF EXISTS public.replace_inventory_pricing_import(jsonb);

CREATE OR REPLACE FUNCTION public.replace_inventory_pricing_import(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_stored_count integer := 0;
    v_synced_count integer := 0;
    v_catalog_only_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'jefe', 'facturador', 'tesorero') THEN
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
            upper(trim(coalesce(value->>'sku', ''))) AS sku,
            public.parse_inventory_import_price(value->>'price') AS price
        FROM jsonb_array_elements(p_items) AS value
    ) src
    WHERE sku <> ''
      AND price IS NOT NULL
    ORDER BY sku;

    IF NOT EXISTS (SELECT 1 FROM tmp_pricing_import) THEN
        RAISE EXCEPTION 'No se encontraron datos válidos para importar precios';
    END IF;

    CREATE TEMP TABLE tmp_pricing_apply ON COMMIT DROP AS
    SELECT
        p.sku,
        p.price,
        i.id AS inventory_id,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), c.product_name) AS product_name
    FROM tmp_pricing_import p
    LEFT JOIN public.inventory i
      ON upper(trim(coalesce(i.sku, ''))) = p.sku
    LEFT JOIN public.inventory_price_catalog c
      ON c.sku = p.sku;

    INSERT INTO public.inventory_price_catalog (
        sku,
        product_name,
        price,
        created_at,
        updated_at
    )
    SELECT
        sku,
        product_name,
        price,
        timezone('utc', now()),
        timezone('utc', now())
    FROM tmp_pricing_apply
    ON CONFLICT (sku) DO UPDATE
    SET product_name = COALESCE(EXCLUDED.product_name, public.inventory_price_catalog.product_name),
        price = EXCLUDED.price,
        updated_at = timezone('utc', now());
    GET DIAGNOSTICS v_stored_count = ROW_COUNT;

    UPDATE public.inventory i
    SET price = a.price
    FROM tmp_pricing_apply a
    WHERE i.id = a.inventory_id;
    GET DIAGNOSTICS v_synced_count = ROW_COUNT;

    SELECT COUNT(*)
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

GRANT SELECT ON public.inventory_price_catalog TO authenticated;
GRANT INSERT, UPDATE ON public.inventory_price_catalog TO service_role;

GRANT EXECUTE ON FUNCTION public.sync_inventory_price_catalog_from_inventory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_inventory_stock_import(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_inventory_pricing_import(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
