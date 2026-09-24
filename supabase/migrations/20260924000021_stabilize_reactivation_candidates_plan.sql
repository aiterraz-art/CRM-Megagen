-- Estabiliza el plan de la cola de candidatos.
--
-- Sintoma: la consola de reparto fallaba en produccion con "canceling statement due to
-- statement timeout", el limite de 8 segundos del rol authenticated, aunque la misma
-- consulta ejecutada a mano tardaba 70 milisegundos.
--
-- Causa: el estimador calculaba 2 filas donde hay mas de mil, y con ese error armaba un
-- bucle anidado que podia reejecutar la agregacion de actividad, que recorre cotizaciones,
-- pedidos, llamadas, correos, mensajes y visitas, una vez por cliente. Basta con que el
-- plan caiga de ese lado para pasar de milisegundos a minutos. Encima, el dueño de cada
-- cliente se resolvia con dos subconsultas por fila contra profiles.
--
-- Correccion: la actividad se calcula UNA vez, forzando la materializacion de la rama, y
-- el dueño se resuelve con una union normal en lugar de subconsultas correlacionadas. No
-- cambia ni un resultado: solo deja de depender de que el planificador acierte.

CREATE OR REPLACE VIEW public.vw_client_reactivation_candidates AS
WITH actividad AS MATERIALIZED (
    -- MATERIALIZED es lo que impide que esta agregacion se inline dentro de un bucle.
    SELECT
        client_id,
        lifetime_amount,
        last_order_at,
        greatest(
            last_visit_at, last_order_at, last_quotation_at,
            last_call_at, last_email_at, last_whatsapp_at
        ) AS last_contact_at
    FROM public.vw_client_last_activity
),
ajustes AS (
    SELECT
        coalesce(max(reactivation_cooling_days), 15) AS cooling_days,
        coalesce(max(reactivation_dormant_days), 60) AS dormant_days
    FROM public.client_followup_settings
    WHERE id = 'default'
),
casos_abiertos AS MATERIALIZED (
    SELECT DISTINCT client_id
    FROM public.client_reactivation_cases
    WHERE status = 'open'
)
SELECT
    c.id AS client_id,
    c.name,
    c.rut,
    c.phone,
    c.email,
    c.comuna,
    c.address,
    c.status AS client_status,
    c.created_by AS owner_id,
    lower(coalesce(p.status, 'active')) AS owner_status,
    coalesce(p.full_name, p.email) AS owner_name,
    coalesce(a.lifetime_amount, 0) AS lifetime_amount,
    a.last_order_at,
    a.last_contact_at,
    CASE WHEN a.last_contact_at IS NULL THEN NULL
         ELSE (now()::date - a.last_contact_at::date) END AS days_without_contact,
    CASE WHEN a.last_order_at IS NULL THEN NULL
         ELSE (now()::date - a.last_order_at::date) END AS days_without_purchase,
    CASE
        WHEN a.last_contact_at IS NULL THEN 'never_contacted'
        WHEN (now()::date - a.last_contact_at::date) > ajustes.dormant_days THEN 'dormant'
        WHEN (now()::date - a.last_contact_at::date) >= ajustes.cooling_days THEN 'cooling'
        ELSE NULL
    END AS segment
FROM public.clients c
CROSS JOIN ajustes
LEFT JOIN actividad a ON a.client_id = c.id
LEFT JOIN public.profiles p ON p.id = c.created_by
WHERE c.archived_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM casos_abiertos ca WHERE ca.client_id = c.id);

DO $$
BEGIN
    EXECUTE 'ALTER VIEW public.vw_client_reactivation_candidates SET (security_invoker = on)';
END $$;

GRANT SELECT ON public.vw_client_reactivation_candidates TO authenticated;
