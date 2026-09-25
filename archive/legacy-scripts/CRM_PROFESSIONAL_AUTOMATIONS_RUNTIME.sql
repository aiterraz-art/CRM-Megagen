BEGIN;

CREATE OR REPLACE FUNCTION public.ops_refresh_health_alerts()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_stale bigint := 0;
    v_no_gps bigint := 0;
    v_routes bigint := 0;
    v_overdue_tasks bigint := 0;
    v_created int := 0;
BEGIN
    SELECT stale_visits, quotations_without_location, routes_without_pending, overdue_tasks
    INTO v_stale, v_no_gps, v_routes, v_overdue_tasks
    FROM public.vw_ops_health
    LIMIT 1;

    IF v_stale > 0 THEN
        INSERT INTO public.ops_alerts (source, severity, title, message, context_json)
        VALUES (
            'ops_health',
            'critical',
            'Visitas estancadas detectadas',
            format('Hay %s visitas en progreso con mas de 24h.', v_stale),
            jsonb_build_object('metric', 'stale_visits', 'value', v_stale)
        );
        v_created := v_created + 1;
    END IF;

    IF v_no_gps > 0 THEN
        INSERT INTO public.ops_alerts (source, severity, title, message, context_json)
        VALUES (
            'ops_health',
            'warning',
            'Cotizaciones sin evidencia GPS',
            format('Hay %s cotizaciones sin ubicacion asociada.', v_no_gps),
            jsonb_build_object('metric', 'quotations_without_location', 'value', v_no_gps)
        );
        v_created := v_created + 1;
    END IF;

    IF v_routes > 0 THEN
        INSERT INTO public.ops_alerts (source, severity, title, message, context_json)
        VALUES (
            'ops_health',
            'warning',
            'Rutas activas sin pendientes',
            format('Hay %s rutas in_progress sin items pendientes.', v_routes),
            jsonb_build_object('metric', 'routes_without_pending', 'value', v_routes)
        );
        v_created := v_created + 1;
    END IF;

    IF v_overdue_tasks > 0 THEN
        INSERT INTO public.ops_alerts (source, severity, title, message, context_json)
        VALUES (
            'ops_health',
            'warning',
            'Tareas vencidas',
            format('Hay %s tareas pendientes vencidas.', v_overdue_tasks),
            jsonb_build_object('metric', 'overdue_tasks', 'value', v_overdue_tasks)
        );
        v_created := v_created + 1;
    END IF;

    RETURN jsonb_build_object(
        'stale_visits', v_stale,
        'quotations_without_location', v_no_gps,
        'routes_without_pending', v_routes,
        'overdue_tasks', v_overdue_tasks,
        'alerts_created', v_created
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.ops_mark_overdue_commitments()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated integer := 0;
BEGIN
    UPDATE public.payment_commitments
    SET status = 'overdue'
    WHERE status = 'pending'
      AND commitment_date < CURRENT_DATE;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$;

COMMIT;

