-- CRM Megagen - Validaciones SQL de Smoke Test
-- Ejecutar en CADA instancia (Empresa A y Empresa B)
-- Reemplaza fechas/IDs según tu prueba.

-- ============================================================================
-- PARAMS
-- ============================================================================
WITH params AS (
    SELECT
        CURRENT_DATE::date AS test_date,
        date_trunc('month', CURRENT_DATE)::timestamptz AS month_start,
        (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 second')::timestamptz AS month_end
)
SELECT * FROM params;

-- ============================================================================
-- 1) Compatibilidad Tasks (tasks vs legacy)
-- ============================================================================

-- Verifica columnas de compatibilidad
SELECT
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('tasks', 'crm_tasks')
  AND column_name IN ('user_id', 'assigned_to', 'assigned_by', 'due_date', 'status', 'title', 'description')
ORDER BY table_name, column_name;

-- Tareas pendientes por usuario (compatible: tasks / crm_tasks)
DROP TABLE IF EXISTS _smoke_pending_tasks;
CREATE TEMP TABLE _smoke_pending_tasks (
    source TEXT,
    owner_id UUID,
    pending_tasks BIGINT
);

DO $$
BEGIN
    IF to_regclass('public.tasks') IS NOT NULL THEN
        EXECUTE $q$
            INSERT INTO _smoke_pending_tasks (source, owner_id, pending_tasks)
            SELECT
                'tasks' AS source,
                COALESCE(user_id, assigned_to) AS owner_id,
                COUNT(*)::BIGINT AS pending_tasks
            FROM public.tasks
            WHERE status = 'pending'
            GROUP BY COALESCE(user_id, assigned_to)
        $q$;
    END IF;

    IF to_regclass('public.crm_tasks') IS NOT NULL THEN
        EXECUTE $q$
            INSERT INTO _smoke_pending_tasks (source, owner_id, pending_tasks)
            SELECT
                'crm_tasks' AS source,
                assigned_to AS owner_id,
                COUNT(*)::BIGINT AS pending_tasks
            FROM public.crm_tasks
            WHERE status = 'pending'
            GROUP BY assigned_to
        $q$;
    END IF;
END $$;

SELECT
    source,
    owner_id,
    pending_tasks
FROM _smoke_pending_tasks
ORDER BY pending_tasks DESC, source, owner_id;

-- ============================================================================
-- 2) Visitas del día (para contrastar Dashboard/TeamStats)
-- ============================================================================
WITH params AS (
    SELECT CURRENT_DATE::date AS test_date
)
SELECT
    v.sales_rep_id,
    COUNT(*) AS visits_today,
    COUNT(*) FILTER (WHERE v.status = 'in_progress') AS active_visits_today,
    COUNT(*) FILTER (WHERE v.status = 'completed') AS completed_visits_today
FROM public.visits v, params p
WHERE v.check_in_time >= p.test_date::timestamptz
  AND v.check_in_time < (p.test_date + INTERVAL '1 day')::timestamptz
GROUP BY v.sales_rep_id
ORDER BY visits_today DESC;

-- ============================================================================
-- 3) Ventas MTD por vendedor (TeamStats / Dashboard)
-- ============================================================================
WITH params AS (
    SELECT
        date_trunc('month', CURRENT_DATE)::timestamptz AS month_start,
        (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 second')::timestamptz AS month_end
)
SELECT
    o.user_id,
    COUNT(*) AS orders_mtd,
    SUM(COALESCE(o.total_amount, 0)) AS sales_mtd
FROM public.orders o, params p
WHERE o.created_at >= p.month_start
  AND o.created_at <= p.month_end
  AND COALESCE(o.status, '') NOT IN ('cancelled', 'rejected')
GROUP BY o.user_id
ORDER BY sales_mtd DESC;

-- ============================================================================
-- 4) Calls y Quotations del día (Dashboard: "visitas" ampliadas)
-- ============================================================================
WITH params AS (
    SELECT CURRENT_DATE::date AS test_date
)
SELECT
    'call_logs' AS source,
    user_id AS actor_id,
    COUNT(*) AS qty
