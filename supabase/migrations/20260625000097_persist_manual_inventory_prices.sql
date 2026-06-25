CREATE TABLE IF NOT EXISTS public.inventory_price_catalog (
    sku text PRIMARY KEY,
    product_name text NULL,
    price numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS inventory_price_catalog_updated_at_idx
    ON public.inventory_price_catalog (updated_at DESC);

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

CREATE OR REPLACE FUNCTION public.set_inventory_manual_price(
    p_inventory_id uuid,
    p_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_item public.inventory%ROWTYPE;
    v_next_price numeric := greatest(coalesce(p_price, 0), 0);
    v_sku text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = 'MANAGE_INVENTORY'
        WHERE p.id = v_actor_id
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para actualizar precios';
    END IF;

    SELECT *
    INTO v_item
    FROM public.inventory
    WHERE id = p_inventory_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado';
    END IF;

    UPDATE public.inventory
    SET price = v_next_price
    WHERE id = v_item.id;

    v_sku := upper(trim(coalesce(v_item.sku, '')));

    IF v_sku <> '' THEN
        INSERT INTO public.inventory_price_catalog (
            sku,
            product_name,
            price,
            created_at,
            updated_at
        )
        VALUES (
            v_sku,
            nullif(trim(coalesce(v_item.name, '')), ''),
            v_next_price,
            timezone('utc', now()),
            timezone('utc', now())
        )
        ON CONFLICT (sku) DO UPDATE
        SET product_name = COALESCE(EXCLUDED.product_name, public.inventory_price_catalog.product_name),
            price = EXCLUDED.price,
            updated_at = timezone('utc', now());
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'inventory_id', v_item.id,
        'sku', nullif(v_sku, ''),
        'price', v_next_price
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_inventory_price_catalog_from_inventory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_inventory_manual_price(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
