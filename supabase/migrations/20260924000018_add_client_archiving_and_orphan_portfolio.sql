-- Archivado de clientes y saneamiento de la cartera huerfana.
--
-- Contexto: en Megagen 304 clientes pertenecen a vendedores dados de baja y entre todos
-- suman apenas un millon de facturacion historica. Nadie los trabaja, pero siguen
-- contando como cartera y contaminan todos los indicadores. Repartirlos tal cual seria
-- repartir basura, asi que esta migracion tiene que cerrarse antes del primer reparto.
--
-- El criterio es simple: quien alguna vez compro o cotizo se reasigna, porque tiene
-- historial que justifica reactivarlo; quien nunca hizo ni lo uno ni lo otro se archiva.
--
-- Las columnas archived_at, archived_reason y archived_by se crearon en la migracion
-- anterior, porque la cola de candidatos ya tenia que excluir archivados desde el primer
-- dia. Aqui llegan las herramientas que las pueblan y los filtros de cartera.

-- ---------------------------------------------------------------------------------
-- 1. Cartera huerfana
-- ---------------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.vw_orphan_portfolio_clients AS
SELECT
    c.id AS client_id,
    c.name,
    c.rut,
    c.status AS client_status,
    c.created_by AS owner_id,
    coalesce(p.full_name, p.email) AS owner_name,
    lower(coalesce(p.status, 'sin_perfil')) AS owner_status,
    coalesce(a.lifetime_amount, 0) AS lifetime_amount,
    (SELECT count(*) FROM public.quotations q WHERE q.client_id = c.id) AS quotation_count,
    (SELECT count(*) FROM public.orders o WHERE o.client_id = c.id) AS order_count,
    a.last_order_at,
    CASE
        WHEN coalesce(a.lifetime_amount, 0) > 0
          OR EXISTS (SELECT 1 FROM public.quotations q WHERE q.client_id = c.id)
        THEN 'reassign'
        ELSE 'archive'
    END AS disposition
FROM public.clients c
JOIN public.profiles p ON p.id = c.created_by
LEFT JOIN public.vw_client_last_activity a ON a.client_id = c.id
WHERE c.archived_at IS NULL
  AND lower(coalesce(p.status, '')) <> 'active';

DO $$
BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION 'Se requiere PostgreSQL 15 o superior para respetar RLS en la vista';
    END IF;

    EXECUTE 'ALTER VIEW public.vw_orphan_portfolio_clients SET (security_invoker = on)';
END $$;

GRANT SELECT ON public.vw_orphan_portfolio_clients TO authenticated;

-- ---------------------------------------------------------------------------------
-- 2. Archivar
-- ---------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.archive_orphan_clients(uuid[], boolean);

