INSERT INTO public.role_permissions (role, permission)
VALUES
    ('admin', 'MANAGE_INVENTORY'),
    ('admin', 'MANAGE_PRICING'),
    ('bodega', 'MANAGE_INVENTORY'),
    ('bodega', 'MANAGE_PRICING'),
    ('facturador', 'MANAGE_INVENTORY'),
    ('facturador', 'MANAGE_PRICING'),
    ('tesorero', 'MANAGE_INVENTORY'),
    ('tesorero', 'MANAGE_PRICING'),
    ('jefe', 'MANAGE_INVENTORY')
ON CONFLICT (role, permission) DO NOTHING;

DELETE FROM public.role_permissions
WHERE permission = 'MANAGE_PRICING'
  AND role IN ('seller', 'driver', 'supervisor', 'jefe');

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
         AND rp.permission = 'MANAGE_PRICING'
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

GRANT EXECUTE ON FUNCTION public.set_inventory_manual_price(uuid, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
