-- Busqueda paginada de pedidos, resuelta en la base.
--
-- El modulo ya paginaba, pero en el navegador: traia todos los pedidos y recortaba de
-- diez en diez. Eso acota las filas dibujadas, no la transferencia ni la memoria, que
-- siguen creciendo con el numero de pedidos.
--
-- Los limites de fecha llegan ya convertidos desde la pantalla. El filtro se construia
-- alli con la hora local del navegador, asi que recalcularlo aqui cambiaria el resultado
-- para quien trabaje en otro huso.

DROP FUNCTION IF EXISTS public.search_orders_paged(uuid, boolean, text, text, text, text, timestamptz, timestamptz, integer, integer);

CREATE FUNCTION public.search_orders_paged(
    p_actor_id uuid,
    p_can_view_all boolean DEFAULT false,
    p_view_mode text DEFAULT 'all',
    p_order_status text DEFAULT 'active',
    p_delivery_status text DEFAULT 'all',
    p_search text DEFAULT '',
    p_date_from timestamptz DEFAULT NULL,
    p_date_to timestamptz DEFAULT NULL,
    p_limit integer DEFAULT 10,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    "order" jsonb,
    total_count bigint,
    completed_count bigint,
    delivered_count bigint,
    billed_amount numeric
)
-- SECURITY INVOKER por omision: RLS sigue decidiendo que pedidos alcanza cada rol.
LANGUAGE sql
STABLE
AS $$
WITH filtered AS (
    SELECT
        o.id, o.folio, o.quotation_id, o.client_id, o.user_id, o.status, o.delivery_status,
        o.delivery_photo_url, o.total_amount, o.created_at, o.payment_email_status,
        o.payment_email_error, o.payment_proof_path, o.payment_proof_name,
        o.payment_proof_mime_type, o.shipment_method, o.courier_name, o.tracking_number,
        o.courier_marked_at
    FROM public.orders o
    LEFT JOIN public.clients c ON c.id = o.client_id
    LEFT JOIN public.profiles p ON p.id = o.user_id
    LEFT JOIN public.quotations q ON q.id = o.quotation_id
    WHERE
        -- La pantalla solo muestra pedidos originados en una cotizacion
        o.quotation_id IS NOT NULL
        AND (p_can_view_all OR o.user_id = p_actor_id)
        AND (p_view_mode = 'all' OR o.user_id = p_actor_id)
        AND (
            CASE
                WHEN p_order_status = 'active' THEN lower(coalesce(o.status, '')) <> 'cancelled'
                ELSE lower(coalesce(o.status, '')) = p_order_status
            END
        )
        AND (
            p_delivery_status = 'all'
            -- Un estado de entrega vacio equivale a pendiente, igual que en la pantalla
            OR coalesce(nullif(lower(btrim(coalesce(o.delivery_status, ''))), ''), 'pending') = p_delivery_status
        )
        AND (p_date_from IS NULL OR o.created_at >= p_date_from)
        AND (p_date_to IS NULL OR o.created_at <= p_date_to)
        AND (
            coalesce(btrim(p_search), '') = ''
            OR coalesce(c.name, 'Cliente no disponible') ILIKE '%' || btrim(p_search) || '%'
            OR coalesce(p.full_name, p.email, 'Sin vendedor') ILIKE '%' || btrim(p_search) || '%'
            OR coalesce(o.folio::text, '') ILIKE '%' || btrim(p_search) || '%'
            OR coalesce(q.folio::text, '') ILIKE '%' || btrim(p_search) || '%'
        )
)
SELECT
    to_jsonb(f) AS "order",
    count(*) OVER () AS total_count,
    count(*) FILTER (WHERE lower(coalesce(f.status, '')) = 'completed') OVER () AS completed_count,
    count(*) FILTER (
        WHERE coalesce(nullif(lower(btrim(coalesce(f.delivery_status, ''))), ''), 'pending') = 'delivered'
    ) OVER () AS delivered_count,
    coalesce(
        sum(CASE WHEN lower(coalesce(f.status, '')) <> 'cancelled' THEN coalesce(f.total_amount, 0) ELSE 0 END) OVER (),
        0
    ) AS billed_amount
FROM filtered f
ORDER BY f.created_at DESC NULLS LAST
LIMIT greatest(1, least(coalesce(p_limit, 10), 200))
OFFSET greatest(0, coalesce(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.search_orders_paged(uuid, boolean, text, text, text, text, timestamptz, timestamptz, integer, integer) TO authenticated;