CREATE FUNCTION public.archive_orphan_clients(
    p_owner_ids uuid[] DEFAULT NULL,
    p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_a_archivar integer := 0;
    v_a_reasignar integer := 0;
    v_monto_en_juego numeric := 0;
    v_archivados integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('ARCHIVE_CLIENTS') THEN
        RAISE EXCEPTION 'No tienes permiso para archivar clientes';
    END IF;

    SELECT
        count(*) FILTER (WHERE disposition = 'archive'),
        count(*) FILTER (WHERE disposition = 'reassign'),
        coalesce(sum(lifetime_amount) FILTER (WHERE disposition = 'reassign'), 0)
    INTO v_a_archivar, v_a_reasignar, v_monto_en_juego
    FROM public.vw_orphan_portfolio_clients
    WHERE p_owner_ids IS NULL OR owner_id = ANY(p_owner_ids);

    -- En seco no se escribe nada. Es obligatorio mirarlo antes de tocar cientos de filas:
    -- si algun cliente con facturacion apareciera en el grupo a archivar, el criterio
    -- estaria mal y no debe ejecutarse en firme.
    IF p_dry_run THEN
        RETURN jsonb_build_object(
            'ensayo', true,
            'a_archivar', v_a_archivar,
            'a_reasignar', v_a_reasignar,
            'monto_en_juego', v_monto_en_juego
        );
    END IF;

    UPDATE public.clients c
    SET archived_at = now(),
        archived_reason = 'cartera de vendedor dado de baja, sin compras ni cotizaciones',
        archived_by = v_actor
    FROM public.vw_orphan_portfolio_clients o
    WHERE o.client_id = c.id
      AND o.disposition = 'archive'
      AND (p_owner_ids IS NULL OR o.owner_id = ANY(p_owner_ids));

    GET DIAGNOSTICS v_archivados = ROW_COUNT;

    RETURN jsonb_build_object(
        'ensayo', false,
        'archivados', v_archivados,
        'a_reasignar', v_a_reasignar,
        'monto_en_juego', v_monto_en_juego
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_orphan_clients(uuid[], boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.reassign_orphan_clients(uuid[], uuid);

CREATE FUNCTION public.reassign_orphan_clients(
    p_client_ids uuid[],
    p_new_owner uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reasignados integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT (
        public.auth_user_has_permission('ARCHIVE_CLIENTS')
        OR public.auth_user_has_permission('MANAGE_CLIENTS')
    ) THEN
        RAISE EXCEPTION 'No tienes permiso para reasignar cartera';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = p_new_owner AND lower(coalesce(p.status, '')) = 'active'
    ) THEN
        RAISE EXCEPTION 'El vendedor de destino no existe o no esta activo';
    END IF;

    UPDATE public.clients
    SET created_by = p_new_owner
    WHERE id = ANY(p_client_ids)
      AND archived_at IS NULL;

    GET DIAGNOSTICS v_reasignados = ROW_COUNT;

    RETURN jsonb_build_object('reasignados', v_reasignados, 'nuevo_dueno', p_new_owner);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reassign_orphan_clients(uuid[], uuid) TO authenticated;

-- ---------------------------------------------------------------------------------
-- 3. La busqueda de clientes deja de contar los archivados
-- ---------------------------------------------------------------------------------
--
-- Se reemplaza en sitio, conservando firma y tipo de retorno. Un DROP con firma nueva
-- dejaria la pantalla de clientes sin funcion hasta que el bundle nuevo llegara a todos
-- los navegadores.

CREATE OR REPLACE FUNCTION public.search_clients_paged(
    p_actor_id uuid,
    p_can_view_all boolean DEFAULT false,
    p_portfolio_tab text DEFAULT 'portfolio',
    p_view_mode text DEFAULT 'all',
    p_search text DEFAULT '',
    p_client_type text DEFAULT 'all',
    p_neglect text DEFAULT 'all',
    p_seller text DEFAULT 'all',
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
)
-- Los totales se calculan sobre el conjunto filtrado completo, no sobre la pagina, para
-- que los indicadores de la pantalla sigan significando lo mismo que antes de paginar.
RETURNS TABLE (
    client jsonb,
    last_activity_days integer,
    total_count bigint,
    in_risk_count bigint,
    with_coordinates_count bigint,
    mine_count bigint
)
-- SECURITY INVOKER por omision: RLS sigue decidiendo que filas alcanza cada rol, igual
-- que cuando la consulta se armaba desde el navegador.
LANGUAGE sql
STABLE
AS $$
WITH settings AS (
    SELECT
        coalesce(s.active_warning_days, 15) AS active_warning_days,
        coalesce(s.active_critical_days, 30) AS active_critical_days,
        coalesce(s.prospect_warning_days, 15) AS prospect_warning_days,
        coalesce(s.prospect_critical_days, 30) AS prospect_critical_days,
        coalesce(s.pool_reassignment_days, 30) AS pool_reassignment_days
    FROM public.client_followup_settings s
    WHERE s.id = 'default'
),
effective_settings AS (
    SELECT * FROM settings
    UNION ALL
    SELECT 15, 30, 15, 30, 30
    WHERE NOT EXISTS (SELECT 1 FROM settings)
),
scored AS (
    SELECT
        c.*,
        (lower(coalesce(c.status, '')) = 'prospect'
            OR lower(coalesce(c.status, '')) LIKE 'prospect\_%') AS is_prospect,
        CASE
            WHEN greatest(
                coalesce(c.last_visit_date, '-infinity'::timestamptz),
                coalesce(a.last_quotation_at, '-infinity'::timestamptz),
                coalesce(a.last_order_at, '-infinity'::timestamptz),
                coalesce(a.last_call_at, '-infinity'::timestamptz),
                coalesce(a.last_email_at, '-infinity'::timestamptz),
                coalesce(a.last_whatsapp_at, '-infinity'::timestamptz),
                coalesce(c.created_at, '-infinity'::timestamptz)
            ) = '-infinity'::timestamptz THEN 999
            ELSE greatest(0, floor(extract(epoch FROM (
                now() - greatest(
                    coalesce(c.last_visit_date, '-infinity'::timestamptz),
                    coalesce(a.last_quotation_at, '-infinity'::timestamptz),
                    coalesce(a.last_order_at, '-infinity'::timestamptz),
                    coalesce(a.last_call_at, '-infinity'::timestamptz),
                    coalesce(a.last_email_at, '-infinity'::timestamptz),
                    coalesce(a.last_whatsapp_at, '-infinity'::timestamptz),
                    coalesce(c.created_at, '-infinity'::timestamptz)
                )
            )) / 86400)::int)
        END AS days
    FROM public.clients c
    LEFT JOIN public.vw_client_last_activity a ON a.client_id = c.id
),
filtered AS (
    SELECT s.*
    FROM scored s
    CROSS JOIN effective_settings es
    WHERE
        -- Busqueda por nombre, RUT o direccion
        (
            coalesce(btrim(p_search), '') = ''
            OR s.name ILIKE '%' || btrim(p_search) || '%'
            OR coalesce(s.rut, '') ILIKE '%' || btrim(p_search) || '%'
            OR coalesce(s.address, '') ILIKE '%' || btrim(p_search) || '%'
        )
        -- Filtro por vendedor, disponible solo para quien ve toda la cartera
        AND (
            NOT p_can_view_all
            OR p_seller = 'all'
            OR (p_seller = '__unassigned__' AND s.created_by IS NULL)
            OR (p_seller <> '__unassigned__' AND s.created_by::text = p_seller)
        )
        -- Un cliente archivado deja de contar como cartera y solo se ve en su pestaña.
        AND (
            CASE WHEN p_portfolio_tab = 'archived'
                 THEN s.archived_at IS NOT NULL
                 ELSE s.archived_at IS NULL END
        )
        AND (
            CASE
                WHEN p_portfolio_tab = 'pool' THEN
                    -- Bolsa de prospectos abandonados, disponible para reasignar.
                    -- La lista de estados reproduce la que acotaba la consulta anterior:
                    -- un estado nuevo de prospecto no debe entrar aqui sin decidirlo.
                    lower(coalesce(s.status, '')) IN (
                        'prospect', 'prospect_new', 'prospect_contacted', 'prospect_evaluating'
                    )
                    AND s.days >= es.pool_reassignment_days
                WHEN p_can_view_all THEN
                    (p_view_mode = 'all' OR s.created_by = p_actor_id)
                    AND (
                        p_client_type = 'all'
                        OR (p_client_type = 'active' AND NOT s.is_prospect)
                        OR (p_client_type = 'prospect' AND s.is_prospect)
                    )
                    AND (
                        p_neglect = 'all'
                        OR s.days >= CASE WHEN s.is_prospect
                            THEN es.prospect_warning_days
                            ELSE es.active_warning_days END
                    )
                ELSE
                    s.created_by = p_actor_id
                    AND (
                        p_client_type = 'all'
                        OR (p_client_type = 'active' AND NOT s.is_prospect)
                        OR (p_client_type = 'prospect' AND s.is_prospect)
                    )
                    AND (
                        p_neglect = 'all'
                        OR s.days >= CASE WHEN s.is_prospect
                            THEN es.prospect_warning_days
                            ELSE es.active_warning_days END
                    )
            END
        )
)
SELECT
    to_jsonb(f) - 'is_prospect' - 'days' AS client,
    f.days AS last_activity_days,
    count(*) OVER () AS total_count,
    count(*) FILTER (
        WHERE f.days >= CASE WHEN f.is_prospect
            THEN (SELECT prospect_warning_days FROM effective_settings)
            ELSE (SELECT active_warning_days FROM effective_settings) END
    ) OVER () AS in_risk_count,
    count(*) FILTER (WHERE f.lat IS NOT NULL AND f.lng IS NOT NULL) OVER () AS with_coordinates_count,
    count(*) FILTER (WHERE f.created_by = p_actor_id) OVER () AS mine_count
FROM filtered f
ORDER BY f.name
LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
OFFSET greatest(0, coalesce(p_offset, 0));
$$;
