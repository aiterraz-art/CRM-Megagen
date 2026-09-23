-- Busqueda paginada de clientes, resuelta en la base.
--
-- Contexto: la cartera se cargaba entera en el navegador y se filtraba alli. El coste
-- crece con el tamano de la cartera: transferencia, memoria y filas dibujadas. Mover la
-- busqueda, los filtros y el recorte de pagina a SQL deja ese coste constante.
--
-- Las reglas replicadas aqui son exactamente las que aplicaba el navegador. Cualquier
-- divergencia seria una regresion silenciosa, asi que conviene tratarlas como un
-- contrato con la pantalla de clientes.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent depende de un diccionario y por eso no es IMMUTABLE, lo que impide usarla en
-- un indice. La forma de dos argumentos fija el diccionario y permite envolverla.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT public.unaccent('public.unaccent'::regdictionary, value)
$$;

-- Equivalente SQL de normalizeText en src/utils/clientDuplicates.ts: minusculas, sin
-- acentos, sin signos, espacios colapsados. Ambas definiciones deben moverse juntas.
CREATE OR REPLACE FUNCTION public.normalize_client_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT btrim(
        regexp_replace(
            regexp_replace(
                lower(public.immutable_unaccent(coalesce(value, ''))),
                '[^a-z0-9[:space:]]', ' ', 'g'
            ),
            '[[:space:]]+', ' ', 'g'
        )
    )
$$;

-- Sin indice sobre el nombre normalizado: la deteccion de duplicados agrupa sobre toda
-- la tabla, de modo que un recorrido completo es inevitable y a este volumen se resuelve
-- de inmediato. Crearlo ademas exigiria ser propietario de la tabla. Conviene revisarlo
-- si la cartera llega al orden de cientos de miles de clientes.

-- Grupos de clientes duplicados.
--
-- compareClientsForDuplicate exige el mismo nombre normalizado y ese solo motivo ya
-- puntua 8 sobre un umbral de 6, de modo que toda pareja con el mismo nombre normalizado
-- es duplicada. Los demas motivos enriquecen la explicacion pero no cambian la decision,
-- asi que agrupar por nombre normalizado reproduce el algoritmo completo.
DROP VIEW IF EXISTS public.vw_client_duplicate_names;

CREATE VIEW public.vw_client_duplicate_names AS
SELECT
    public.normalize_client_name(c.name) AS normalized_name,
    count(*) AS client_count,
    array_agg(c.id ORDER BY c.created_at) AS client_ids
FROM public.clients c
WHERE public.normalize_client_name(c.name) <> ''
GROUP BY public.normalize_client_name(c.name)
HAVING count(*) > 1;

DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 150000 THEN
        EXECUTE 'ALTER VIEW public.vw_client_duplicate_names SET (security_invoker = on)';
    ELSE
        RAISE EXCEPTION 'Se requiere PostgreSQL 15 o superior para respetar RLS en la vista';
    END IF;
END $$;

GRANT SELECT ON public.vw_client_duplicate_names TO authenticated;

DROP FUNCTION IF EXISTS public.search_clients_paged(uuid, boolean, text, text, text, text, text, text, integer, integer);

CREATE FUNCTION public.search_clients_paged(
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

GRANT EXECUTE ON FUNCTION public.search_clients_paged(uuid, boolean, text, text, text, text, text, text, integer, integer) TO authenticated;
