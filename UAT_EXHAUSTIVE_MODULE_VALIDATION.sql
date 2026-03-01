-- ============================================================================
-- UAT_EXHAUSTIVE_MODULE_VALIDATION.sql
-- Validacion funcional exhaustiva por modulos (read-only)
-- Resultado: lista de checks con issue_count (ideal = 0)
-- ============================================================================

WITH checks AS (
    -- -----------------------------------------------------------------------
    -- 1) AUTH / USERS / WHITELIST
    -- -----------------------------------------------------------------------
    SELECT 'auth_profiles_missing_email'::text AS check_name, COUNT(*)::bigint AS issue_count
    FROM public.profiles
    WHERE email IS NULL OR btrim(email) = ''

    UNION ALL
    SELECT 'auth_profiles_invalid_role', COUNT(*)
    FROM public.profiles
    WHERE role::text NOT IN ('admin', 'manager', 'jefe', 'administrativo', 'seller', 'driver', 'supervisor')

    UNION ALL
    SELECT 'auth_profiles_invalid_status', COUNT(*)
    FROM public.profiles
    WHERE status::text NOT IN ('pending', 'active', 'disabled')

    UNION ALL
    SELECT 'auth_profiles_duplicate_email', COUNT(*)
    FROM (
        SELECT lower(email) AS email_l, COUNT(*) AS c
        FROM public.profiles
        WHERE email IS NOT NULL
        GROUP BY lower(email)
        HAVING COUNT(*) > 1
    ) d

    UNION ALL
    SELECT 'auth_whitelist_invalid_role', COUNT(*)
    FROM public.user_whitelist
    WHERE role::text NOT IN ('admin', 'manager', 'jefe', 'administrativo', 'seller', 'driver', 'supervisor')

    UNION ALL
    SELECT 'auth_whitelist_missing_email', COUNT(*)
    FROM public.user_whitelist
    WHERE email IS NULL OR btrim(email) = ''

    -- -----------------------------------------------------------------------
    -- 2) CLIENTS
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'clients_missing_name', COUNT(*)
    FROM public.clients
    WHERE name IS NULL OR btrim(name) = ''

    UNION ALL
    SELECT 'clients_invalid_coordinates', COUNT(*)
    FROM public.clients
    WHERE lat IS NOT NULL
      AND lng IS NOT NULL
      AND (lat < -90 OR lat > 90 OR lng < -180 OR lng > 180)

    UNION ALL
    SELECT 'clients_orphan_created_by', COUNT(*)
    FROM public.clients c
    LEFT JOIN public.profiles p ON p.id = c.created_by
    WHERE c.created_by IS NOT NULL
      AND p.id IS NULL

    -- -----------------------------------------------------------------------
    -- 3) GPS / LOCATIONS / VISITS
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'gps_seller_locations_orphan_seller', COUNT(*)
    FROM public.seller_locations sl
    LEFT JOIN public.profiles p ON p.id = sl.seller_id
    WHERE sl.seller_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'gps_seller_locations_orphan_quotation', COUNT(*)
    FROM public.seller_locations sl
    LEFT JOIN public.quotations q ON q.id = sl.quotation_id
    WHERE sl.quotation_id IS NOT NULL
      AND q.id IS NULL

    UNION ALL
    SELECT 'gps_seller_locations_invalid_coordinates', COUNT(*)
    FROM public.seller_locations
    WHERE lat IS NULL
       OR lng IS NULL
       OR lat < -90 OR lat > 90
       OR lng < -180 OR lng > 180

    UNION ALL
    SELECT 'gps_quotations_without_location', COUNT(*)
    FROM public.quotations q
    LEFT JOIN public.seller_locations sl ON sl.quotation_id = q.id
    WHERE sl.id IS NULL

    UNION ALL
    SELECT 'visits_invalid_status', COUNT(*)
    FROM public.visits
    WHERE status::text NOT IN ('pending', 'scheduled', 'in_progress', 'in-progress', 'completed', 'cancelled', 'rescheduled')

    UNION ALL
    SELECT 'visits_in_progress_with_checkout', COUNT(*)
    FROM public.visits
    WHERE status::text IN ('in_progress', 'in-progress')
      AND check_out_time IS NOT NULL

    UNION ALL
    SELECT 'visits_completed_without_checkout', COUNT(*)
    FROM public.visits
    WHERE status::text = 'completed'
      AND check_out_time IS NULL

    UNION ALL
    SELECT 'visits_orphan_sales_rep', COUNT(*)
    FROM public.visits v
    LEFT JOIN public.profiles p ON p.id = v.sales_rep_id
    WHERE v.sales_rep_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'visits_orphan_client', COUNT(*)
    FROM public.visits v
    LEFT JOIN public.clients c ON c.id = v.client_id
    WHERE v.client_id IS NOT NULL
      AND c.id IS NULL

    UNION ALL
    SELECT 'visits_stale_in_progress_48h', COUNT(*)
    FROM public.visits
    WHERE status::text IN ('in_progress', 'in-progress')
      AND check_in_time < now() - interval '48 hours'

    -- -----------------------------------------------------------------------
    -- 4) QUOTATIONS / ORDERS
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'quotations_invalid_status', COUNT(*)
    FROM public.quotations
    WHERE status::text NOT IN ('draft', 'sent', 'approved', 'rejected')

    UNION ALL
    SELECT 'quotations_orphan_client', COUNT(*)
    FROM public.quotations q
    LEFT JOIN public.clients c ON c.id = q.client_id
    WHERE q.client_id IS NOT NULL
      AND c.id IS NULL

    UNION ALL
    SELECT 'quotations_orphan_seller', COUNT(*)
    FROM public.quotations q
    LEFT JOIN public.profiles p ON p.id = q.seller_id
    WHERE q.seller_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'quotations_duplicate_folio', COUNT(*)
    FROM (
        SELECT folio, COUNT(*) AS c
        FROM public.quotations
        WHERE folio IS NOT NULL
        GROUP BY folio
        HAVING COUNT(*) > 1
    ) d

    UNION ALL
    SELECT 'orders_invalid_status', COUNT(*)
    FROM public.orders
    WHERE status::text NOT IN ('pending', 'completed', 'cancelled', 'rejected')

    UNION ALL
    SELECT 'orders_invalid_delivery_status', COUNT(*)
    FROM public.orders
    WHERE delivery_status::text NOT IN ('pending', 'out_for_delivery', 'delivered', 'failed')

    UNION ALL
    SELECT 'orders_orphan_user', COUNT(*)
    FROM public.orders o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    WHERE o.user_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'orders_orphan_client', COUNT(*)
    FROM public.orders o
    LEFT JOIN public.clients c ON c.id = o.client_id
    WHERE o.client_id IS NOT NULL
      AND c.id IS NULL

    UNION ALL
    SELECT 'orders_orphan_quotation', COUNT(*)
    FROM public.orders o
    LEFT JOIN public.quotations q ON q.id = o.quotation_id
    WHERE o.quotation_id IS NOT NULL
      AND q.id IS NULL

    -- -----------------------------------------------------------------------
    -- 5) DISPATCH / ROUTES / DELIVERY
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'routes_invalid_status', COUNT(*)
    FROM public.delivery_routes
    WHERE status::text NOT IN ('draft', 'in_progress', 'completed')

    UNION ALL
    SELECT 'routes_orphan_driver', COUNT(*)
    FROM public.delivery_routes r
    LEFT JOIN public.profiles p ON p.id = r.driver_id
    WHERE r.driver_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'route_items_invalid_status', COUNT(*)
    FROM public.route_items
    WHERE status::text NOT IN ('pending', 'delivered', 'failed', 'rescheduled', 'completed')

    UNION ALL
    SELECT 'route_items_orphan_route', COUNT(*)
    FROM public.route_items ri
    LEFT JOIN public.delivery_routes r ON r.id = ri.route_id
    WHERE r.id IS NULL

    UNION ALL
    SELECT 'route_items_orphan_order', COUNT(*)
    FROM public.route_items ri
    LEFT JOIN public.orders o ON o.id = ri.order_id
    WHERE o.id IS NULL

    UNION ALL
    SELECT 'route_items_duplicate_route_order', COUNT(*)
    FROM (
        SELECT route_id, order_id, COUNT(*) AS c
        FROM public.route_items
        GROUP BY route_id, order_id
        HAVING COUNT(*) > 1
    ) d

    UNION ALL
    SELECT 'delivery_mismatch_order_delivered_vs_route_item', COUNT(*)
    FROM public.orders o
    JOIN public.route_items ri ON ri.order_id = o.id
    WHERE o.delivery_status = 'delivered'
      AND ri.status::text NOT IN ('delivered', 'completed')

    UNION ALL
    SELECT 'delivery_mismatch_route_item_delivered_vs_order', COUNT(*)
    FROM public.route_items ri
    JOIN public.orders o ON o.id = ri.order_id
    WHERE ri.status::text IN ('delivered', 'completed')
      AND o.delivery_status <> 'delivered'

    UNION ALL
    SELECT 'routes_in_progress_without_pending_items', COUNT(*)
    FROM (
        SELECT r.id
        FROM public.delivery_routes r
        LEFT JOIN public.route_items ri ON ri.route_id = r.id
        WHERE r.status::text = 'in_progress'
        GROUP BY r.id
        HAVING COUNT(*) FILTER (WHERE ri.status::text IN ('pending', 'rescheduled', 'failed')) = 0
    ) s

    -- -----------------------------------------------------------------------
    -- 6) TASKS / SCHEDULE
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'tasks_invalid_status', COUNT(*)
    FROM public.tasks
    WHERE status::text NOT IN ('pending', 'completed', 'cancelled')

    UNION ALL
    SELECT 'tasks_without_owner', COUNT(*)
    FROM public.tasks
    WHERE user_id IS NULL
      AND assigned_to IS NULL

    UNION ALL
    SELECT 'tasks_orphan_user_id', COUNT(*)
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.id = t.user_id
    WHERE t.user_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'tasks_orphan_assigned_to', COUNT(*)
    FROM public.tasks t
    LEFT JOIN public.profiles p ON p.id = t.assigned_to
    WHERE t.assigned_to IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'tasks_orphan_client', COUNT(*)
    FROM public.tasks t
    LEFT JOIN public.clients c ON c.id = t.client_id
    WHERE t.client_id IS NOT NULL
      AND c.id IS NULL

    -- -----------------------------------------------------------------------
    -- 7) CALLS / EMAILS
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'call_logs_invalid_status', COUNT(*)
    FROM public.call_logs
    WHERE status::text NOT IN ('contestada', 'no_contesto', 'ocupado', 'equivocado', 'buzon', 'iniciada')

    UNION ALL
    SELECT 'call_logs_orphan_user', COUNT(*)
    FROM public.call_logs cl
    LEFT JOIN public.profiles p ON p.id = cl.user_id
    WHERE cl.user_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'call_logs_orphan_client', COUNT(*)
    FROM public.call_logs cl
    LEFT JOIN public.clients c ON c.id = cl.client_id
    WHERE cl.client_id IS NOT NULL
      AND c.id IS NULL

    UNION ALL
    SELECT 'email_logs_orphan_user', COUNT(*)
    FROM public.email_logs el
    LEFT JOIN public.profiles p ON p.id = el.user_id
    WHERE el.user_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'email_logs_orphan_client', COUNT(*)
    FROM public.email_logs el
    LEFT JOIN public.clients c ON c.id = el.client_id
    WHERE el.client_id IS NOT NULL
      AND c.id IS NULL

    -- -----------------------------------------------------------------------
    -- 8) INVENTORY / ORDER ITEMS
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'inventory_negative_stock', COUNT(*)
    FROM public.inventory
    WHERE stock_qty < 0

    UNION ALL
    SELECT 'order_items_orphan_order', COUNT(*)
    FROM public.order_items oi
    LEFT JOIN public.orders o ON o.id = oi.order_id
    WHERE o.id IS NULL

    UNION ALL
    SELECT 'order_items_orphan_product', COUNT(*)
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.product_id IS NOT NULL
      AND p.id IS NULL

    -- -----------------------------------------------------------------------
    -- 9) GOALS / DASHBOARD FEEDERS
    -- -----------------------------------------------------------------------
    UNION ALL
    SELECT 'goals_duplicate_user_month_year', COUNT(*)
    FROM (
        SELECT user_id, month, year, COUNT(*) AS c
        FROM public.goals
        GROUP BY user_id, month, year
        HAVING COUNT(*) > 1
    ) d

    UNION ALL
    SELECT 'goals_orphan_user', COUNT(*)
    FROM public.goals g
    LEFT JOIN public.profiles p ON p.id = g.user_id
    WHERE g.user_id IS NOT NULL
      AND p.id IS NULL

    UNION ALL
    SELECT 'dashboard_feeders_missing_created_at_orders', COUNT(*)
    FROM public.orders
    WHERE created_at IS NULL

    UNION ALL
    SELECT 'dashboard_feeders_missing_created_at_quotations', COUNT(*)
    FROM public.quotations
    WHERE created_at IS NULL

    UNION ALL
    SELECT 'dashboard_feeders_missing_created_at_calls', COUNT(*)
    FROM public.call_logs
    WHERE created_at IS NULL
)
SELECT
    check_name,
    issue_count
FROM checks
ORDER BY check_name;
