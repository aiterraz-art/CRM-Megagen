CREATE OR REPLACE FUNCTION public.start_delivery_routes(p_route_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_started_count integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    IF coalesce(array_length(p_route_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Debes indicar al menos una ruta';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = ANY (p_route_ids)
          AND (
              (v_actor_role = 'driver' AND r.driver_id <> v_actor_id)
              OR (v_actor_role NOT IN ('driver', 'admin', 'facturador', 'tesorero'))
          )
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para iniciar una o más rutas';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = ANY (p_route_ids)
          AND lower(coalesce(r.status::text, '')) <> 'draft'
    ) THEN
        RAISE EXCEPTION 'Solo se pueden iniciar rutas en borrador';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = ANY (p_route_ids)
        GROUP BY r.driver_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Solo se puede iniciar una ruta por repartidor a la vez';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes selected_routes
        JOIN public.delivery_routes active_routes
          ON active_routes.driver_id = selected_routes.driver_id
         AND lower(coalesce(active_routes.status::text, '')) = 'in_progress'
         AND active_routes.id <> selected_routes.id
        WHERE selected_routes.id = ANY (p_route_ids)
    ) THEN
        RAISE EXCEPTION 'El repartidor ya tiene una ruta en progreso. Debe terminarla antes de iniciar otra.';
    END IF;

    UPDATE public.delivery_routes
    SET status = 'in_progress'
    WHERE id = ANY (p_route_ids)
      AND status = 'draft';

    GET DIAGNOSTICS v_started_count = ROW_COUNT;

    UPDATE public.orders o
    SET delivery_status = 'out_for_delivery'
    FROM public.route_items ri
    WHERE ri.route_id = ANY (p_route_ids)
      AND ri.order_id = o.id
      AND lower(coalesce(o.delivery_status::text, '')) <> 'delivered';

    RETURN jsonb_build_object(
        'started_routes', v_started_count,
        'route_ids', to_jsonb(p_route_ids)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_delivery_route(p_route_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_route public.delivery_routes%ROWTYPE;
    v_remaining_count integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    SELECT *
    INTO v_route
    FROM public.delivery_routes
    WHERE id = p_route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La ruta indicada no existe';
    END IF;

    IF (
        (v_actor_role = 'driver' AND v_route.driver_id <> v_actor_id)
        OR (v_actor_role NOT IN ('driver', 'admin', 'facturador', 'tesorero'))
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para terminar esta ruta';
    END IF;

    IF lower(coalesce(v_route.status::text, '')) = 'completed' THEN
        RETURN jsonb_build_object(
            'route_id', v_route.id,
            'status', 'completed'
        );
    END IF;

    IF lower(coalesce(v_route.status::text, '')) <> 'in_progress' THEN
        RAISE EXCEPTION 'Solo se pueden terminar rutas en progreso';
    END IF;

    SELECT count(*)
    INTO v_remaining_count
    FROM public.route_items
    WHERE route_id = p_route_id
      AND lower(coalesce(status::text, '')) IN ('pending', 'rescheduled', 'failed');

    IF v_remaining_count > 0 THEN
        RAISE EXCEPTION 'Aún quedan pedidos pendientes en esta ruta';
    END IF;

    UPDATE public.delivery_routes
    SET status = 'completed'
    WHERE id = p_route_id;

    RETURN jsonb_build_object(
        'route_id', v_route.id,
        'status', 'completed'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_delivery_routes(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_delivery_route(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
