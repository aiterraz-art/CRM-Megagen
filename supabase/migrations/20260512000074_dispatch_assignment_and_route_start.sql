DROP FUNCTION IF EXISTS public.create_dispatch_routes_from_queue(jsonb);
CREATE OR REPLACE FUNCTION public.create_dispatch_routes_from_queue(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_group record;
    v_route_id uuid;
    v_created_routes integer := 0;
    v_route_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'facturador', 'tesorero') THEN
        RAISE EXCEPTION 'No tienes permisos para crear rutas de despacho';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Debes enviar al menos un item para crear rutas';
    END IF;

    CREATE TEMP TABLE tmp_route_payload (
        queue_item_id uuid PRIMARY KEY,
        driver_id uuid NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_route_payload (queue_item_id, driver_id)
    SELECT DISTINCT ON (queue_item_id)
        nullif(trim(value->>'queue_item_id'), '')::uuid,
        nullif(trim(value->>'driver_id'), '')::uuid
    FROM jsonb_array_elements(p_items) AS rows(value)
    WHERE nullif(trim(value->>'queue_item_id'), '') IS NOT NULL
      AND nullif(trim(value->>'driver_id'), '') IS NOT NULL;

    IF NOT EXISTS (SELECT 1 FROM tmp_route_payload) THEN
        RAISE EXCEPTION 'No se encontraron asignaciones válidas';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS rows(value)
        WHERE nullif(trim(value->>'queue_item_id'), '') IS NULL
           OR nullif(trim(value->>'driver_id'), '') IS NULL
    ) THEN
        RAISE EXCEPTION 'Todas las filas requieren queue_item_id y driver_id';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_route_payload p
        LEFT JOIN public.dispatch_queue_items q ON q.id = p.queue_item_id
        WHERE q.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Uno o más items de cola no existen';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_route_payload p
        JOIN public.dispatch_queue_items q ON q.id = p.queue_item_id
        WHERE q.status <> 'queued'
    ) THEN
        RAISE EXCEPTION 'Solo se pueden enrutar items en estado queued';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_route_payload p
        LEFT JOIN public.profiles d ON d.id = p.driver_id
        WHERE d.id IS NULL OR lower(coalesce(d.role, '')) <> 'driver'
    ) THEN
        RAISE EXCEPTION 'Todos los drivers asignados deben existir y tener rol driver';
    END IF;

    FOR v_group IN
        SELECT
            p.driver_id,
            coalesce(pr.full_name, split_part(coalesce(pr.email, ''), '@', 1), 'Repartidor') AS driver_name
        FROM tmp_route_payload p
        JOIN public.profiles pr ON pr.id = p.driver_id
        GROUP BY p.driver_id, coalesce(pr.full_name, split_part(coalesce(pr.email, ''), '@', 1), 'Repartidor')
    LOOP
        INSERT INTO public.delivery_routes (name, driver_id, status, created_at)
        VALUES (
            'Ruta ' || v_group.driver_name || ' - ' || to_char(now(), 'DD/MM/YYYY'),
            v_group.driver_id,
            'draft',
            now()
        )
        RETURNING id INTO v_route_id;

        INSERT INTO public.route_items (route_id, order_id, sequence_order, status, created_at)
        SELECT
            v_route_id,
            q.order_id,
            row_number() OVER (ORDER BY q.imported_at, q.id),
            'pending',
            now()
        FROM public.dispatch_queue_items q
        JOIN tmp_route_payload p ON p.queue_item_id = q.id
        WHERE p.driver_id = v_group.driver_id;

        UPDATE public.orders o
        SET route_id = v_route_id,
            delivery_status = 'assigned'
        FROM public.dispatch_queue_items q
        JOIN tmp_route_payload p ON p.queue_item_id = q.id
        WHERE p.driver_id = v_group.driver_id
          AND o.id = q.order_id;

        UPDATE public.dispatch_queue_items q
        SET route_id = v_route_id,
            assigned_driver_id = v_group.driver_id,
            status = 'routed',
            routed_at = now()
        FROM tmp_route_payload p
        WHERE p.queue_item_id = q.id
          AND p.driver_id = v_group.driver_id;

        v_created_routes := v_created_routes + 1;
        v_route_ids := array_append(v_route_ids, v_route_id);
    END LOOP;

    RETURN jsonb_build_object(
        'created_routes', v_created_routes,
        'route_ids', to_jsonb(v_route_ids)
    );
END;
$$;

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
      AND lower(coalesce(o.delivery_status, '')) <> 'delivered';

    RETURN jsonb_build_object(
        'started_routes', v_started_count,
        'route_ids', to_jsonb(p_route_ids)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_dispatch_routes_from_queue(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_delivery_routes(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
