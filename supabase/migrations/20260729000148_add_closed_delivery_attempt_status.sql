DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumtypid = 'public.delivery_item_status'::regtype
          AND enumlabel = 'closed'
    ) THEN
        ALTER TYPE public.delivery_item_status ADD VALUE 'closed';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_delivery_route_item_closed(
    p_route_item_id uuid,
    p_proof_photo_url text DEFAULT NULL,
    p_attempted_at timestamptz DEFAULT now(),
    p_lat double precision DEFAULT NULL,
    p_lng double precision DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_route_item public.route_items%ROWTYPE;
    v_route public.delivery_routes%ROWTYPE;
    v_clean_notes text := nullif(btrim(coalesce(p_notes, '')), '');
    v_final_notes text;
    v_attempted_at timestamptz := coalesce(p_attempted_at, now());
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    SELECT *
    INTO v_route_item
    FROM public.route_items
    WHERE id = p_route_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El item de ruta indicado no existe';
    END IF;

    IF v_route_item.order_id IS NULL THEN
        RAISE EXCEPTION 'El item de ruta no tiene pedido asociado';
    END IF;

    SELECT *
    INTO v_route
    FROM public.delivery_routes
    WHERE id = v_route_item.route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La ruta del pedido no existe';
    END IF;

    IF (
        (v_actor_role = 'driver' AND v_route.driver_id <> v_actor_id)
        OR (v_actor_role NOT IN ('driver', 'admin', 'jefe', 'facturador', 'tesorero'))
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para cerrar esta entrega';
    END IF;

    IF lower(coalesce(v_route_item.status::text, '')) = 'delivered' THEN
        RAISE EXCEPTION 'El pedido ya fue marcado como entregado';
    END IF;

    v_final_notes := nullif(btrim(coalesce(v_route_item.notes, '')), '');
    IF position('cliente cerrado' in lower(coalesce(v_final_notes, ''))) = 0 THEN
        v_final_notes := concat_ws(E'\n', v_final_notes, 'Cliente cerrado');
    END IF;
    IF v_clean_notes IS NOT NULL THEN
        v_final_notes := concat_ws(E'\n', v_final_notes, v_clean_notes);
    END IF;
    v_final_notes := nullif(btrim(coalesce(v_final_notes, '')), '');

    UPDATE public.route_items
    SET status = 'closed',
        proof_photo_url = coalesce(nullif(btrim(coalesce(p_proof_photo_url, '')), ''), proof_photo_url),
        delivered_at = v_attempted_at,
        delivered_lat = coalesce(p_lat, delivered_lat),
        delivered_lng = coalesce(p_lng, delivered_lng),
        notes = v_final_notes
    WHERE id = p_route_item_id;

    UPDATE public.orders
    SET route_id = NULL,
        delivery_status = 'assigned',
        delivered_at = NULL,
        delivery_photo_url = NULL
    WHERE id = v_route_item.order_id;

    UPDATE public.dispatch_queue_items
    SET status = 'queued',
        route_id = NULL,
        routed_at = NULL,
        delivered_at = NULL,
        cancelled_at = NULL,
        notes = v_final_notes
    WHERE order_id = v_route_item.order_id;

    RETURN jsonb_build_object(
        'route_item_id', v_route_item.id,
        'order_id', v_route_item.order_id,
        'route_id', v_route.id,
        'status', 'closed',
        'attempted_at', v_attempted_at
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_delivery_route_item_closed(uuid, text, timestamptz, double precision, double precision, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
