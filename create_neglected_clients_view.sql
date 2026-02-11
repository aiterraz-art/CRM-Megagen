-- Vista para identificar clientes descuidados (> 15 días sin visita)
CREATE OR REPLACE VIEW public.client_visit_stats AS
WITH last_visits AS (
    SELECT 
        client_id,
        MAX(check_in_time) as last_visit_date
    FROM public.visits
    WHERE status = 'completed'
    GROUP BY client_id
)
SELECT 
    c.id,
    c.name,
    c.created_by,
    lv.last_visit_date,
    CASE 
        WHEN lv.last_visit_date IS NULL THEN 999 -- Nunca visitado
        ELSE EXTRACT(DAY FROM NOW() - lv.last_visit_date)
    END as days_since_last_visit
FROM public.clients c
LEFT JOIN last_visits lv ON c.id = lv.client_id;

-- RLS para la vista
ALTER VIEW public.client_visit_stats SET (security_invoker = on);

COMMENT ON VIEW public.client_visit_stats IS 'Calcula los días transcurridos desde la última visita completada para cada cliente.';
