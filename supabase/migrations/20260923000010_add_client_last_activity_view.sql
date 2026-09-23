-- Ultima actividad comercial por cliente, precalculada.
--
-- Contexto: la cartera de clientes calculaba el estado de seguimiento trayendo al
-- navegador TODAS las filas historicas de cotizaciones, pedidos, llamadas, correos y
-- mensajes de WhatsApp de cada cliente, en cinco consultas por cada bloque de 200
-- clientes y con los bloques encadenados en serie. Con mas de dos mil clientes eso son
-- decenas de consultas secuenciales que transfieren cientos de miles de filas para
-- quedarse unicamente con la fecha mas reciente de cada origen.
--
-- Esta vista hace ese calculo en la base, donde cuesta un recorrido agrupado, y devuelve
-- una sola fila por cliente.

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
    -- Mismos criterios que aplicaba el cliente: solo WhatsApp efectivamente enviado.
    SELECT client_id, max(created_at) AS last_at
    FROM public.lead_message_logs
    WHERE client_id IS NOT NULL
      AND channel = 'whatsapp'
      AND status IN ('sent', 'opened_external')
    GROUP BY client_id
)
SELECT
    c.id AS client_id,
    quotation_activity.last_at AS last_quotation_at,
    order_activity.last_at AS last_order_at,
    call_activity.last_at AS last_call_at,
    email_activity.last_at AS last_email_at,
    whatsapp_activity.last_at AS last_whatsapp_at
FROM public.clients c
LEFT JOIN quotation_activity ON quotation_activity.client_id = c.id
LEFT JOIN order_activity ON order_activity.client_id = c.id
LEFT JOIN call_activity ON call_activity.client_id = c.id
LEFT JOIN email_activity ON email_activity.client_id = c.id
LEFT JOIN whatsapp_activity ON whatsapp_activity.client_id = c.id;

-- La vista debe evaluarse con los permisos de quien consulta, no con los del propietario.
-- Sin esto se saltaria RLS y un vendedor veria actividad de cotizaciones y pedidos de
-- otros vendedores, que hoy no puede ver. El objetivo es acelerar el calculo, no cambiar
-- que datos alcanza cada rol.
DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 150000 THEN
        EXECUTE 'ALTER VIEW public.vw_client_last_activity SET (security_invoker = on)';
    ELSE
        RAISE EXCEPTION
            'vw_client_last_activity requiere PostgreSQL 15 o superior para respetar RLS. Version actual: %',
            current_setting('server_version');
    END IF;
END $$;

GRANT SELECT ON public.vw_client_last_activity TO authenticated;

-- Sin indices adicionales, a proposito.
--
-- Medido sobre ambas instancias: las tablas implicadas rondan las 1.500 filas, donde un
-- recorrido secuencial se resuelve en menos de un milisegundo. Ademas lead_message_logs
-- ya tiene (client_id, created_at DESC) y quotations tiene (client_id). Anadir indices
-- aqui encareceria cada escritura sin ganancia observable. Conviene revisarlo si alguna
-- de estas tablas supera el orden de cientos de miles de filas.
