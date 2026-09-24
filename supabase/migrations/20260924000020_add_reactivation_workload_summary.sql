-- Carga de trabajo de reactivacion por vendedor.
--
-- Se agrega en la base a proposito: traer los casos al navegador para contarlos alli
-- haria que la consola del jefe se volviera mas lenta a medida que crece el reparto, que
-- es justo el patron que se corrigio en el resto del CRM.

DROP FUNCTION IF EXISTS public.reactivation_workload_summary();

CREATE FUNCTION public.reactivation_workload_summary()
RETURNS TABLE (
    seller_id uuid,
    seller_name text,
    open_cases bigint,
    stale_cases bigint,
    avg_attempts numeric,
    won_month bigint,
    won_month_amount numeric,
    discarded_month bigint
)
-- SECURITY INVOKER: RLS ya decide que casos alcanza quien consulta. Un vendedor solo se
-- veria a si mismo, un jefe ve a todo el equipo.
LANGUAGE sql
STABLE
AS $$
WITH ajustes AS (
    SELECT coalesce(max(reactivation_stale_case_days), 7) AS stale_days
    FROM public.client_followup_settings WHERE id = 'default'
)
SELECT
    c.assigned_to AS seller_id,
    coalesce(p.full_name, p.email, 'Sin nombre') AS seller_name,
    count(*) FILTER (WHERE c.status = 'open') AS open_cases,
    count(*) FILTER (
        WHERE c.status = 'open'
          AND coalesce(c.last_attempt_at, c.opened_at) < now() - make_interval(days => (SELECT stale_days FROM ajustes))
    ) AS stale_cases,
    coalesce(round(avg(c.attempts_count) FILTER (WHERE c.status = 'open'), 1), 0) AS avg_attempts,
    count(*) FILTER (WHERE c.status = 'won' AND c.won_at >= date_trunc('month', now())) AS won_month,
    coalesce(sum(c.won_amount) FILTER (
        WHERE c.status = 'won' AND c.won_at >= date_trunc('month', now())
    ), 0) AS won_month_amount,
    count(*) FILTER (
        WHERE c.status = 'discarded' AND c.discarded_at >= date_trunc('month', now())
    ) AS discarded_month
FROM public.client_reactivation_cases c
LEFT JOIN public.profiles p ON p.id = c.assigned_to
GROUP BY c.assigned_to, coalesce(p.full_name, p.email, 'Sin nombre')
ORDER BY count(*) FILTER (WHERE c.status = 'open') DESC;
$$;

GRANT EXECUTE ON FUNCTION public.reactivation_workload_summary() TO authenticated;
