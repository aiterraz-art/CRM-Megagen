-- Se agrega la ultima visita completada a la vista de actividad por cliente.
--
-- El panel de clientes descuidados del dashboard calculaba esto trayendo al navegador el
-- historial completo de visitas, pedidos, cotizaciones, llamadas, correos y WhatsApp de
-- todos los clientes, en seis consultas que enviaban los identificadores de los 920
-- clientes en la URL. Esa URL supera los 34 KB y el servidor la rechaza, de modo que el
-- panel llevaba tiempo fallando en silencio: los errores no se comprobaban.
--
-- Con la visita incorporada, el dashboard resuelve el panel con una sola consulta a esta
-- vista, igual que ya hace el modulo de clientes.

CREATE OR REPLACE VIEW public.vw_client_last_activity AS
WITH quotation_activity AS (
    SELECT client_id, max(created_at) AS last_at
    FROM public.quotations
    WHERE client_id IS NOT NULL
    GROUP BY client_id
),
order_activity AS (
    SELECT client_id, max(created_at) AS last_at
    FROM public.orders
    WHERE client_id IS NOT NULL
    GROUP BY client_id
),
call_activity AS (
    SELECT client_id, max(created_at) AS last_at
    FROM public.call_logs
    WHERE client_id IS NOT NULL
    GROUP BY client_id
),
email_activity AS (
    SELECT client_id, max(created_at) AS last_at
    FROM public.email_logs
    WHERE client_id IS NOT NULL
    GROUP BY client_id
),
whatsapp_activity AS (
    SELECT client_id, max(created_at) AS last_at
    FROM public.lead_message_logs
    WHERE client_id IS NOT NULL
      AND channel = 'whatsapp'
      AND status IN ('sent', 'opened_external')
    GROUP BY client_id
),
visit_activity AS (
    -- Mismo criterio que aplicaba el dashboard: solo visitas completadas.
    SELECT client_id, max(check_in_time) AS last_at
    FROM public.visits
    WHERE client_id IS NOT NULL
      AND status = 'completed'
    GROUP BY client_id
)
SELECT
    c.id AS client_id,
    quotation_activity.last_at AS last_quotation_at,
    order_activity.last_at AS last_order_at,
    call_activity.last_at AS last_call_at,
    email_activity.last_at AS last_email_at,
    whatsapp_activity.last_at AS last_whatsapp_at,
    visit_activity.last_at AS last_visit_at
FROM public.clients c
LEFT JOIN quotation_activity ON quotation_activity.client_id = c.id
LEFT JOIN order_activity ON order_activity.client_id = c.id
LEFT JOIN call_activity ON call_activity.client_id = c.id
LEFT JOIN email_activity ON email_activity.client_id = c.id
LEFT JOIN whatsapp_activity ON whatsapp_activity.client_id = c.id
LEFT JOIN visit_activity ON visit_activity.client_id = c.id;

DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 150000 THEN
        EXECUTE 'ALTER VIEW public.vw_client_last_activity SET (security_invoker = on)';
    ELSE
        RAISE EXCEPTION 'Se requiere PostgreSQL 15 o superior para respetar RLS en la vista';
    END IF;
END $$;

GRANT SELECT ON public.vw_client_last_activity TO authenticated;
