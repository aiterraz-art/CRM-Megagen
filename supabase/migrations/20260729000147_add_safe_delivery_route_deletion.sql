CREATE OR REPLACE FUNCTION public.delete_delivery_route(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_route public.delivery_routes%ROWTYPE;
    v_delivered_items integer := 0;
    v_queue_items integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    IF v_actor_role NOT IN ('admin', 'manager', 'jefe', 'facturador', 'tesorero') THEN
        RAISE EXCEPTION 'No tienes permisos para eliminar esta ruta';
    END IF;

    SELECT *
    INTO v_route
    FROM public.delivery_routes
    WHERE id = p_route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La ruta indicada no existe';
    END IF;

    SELECT count(*)
    INTO v_delivered_items
    FROM public.route_items
    WHERE route_id = p_route_id
      AND lower(coalesce(status::text, '')) = 'delivered';

    IF v_delivered_items > 0 THEN
        RAISE EXCEPTION 'No se puede eliminar una ruta que ya tiene entregas registradas';
    END IF;

    UPDATE public.dispatch_queue_items
    SET route_id = NULL,
        assigned_driver_id = NULL,
        status = 'queued',
        routed_at = NULL,
        delivered_at = NULL,
        notes = CASE
            WHEN coalesce(notes, '') = '' THEN 'Ruta eliminada manualmente'
            ELSE notes || ' | Ruta eliminada manualmente'
        END
    WHERE route_id = p_route_id;

    GET DIAGNOSTICS v_queue_items = ROW_COUNT;

    UPDATE public.orders
    SET route_id = NULL,
        delivery_status = NULL
    WHERE route_id = p_route_id
      AND lower(coalesce(delivery_status::text, '')) <> 'delivered';

    DELETE FROM public.delivery_routes
    WHERE id = p_route_id;

    RETURN jsonb_build_object(
        'route_id', p_route_id,
        'released_queue_items', v_queue_items,
        'deleted', true
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_delivery_route(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