FROM public.call_logs c, params p
WHERE c.created_at >= p.test_date::timestamptz
  AND c.created_at < (p.test_date + INTERVAL '1 day')::timestamptz
GROUP BY user_id
UNION ALL
SELECT
    'quotations' AS source,
    seller_id AS actor_id,
    COUNT(*) AS qty
FROM public.quotations q, params p
WHERE q.created_at >= p.test_date::timestamptz
  AND q.created_at < (p.test_date + INTERVAL '1 day')::timestamptz
GROUP BY seller_id
ORDER BY source, qty DESC;

-- ============================================================================
-- 5) Estado de rutas y consistencia de route_items
-- ============================================================================

-- Conteo por estado de ruta
SELECT
    status,
    COUNT(*) AS routes
FROM public.delivery_routes
GROUP BY status
ORDER BY routes DESC;

-- Rutas activas sin pendientes (debería tender a 0)
SELECT
    r.id,
    r.name,
    r.status,
    COUNT(*) FILTER (WHERE ri.status::text IN ('pending', 'rescheduled', 'failed')) AS pending_like_items,
    COUNT(*) FILTER (WHERE ri.status::text IN ('delivered', 'completed')) AS delivered_items
FROM public.delivery_routes r
LEFT JOIN public.route_items ri ON ri.route_id = r.id
WHERE r.status::text = 'in_progress'
GROUP BY r.id, r.name, r.status
HAVING COUNT(*) FILTER (WHERE ri.status::text IN ('pending', 'rescheduled', 'failed')) = 0
ORDER BY r.id;

-- Items huérfanos
SELECT
    ri.id,
    ri.route_id,
    ri.order_id
FROM public.route_items ri
LEFT JOIN public.delivery_routes r ON r.id = ri.route_id
LEFT JOIN public.orders o ON o.id = ri.order_id
WHERE r.id IS NULL OR o.id IS NULL
LIMIT 50;

-- ============================================================================
-- 6) Entregas: dual-write orders vs route_items
-- ============================================================================
SELECT
    o.id AS order_id,
    o.delivery_status AS order_delivery_status,
    ri.status AS route_item_status,
    NULLIF(to_jsonb(o)->>'delivered_at', '')::timestamptz AS order_delivered_at,
    ri.delivered_at AS route_item_delivered_at
FROM public.orders o
JOIN public.route_items ri ON ri.order_id = o.id
WHERE o.delivery_status = 'delivered'
  AND ri.status::text NOT IN ('delivered', 'completed')
ORDER BY COALESCE(
    ri.delivered_at,
    NULLIF(to_jsonb(o)->>'delivered_at', '')::timestamptz,
    NULLIF(to_jsonb(o)->>'updated_at', '')::timestamptz,
    NULLIF(to_jsonb(o)->>'created_at', '')::timestamptz
) DESC
LIMIT 100;

-- ============================================================================
-- 7) Cotizaciones sin ubicación (tras flush de cola deberían bajar)
-- ============================================================================
SELECT
    q.id,
    q.folio,
    q.seller_id,
    q.created_at
FROM public.quotations q
LEFT JOIN public.seller_locations sl ON sl.quotation_id = q.id
WHERE q.created_at >= (CURRENT_DATE - INTERVAL '7 day')
  AND sl.quotation_id IS NULL
ORDER BY q.created_at DESC
LIMIT 200;

-- ============================================================================
-- 8) Duplicados de folio en cotizaciones (si quieres control adicional)
-- ============================================================================
SELECT
    folio,
    COUNT(*) AS qty
FROM public.quotations
WHERE folio IS NOT NULL
GROUP BY folio
HAVING COUNT(*) > 1
ORDER BY qty DESC, folio DESC;
