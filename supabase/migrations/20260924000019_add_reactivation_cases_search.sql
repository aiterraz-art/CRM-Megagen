-- Bandeja de casos de reactivacion.
--
-- Devuelve la pagina de casos junto con los indicadores del ambito completo, no de la
-- pagina, calculados con funciones de ventana en la misma consulta. Es el mismo patron de
-- la busqueda de clientes y de cotizaciones: el coste de abrir la pantalla no crece con
-- el numero de casos.

DROP FUNCTION IF EXISTS public.search_reactivation_cases_paged(uuid, boolean, text, text, text, integer, integer);

CREATE FUNCTION public.search_reactivation_cases_paged(
    p_actor_id uuid,
    p_view_all boolean DEFAULT false,
    p_status text DEFAULT 'open',
    p_segment text DEFAULT 'all',
    p_search text DEFAULT '',
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    case_row jsonb,
    total_count bigint,
    open_count bigint,
    won_month_count bigint,
    won_month_amount numeric,
    stale_count bigint
)
-- SECURITY INVOKER por omision: RLS ya limita cada vendedor a sus propios casos, asi que
-- p_view_all solo sirve para que un jefe pueda mirar su propia bandeja.
LANGUAGE sql
STABLE
AS $$
WITH ajustes AS (
    SELECT coalesce(max(reactivation_stale_case_days), 7) AS stale_days
    FROM public.client_followup_settings WHERE id = 'default'
),
ambito AS (
    -- Todos los casos que alcanza quien consulta, sin aplicar los filtros de pantalla:
    -- de aqui salen los indicadores de la cabecera.
    SELECT c.*
    FROM public.client_reactivation_cases c
    WHERE p_view_all OR c.assigned_to = p_actor_id
),
indicadores AS (
    SELECT
        count(*) FILTER (WHERE a.status = 'open') AS open_count,
        count(*) FILTER (
            WHERE a.status = 'won'
              AND a.won_at >= date_trunc('month', now())
        ) AS won_month_count,
        coalesce(sum(a.won_amount) FILTER (
            WHERE a.status = 'won'
              AND a.won_at >= date_trunc('month', now())
        ), 0) AS won_month_amount,
        count(*) FILTER (
            WHERE a.status = 'open'
              AND coalesce(a.last_attempt_at, a.opened_at) < now() - make_interval(days => (SELECT stale_days FROM ajustes))
        ) AS stale_count
    FROM ambito a
),
filtrados AS (
    SELECT
        a.*,
        cl.name AS client_name,
        cl.phone AS client_phone,
        cl.email AS client_email,
        cl.comuna AS client_comuna,
        cl.rut AS client_rut,
        coalesce(p.full_name, p.email) AS assignee_name
    FROM ambito a
    JOIN public.clients cl ON cl.id = a.client_id
    LEFT JOIN public.profiles p ON p.id = a.assigned_to
    WHERE (p_status = 'all' OR a.status = p_status)
      AND (p_segment = 'all' OR a.segment = p_segment)
      AND (
          coalesce(btrim(p_search), '') = ''
          OR cl.name ILIKE '%' || btrim(p_search) || '%'
          OR coalesce(cl.rut, '') ILIKE '%' || btrim(p_search) || '%'
          OR coalesce(cl.comuna, '') ILIKE '%' || btrim(p_search) || '%'
      )
)
SELECT
    to_jsonb(f) AS case_row,
    count(*) OVER () AS total_count,
    (SELECT open_count FROM indicadores) AS open_count,
    (SELECT won_month_count FROM indicadores) AS won_month_count,
    (SELECT won_month_amount FROM indicadores) AS won_month_amount,
    (SELECT stale_count FROM indicadores) AS stale_count
FROM filtrados f
-- Arriba, el silencio mas caro.
ORDER BY f.lifetime_amount_snapshot DESC NULLS LAST,
         f.days_without_purchase_snapshot DESC NULLS LAST,
         f.client_name
LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
OFFSET greatest(0, coalesce(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.search_reactivation_cases_paged(uuid, boolean, text, text, text, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------------
-- Guarda contra una bandeja invisible
-- ---------------------------------------------------------------------------------
--
-- Al probar la bandeja con datos reales aparecio un fallo silencioso: si se asigna sin
-- traspasar la propiedad del cliente, el caso se crea pero el vendedor ve la bandeja
-- vacia. La causa es que clients tiene RLS y la politica "Sellers view own clients" lo
-- limita a su propia cartera, de modo que la union con el cliente descarta la fila.
--
-- Un jefe o un admin si alcanzan toda la cartera, asi que para ellos la opcion sigue
-- teniendo sentido. Para un vendedor no: se rechaza en lugar de entregar una bandeja
-- vacia sin explicacion.

CREATE OR REPLACE FUNCTION public.assign_reactivation_cases(
    p_client_ids uuid[],
    p_assigned_to uuid,
    p_transfer_ownership boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_solicitados integer := coalesce(array_length(p_client_ids, 1), 0);
    v_creados integer := 0;
    v_rol_destino text;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('MANAGE_REACTIVATION') THEN
        RAISE EXCEPTION 'No tienes permiso para repartir casos de reactivacion';
    END IF;

    IF v_solicitados = 0 THEN
        RAISE EXCEPTION 'Debes indicar al menos un cliente';
    END IF;

    IF v_solicitados > 500 THEN
        RAISE EXCEPTION 'El lote no puede superar los 500 clientes (recibidos %)', v_solicitados;
    END IF;

    SELECT lower(coalesce(p.role, '')) INTO v_rol_destino
    FROM public.profiles p
    WHERE p.id = p_assigned_to AND lower(coalesce(p.status, '')) = 'active';

    IF v_rol_destino IS NULL THEN
        RAISE EXCEPTION 'El vendedor de destino no existe o no esta activo';
    END IF;

    IF NOT p_transfer_ownership AND v_rol_destino IN ('seller', 'vendedor') THEN
        RAISE EXCEPTION 'Un vendedor solo ve los clientes de su propia cartera. Sin traspasar la propiedad, los casos quedarian invisibles para el.';
    END IF;

    INSERT INTO public.client_reactivation_cases (
        client_id, assigned_to, assigned_by, previous_owner_id, segment,
        lifetime_amount_snapshot, last_order_at_snapshot, last_contact_at_snapshot,
        days_without_purchase_snapshot
    )
    SELECT
        v.client_id, p_assigned_to, v_actor, v.owner_id, v.segment,
        v.lifetime_amount, v.last_order_at, v.last_contact_at,
        v.days_without_purchase
    FROM public.vw_client_reactivation_candidates v
    WHERE v.client_id = ANY(p_client_ids)
      AND v.segment IS NOT NULL
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_creados = ROW_COUNT;

    IF p_transfer_ownership THEN
        UPDATE public.clients
        SET created_by = p_assigned_to
        WHERE id = ANY(p_client_ids)
          AND created_by IS DISTINCT FROM p_assigned_to;
    END IF;

    RETURN jsonb_build_object(
        'solicitados', v_solicitados,
        'creados', v_creados,
        'omitidos', v_solicitados - v_creados,
        'propiedad_traspasada', p_transfer_ownership
    );
END;
$$;
