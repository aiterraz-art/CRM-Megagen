CREATE OR REPLACE FUNCTION public.parse_inventory_import_price(p_raw text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_cleaned text;
    v_last_dot integer := 0;
    v_last_comma integer := 0;
    v_last_separator integer := 0;
    v_decimals integer := 0;
    v_normalized text;
    v_parsed numeric;
BEGIN
    v_cleaned := regexp_replace(
        regexp_replace(trim(coalesce(p_raw, '')), '\s+', '', 'g'),
        '[^0-9,\.\-]',
        '',
        'g'
    );

    IF v_cleaned = '' OR v_cleaned = '-' THEN
        RETURN NULL;
    END IF;

    IF v_cleaned ~ '^-?[0-9]+$' THEN
        RETURN greatest(v_cleaned::numeric, 0);
    END IF;

    IF strpos(v_cleaned, '.') > 0 THEN
        v_last_dot := length(v_cleaned) - strpos(reverse(v_cleaned), '.') + 1;
    END IF;

    IF strpos(v_cleaned, ',') > 0 THEN
        v_last_comma := length(v_cleaned) - strpos(reverse(v_cleaned), ',') + 1;
    END IF;

    v_last_separator := greatest(v_last_dot, v_last_comma);

    IF v_last_separator > 0 THEN
        v_decimals := length(v_cleaned) - v_last_separator;

        IF v_decimals BETWEEN 1 AND 2 THEN
            IF v_last_comma > v_last_dot THEN
                v_normalized := replace(replace(v_cleaned, '.', ''), ',', '.');
            ELSE
                v_normalized := replace(v_cleaned, ',', '');
            END IF;

            BEGIN
                v_parsed := v_normalized::numeric;
                RETURN greatest(v_parsed, 0);
            EXCEPTION
                WHEN others THEN
                    NULL;
            END;
        END IF;
    END IF;

    v_normalized := regexp_replace(v_cleaned, '[^0-9\-]', '', 'g');
    IF v_normalized = '' OR v_normalized = '-' THEN
        RETURN NULL;
    END IF;

    BEGIN
        v_parsed := v_normalized::numeric;
        RETURN greatest(v_parsed, 0);
    EXCEPTION
        WHEN others THEN
            RETURN NULL;
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_inventory_pricing_import(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_updated_count integer := 0;
    v_reset_count integer := 0;
    v_unknown_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'jefe', 'facturador') THEN
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
    SELECT i.id, p.price
    FROM public.inventory i
    JOIN tmp_pricing_import p
      ON upper(trim(coalesce(i.sku, ''))) = p.sku;

    SELECT COUNT(*)
    INTO v_unknown_count
    FROM tmp_pricing_import p
    LEFT JOIN public.inventory i
      ON upper(trim(coalesce(i.sku, ''))) = p.sku
    WHERE i.id IS NULL;

    IF NOT EXISTS (SELECT 1 FROM tmp_pricing_apply) THEN
        RAISE EXCEPTION 'Ningún SKU del archivo de precios coincide con el inventario actual';
    END IF;

    UPDATE public.inventory i
    SET price = a.price
    FROM tmp_pricing_apply a
    WHERE i.id = a.id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    UPDATE public.inventory i
    SET price = 0
    WHERE NOT EXISTS (
        SELECT 1
        FROM tmp_pricing_apply a
        WHERE a.id = i.id
    );
    GET DIAGNOSTICS v_reset_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'updated_count', v_updated_count,
        'reset_count', v_reset_count,
        'unknown_skus_count', v_unknown_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.parse_inventory_import_price(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_inventory_pricing_import(jsonb) TO authenticated;
