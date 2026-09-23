-- Busqueda paginada de cotizaciones, resuelta en la base.
--
-- El modulo cargaba todas las cotizaciones con su cliente embebido, unos 2 MB por carga
-- con el volumen actual, y filtraba en el navegador. Mover la busqueda, el filtro de
-- estado, el orden y el recorte de pagina a SQL deja ese coste constante.
--
-- Hay dos ambitos distintos y conviene no confundirlos:
--   - Los indicadores de la cabecera describen TODO lo que el usuario puede ver, sin
--     aplicar el filtro de estado ni la busqueda. Asi se comportaban antes.
--   - La pagina devuelta si aplica ambos filtros.

DROP FUNCTION IF EXISTS public.search_quotations_paged(uuid, boolean, boolean, text, text, integer, integer);

CREATE FUNCTION public.search_quotations_paged(
    p_actor_id uuid,
    p_can_view_all boolean DEFAULT false,
    p_is_seller boolean DEFAULT false,
    p_status text DEFAULT 'All',
    p_search text DEFAULT '',
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    quotation jsonb,
    total_count bigint,
    scope_total bigint,
    scope_drafts bigint,
    scope_sent bigint,
    scope_approved bigint,
    scope_total_amount numeric,
    pending_mine_count bigint
)
-- SECURITY INVOKER por omision: RLS sigue decidiendo que cotizaciones alcanza cada rol.
LANGUAGE sql
STABLE
AS $$
WITH scope AS (
    SELECT q.*
    FROM public.quotations q
    WHERE p_can_view_all OR q.seller_id = p_actor_id
),
scope_stats AS (
    SELECT
        count(*) AS scope_total,
        count(*) FILTER (WHERE s.status = 'draft') AS scope_drafts,
        count(*) FILTER (WHERE s.status = 'sent') AS scope_sent,
        count(*) FILTER (WHERE s.status = 'approved') AS scope_approved,
        coalesce(sum(round(coalesce(s.total_amount, 0))), 0) AS scope_total_amount
    FROM scope s
),
filtered AS (
    SELECT
        s.*,
        c.id AS c_id,
        -- La aprobacion mas reciente solo se usa para ordenar y para contar pendientes.
        -- El detalle completo lo sigue trayendo la pantalla, ya solo para la pagina.
        ap.status AS approval_status
    FROM scope s
    LEFT JOIN public.clients c ON c.id = s.client_id
    LEFT JOIN LATERAL (
        SELECT ar.status
        FROM public.approval_requests ar
        WHERE ar.approval_type = 'extra_discount'
          AND ar.entity_id = s.id
        ORDER BY ar.requested_at DESC
        LIMIT 1
    ) ap ON true
    WHERE
        (p_status = 'All' OR s.status = p_status)
        AND (
            coalesce(btrim(p_search), '') = ''
            -- El navegador busca sobre client_name, que cae a 'Unknown Client' sin cliente.
            OR coalesce(c.name, 'Unknown Client') ILIKE '%' || btrim(p_search) || '%'
            OR coalesce(s.folio::text, '') ILIKE '%' || btrim(p_search) || '%'
        )
)
SELECT
    to_jsonb(f) - 'c_id' - 'approval_status'
        || jsonb_build_object(
            'clients',
            CASE WHEN f.c_id IS NULL THEN NULL ELSE (
                SELECT to_jsonb(cc) FROM (
                    SELECT c2.id, c2.name, c2.rut, c2.address, c2.zone, c2.purchase_contact,
                           c2.status, c2.phone, c2.email, c2.giro, c2.comuna, c2.office,
                           c2.credit_days, c2.requires_discount_approval
                    FROM public.clients c2 WHERE c2.id = f.c_id
                ) cc)
            END
        ) AS quotation,
    count(*) OVER () AS total_count,
    (SELECT scope_total FROM scope_stats) AS scope_total,
    (SELECT scope_drafts FROM scope_stats) AS scope_drafts,
    (SELECT scope_sent FROM scope_stats) AS scope_sent,
    (SELECT scope_approved FROM scope_stats) AS scope_approved,
    (SELECT scope_total_amount FROM scope_stats) AS scope_total_amount,
    count(*) FILTER (
        WHERE f.approval_status = 'pending' AND f.seller_id = p_actor_id
    ) OVER () AS pending_mine_count
FROM filtered f
ORDER BY
    -- Un vendedor ve primero sus aprobaciones de descuento pendientes, igual que antes.
    CASE
        WHEN p_is_seller AND f.approval_status = 'pending' AND f.seller_id = p_actor_id THEN 0
        ELSE 1
    END,
    f.created_at DESC NULLS LAST
LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
OFFSET greatest(0, coalesce(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.search_quotations_paged(uuid, boolean, boolean, text, text, integer, integer) TO authenticated;
