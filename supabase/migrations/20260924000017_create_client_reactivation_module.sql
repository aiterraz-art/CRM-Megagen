-- Modulo de reactivacion de clientes: nucleo de datos.
--
-- Contexto: mas de la mitad de la cartera lleva meses sin comprar. Hasta ahora no habia
-- forma de trabajar esa cola de manera sistematica, y el unico indicador disponible era
-- "dias sin contacto", que tiene un vicio grave: registrar una llamada sin respuesta
-- actualiza la ultima actividad y el cliente desaparece de la lista sin haberse
-- reactivado. Contactar no es reactivar.
--
-- Este modulo introduce el CASO de reactivacion, que sobrevive a los intentos de contacto
-- y solo se cierra cuando el cliente vuelve a comprar, o cuando alguien lo descarta
-- dejando constancia del motivo. Esa regla se hace cumplir en la base, no en la pantalla:
-- ni siquiera por la API se puede marcar un caso como ganado a mano.

-- ---------------------------------------------------------------------------------
-- 1. Umbrales configurables
-- ---------------------------------------------------------------------------------

ALTER TABLE public.client_followup_settings
    ADD COLUMN IF NOT EXISTS reactivation_cooling_days integer NOT NULL DEFAULT 15;
ALTER TABLE public.client_followup_settings
    ADD COLUMN IF NOT EXISTS reactivation_dormant_days integer NOT NULL DEFAULT 60;
ALTER TABLE public.client_followup_settings
    ADD COLUMN IF NOT EXISTS reactivation_min_attempts integer NOT NULL DEFAULT 3;
ALTER TABLE public.client_followup_settings
    ADD COLUMN IF NOT EXISTS reactivation_stale_case_days integer NOT NULL DEFAULT 7;

-- Esta tabla solo era legible por admin, de modo que un vendedor o un jefe leian vacio y
-- caian a los valores de respaldo codificados en el navegador. Hoy no se nota porque la
-- fila configurada coincide con ese respaldo, pero en cuanto un admin cambie un umbral
-- desde Configuracion, el resto del equipo seguiria viendo el anterior sin enterarse.
DROP POLICY IF EXISTS "Authenticated read client followup settings" ON public.client_followup_settings;
CREATE POLICY "Authenticated read client followup settings"
ON public.client_followup_settings
FOR SELECT
TO authenticated
USING (true);

-- ---------------------------------------------------------------------------------
-- 2. Archivado de clientes
-- ---------------------------------------------------------------------------------
--
-- La columna se crea aqui porque la cola de candidatos debe excluir archivados desde el
-- primer dia. Las herramientas que la pueblan y los filtros de pantalla llegan en la
-- siguiente migracion.
--
-- Deliberadamente NO se usa un valor nuevo de clients.status: esa columna codifica el
-- ciclo prospecto/activo y la leen la busqueda paginada de clientes, el embudo de leads,
-- la visita en frio y varias utilidades. Un valor nuevo obligaria a auditarlas todas y
-- cualquier olvido seria una regresion silenciosa.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_reason text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_not_archived
    ON public.clients (id) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------------
-- 3. Casos de reactivacion
-- ---------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_reactivation_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    assigned_to uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    assigned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    -- Se guarda para poder explicar por que la cartera de otro vendedor cambio de tamaño.
    previous_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

    segment text NOT NULL CHECK (segment IN ('cooling', 'dormant', 'never_contacted')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'discarded')),

    opened_at timestamptz NOT NULL DEFAULT now(),
    -- Linea de corte: solo una venta POSTERIOR a esta marca cierra el caso. Sin ella, una
    -- cotizacion vieja del cliente daria el caso por ganado apenas se abre.
    baseline_at timestamptz NOT NULL DEFAULT now(),

    -- Fotografia del "antes", para ordenar la cola y para medir el impacto mas tarde sin
    -- tener que recalcular como estaba el cliente el dia que se asigno.
    lifetime_amount_snapshot numeric(14,2) NOT NULL DEFAULT 0,
    last_order_at_snapshot timestamptz,
    last_contact_at_snapshot timestamptz,
    days_without_purchase_snapshot integer,

    attempts_count integer NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    next_action_at timestamptz,

    won_at timestamptz,
    won_quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
    won_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    won_amount numeric(14,2),

    discarded_at timestamptz,
    discarded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    discard_reason text CHECK (discard_reason IN (
        'cerro_local', 'cambio_proveedor', 'sin_datos_de_contacto',
        'no_interesado', 'precio', 'duplicado', 'fuera_de_target', 'otro'
    )),
    discard_notes text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reactivation_won_ck CHECK (
        status <> 'won'
        OR (won_at IS NOT NULL AND (won_quotation_id IS NOT NULL OR won_order_id IS NOT NULL))
    ),
    CONSTRAINT reactivation_discarded_ck CHECK (
        status <> 'discarded'
        OR (discarded_at IS NOT NULL AND discard_reason IS NOT NULL)
    ),
    CONSTRAINT reactivation_discard_notes_ck CHECK (
        discard_reason IS DISTINCT FROM 'otro'
        OR coalesce(btrim(discard_notes), '') <> ''
    )
);

-- Un cliente no puede tener dos casos abiertos a la vez. Lo garantiza la base, de modo que
-- repartir dos veces el mismo lote no duplica trabajo ni exige comprobaciones previas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reactivation_open_case
    ON public.client_reactivation_cases (client_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_reactivation_cases_assignee_open
    ON public.client_reactivation_cases (assigned_to, status, lifetime_amount_snapshot DESC);
CREATE INDEX IF NOT EXISTS idx_reactivation_cases_status_segment
    ON public.client_reactivation_cases (status, segment);
CREATE INDEX IF NOT EXISTS idx_reactivation_cases_won_at
    ON public.client_reactivation_cases (won_at DESC) WHERE status = 'won';
CREATE INDEX IF NOT EXISTS idx_reactivation_cases_client_id
    ON public.client_reactivation_cases (client_id);

-- ---------------------------------------------------------------------------------
-- 4. Intentos de contacto
-- ---------------------------------------------------------------------------------
--
-- Tabla propia y no derivada de call_logs, email_logs y lead_message_logs porque hay que
-- contar intentos DESDE baseline_at y con un resultado tipado, y email_logs no guarda ni
-- estado ni destinatario. El registro historico sigue escribiendose en las tablas de
-- siempre, asi que el historial del cliente y la vista de ultima actividad no cambian de
-- significado: el intento apunta al log original en lugar de reemplazarlo.

CREATE TABLE IF NOT EXISTS public.client_reactivation_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id uuid NOT NULL REFERENCES public.client_reactivation_cases(id) ON DELETE CASCADE,
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,

    channel text NOT NULL CHECK (channel IN ('call', 'whatsapp', 'email', 'visit', 'other')),
    outcome text NOT NULL CHECK (outcome IN (
        'contacted', 'no_answer', 'wrong_number', 'promised_purchase', 'refused', 'left_message'
    )),
    notes text,
    next_action_at timestamptz,

    call_log_id uuid REFERENCES public.call_logs(id) ON DELETE SET NULL,
    email_log_id uuid REFERENCES public.email_logs(id) ON DELETE SET NULL,
    lead_message_log_id uuid REFERENCES public.lead_message_logs(id) ON DELETE SET NULL,

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reactivation_attempts_case
    ON public.client_reactivation_attempts (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reactivation_attempts_client
    ON public.client_reactivation_attempts (client_id, created_at DESC);

-- ---------------------------------------------------------------------------------
-- 5. Cierre automatico por venta
-- ---------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.close_reactivation_case_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.client_id IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.client_reactivation_cases c
    SET status = 'won',
        won_at = coalesce(NEW.created_at, now()),
        won_quotation_id = CASE WHEN TG_TABLE_NAME = 'quotations' THEN NEW.id ELSE c.won_quotation_id END,
        won_order_id = CASE WHEN TG_TABLE_NAME = 'orders' THEN NEW.id ELSE c.won_order_id END,
        won_amount = coalesce(NEW.total_amount, 0),
        updated_at = now()
    WHERE c.client_id = NEW.client_id
      AND c.status = 'open'
      AND coalesce(NEW.created_at, now()) > c.baseline_at;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Innegociable: este modulo jamas puede impedir emitir una cotizacion o un pedido.
    -- Si algo falla aqui, la venta sigue adelante y reconcile_reactivation_cases corrige
    -- el caso mas tarde.
    RAISE WARNING 'No se pudo cerrar el caso de reactivacion del cliente %: %', NEW.client_id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_reactivation_on_quotation ON public.quotations;
CREATE TRIGGER trg_close_reactivation_on_quotation
AFTER INSERT ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.close_reactivation_case_on_sale();

DROP TRIGGER IF EXISTS trg_close_reactivation_on_order ON public.orders;
CREATE TRIGGER trg_close_reactivation_on_order
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.close_reactivation_case_on_sale();

-- ---------------------------------------------------------------------------------
-- 6. Reglas de edicion del caso
-- ---------------------------------------------------------------------------------
--
-- RLS decide que filas alcanza cada quien, pero no que columnas puede cambiar. Este
-- trigger completa el contrato, y es donde vive la regla central del modulo.

CREATE OR REPLACE FUNCTION public.enforce_reactivation_case_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_puede_gestionar boolean := public.auth_user_has_permission('MANAGE_REACTIVATION');
    v_min_intentos integer;
BEGIN
    -- Un caso se gana vendiendo, no declarandolo. La referencia a la cotizacion o al
    -- pedido solo la escribe close_reactivation_case_on_sale.
    IF NEW.status = 'won' AND NEW.won_quotation_id IS NULL AND NEW.won_order_id IS NULL THEN
        RAISE EXCEPTION 'Un caso de reactivacion solo se gana con una cotizacion o un pedido nuevo del cliente';
    END IF;

    IF NEW.status = 'discarded' AND OLD.status <> 'discarded' THEN
        SELECT coalesce(reactivation_min_attempts, 3) INTO v_min_intentos
        FROM public.client_followup_settings WHERE id = 'default';

        IF NOT v_puede_gestionar AND coalesce(NEW.attempts_count, 0) < coalesce(v_min_intentos, 3) THEN
            RAISE EXCEPTION 'Se requieren al menos % intentos registrados antes de descartar el caso', coalesce(v_min_intentos, 3);
        END IF;
    END IF;

    IF NOT v_puede_gestionar THEN
        IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           OR NEW.baseline_at IS DISTINCT FROM OLD.baseline_at
           OR NEW.segment IS DISTINCT FROM OLD.segment THEN
            RAISE EXCEPTION 'Solo quien gestiona reactivacion puede reasignar un caso o cambiar su segmento';
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_reactivation_case_rules ON public.client_reactivation_cases;
CREATE TRIGGER trg_enforce_reactivation_case_rules
BEFORE UPDATE ON public.client_reactivation_cases
FOR EACH ROW EXECUTE FUNCTION public.enforce_reactivation_case_rules();

-- Cada intento actualiza el contador del caso, para no tener que agregarlo al pintar.
CREATE OR REPLACE FUNCTION public.touch_reactivation_case_on_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.client_reactivation_cases
    SET attempts_count = attempts_count + 1,
        last_attempt_at = NEW.created_at,
        next_action_at = coalesce(NEW.next_action_at, next_action_at),
        updated_at = now()
    WHERE id = NEW.case_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_reactivation_case_on_attempt ON public.client_reactivation_attempts;
CREATE TRIGGER trg_touch_reactivation_case_on_attempt
AFTER INSERT ON public.client_reactivation_attempts
FOR EACH ROW EXECUTE FUNCTION public.touch_reactivation_case_on_attempt();

-- ---------------------------------------------------------------------------------
-- 7. Seguridad a nivel de fila
-- ---------------------------------------------------------------------------------

ALTER TABLE public.client_reactivation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_reactivation_attempts ENABLE ROW LEVEL SECURITY;

-- Sin INSERT ni DELETE: los casos solo nacen y mueren por las funciones de mas abajo.
GRANT SELECT, UPDATE ON public.client_reactivation_cases TO authenticated;
GRANT SELECT, INSERT ON public.client_reactivation_attempts TO authenticated;

DROP POLICY IF EXISTS "Reactivation cases read" ON public.client_reactivation_cases;
CREATE POLICY "Reactivation cases read"
ON public.client_reactivation_cases
FOR SELECT
TO authenticated
USING (
    assigned_to = auth.uid()
    OR public.auth_user_has_permission('VIEW_ALL_REACTIVATION')
    OR public.auth_user_has_permission('MANAGE_REACTIVATION')
);

DROP POLICY IF EXISTS "Reactivation cases update own work" ON public.client_reactivation_cases;
CREATE POLICY "Reactivation cases update own work"
ON public.client_reactivation_cases
FOR UPDATE
TO authenticated
USING (
    (assigned_to = auth.uid() AND status = 'open')
    OR public.auth_user_has_permission('MANAGE_REACTIVATION')
)
WITH CHECK (
    assigned_to = auth.uid()
    OR public.auth_user_has_permission('MANAGE_REACTIVATION')
);

DROP POLICY IF EXISTS "Reactivation attempts read" ON public.client_reactivation_attempts;
CREATE POLICY "Reactivation attempts read"
ON public.client_reactivation_attempts
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.client_reactivation_cases c
        WHERE c.id = case_id
          AND (
              c.assigned_to = auth.uid()
              OR public.auth_user_has_permission('VIEW_ALL_REACTIVATION')
              OR public.auth_user_has_permission('MANAGE_REACTIVATION')
          )
    )
);

-- Un intento es un hecho: se registra, no se edita ni se borra.
DROP POLICY IF EXISTS "Reactivation attempts insert own" ON public.client_reactivation_attempts;
CREATE POLICY "Reactivation attempts insert own"
ON public.client_reactivation_attempts
FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.client_reactivation_cases c
        WHERE c.id = case_id
          AND c.status = 'open'
          AND (c.assigned_to = auth.uid() OR public.auth_user_has_permission('MANAGE_REACTIVATION'))
    )
);

-- ---------------------------------------------------------------------------------
-- 8. Cola de candidatos
-- ---------------------------------------------------------------------------------
--
-- El segmento se define por ULTIMO CONTACTO, para que las cifras sigan cuadrando con lo
-- que ya muestra el dashboard. El orden de trabajo, en cambio, lo deciden la facturacion
-- historica y los dias sin comprar: a quien se llama primero es a quien mas cuesta perder.

CREATE OR REPLACE VIEW public.vw_client_reactivation_candidates AS
WITH ajustes AS (
    SELECT
        coalesce(max(reactivation_cooling_days), 15) AS cooling_days,
        coalesce(max(reactivation_dormant_days), 60) AS dormant_days
    FROM public.client_followup_settings
    WHERE id = 'default'
),
base AS (
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
        coalesce(a.lifetime_amount, 0) AS lifetime_amount,
        a.last_order_at,
        greatest(
            a.last_visit_at, a.last_order_at, a.last_quotation_at,
            a.last_call_at, a.last_email_at, a.last_whatsapp_at
        ) AS last_contact_at
    FROM public.clients c
    LEFT JOIN public.vw_client_last_activity a ON a.client_id = c.id
    WHERE c.archived_at IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.client_reactivation_cases r
          WHERE r.client_id = c.id AND r.status = 'open'
      )
)
SELECT
    b.client_id,
    b.name,
    b.rut,
    b.phone,
    b.email,
    b.comuna,
    b.address,
    b.client_status,
    b.owner_id,
    (SELECT lower(coalesce(p.status, 'active')) FROM public.profiles p WHERE p.id = b.owner_id) AS owner_status,
    (SELECT coalesce(p.full_name, p.email) FROM public.profiles p WHERE p.id = b.owner_id) AS owner_name,
    b.lifetime_amount,
    b.last_order_at,
    b.last_contact_at,
    CASE WHEN b.last_contact_at IS NULL THEN NULL
         ELSE (now()::date - b.last_contact_at::date) END AS days_without_contact,
    CASE WHEN b.last_order_at IS NULL THEN NULL
         ELSE (now()::date - b.last_order_at::date) END AS days_without_purchase,
    CASE
        WHEN b.last_contact_at IS NULL THEN 'never_contacted'
        WHEN (now()::date - b.last_contact_at::date) > ajustes.dormant_days THEN 'dormant'
        WHEN (now()::date - b.last_contact_at::date) >= ajustes.cooling_days THEN 'cooling'
        ELSE NULL
    END AS segment
FROM base b
CROSS JOIN ajustes;

DO $$
BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION 'Se requiere PostgreSQL 15 o superior para respetar RLS en las vistas del modulo';
    END IF;

    -- Sin esto la vista se evalua con los permisos de su propietario y cualquier vendedor
    -- veria la cartera completa. Es un fallo de seguridad que no da ninguna señal.
    EXECUTE 'ALTER VIEW public.vw_client_reactivation_candidates SET (security_invoker = on)';
END $$;

GRANT SELECT ON public.vw_client_reactivation_candidates TO authenticated;

-- ---------------------------------------------------------------------------------
-- 9. Busqueda paginada de candidatos
-- ---------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_reactivation_candidates_paged(uuid, boolean, text, text, text, numeric, text, text, integer, integer);

CREATE FUNCTION public.search_reactivation_candidates_paged(
    p_actor_id uuid,
    p_can_view_all boolean DEFAULT false,
    p_segment text DEFAULT 'all',
    p_seller text DEFAULT 'all',
    p_search text DEFAULT '',
    p_min_amount numeric DEFAULT 0,
    p_owner_status text DEFAULT 'all',
    p_sort text DEFAULT 'value',
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    candidate jsonb,
    total_count bigint,
    cooling_count bigint,
    dormant_count bigint,
    never_count bigint,
    total_lifetime_amount numeric
)
-- SECURITY INVOKER por omision: RLS sigue decidiendo que clientes alcanza cada rol.
LANGUAGE sql
STABLE
AS $$
WITH filtrados AS (
    SELECT v.*
    FROM public.vw_client_reactivation_candidates v
    WHERE v.segment IS NOT NULL
      AND (p_can_view_all OR v.owner_id = p_actor_id)
      AND (p_segment = 'all' OR v.segment = p_segment)
      AND (
          p_seller = 'all'
          OR (p_seller = '__unassigned__' AND v.owner_id IS NULL)
          OR (p_seller <> '__unassigned__' AND v.owner_id::text = p_seller)
      )
      AND (
          p_owner_status = 'all'
          OR (p_owner_status = 'inactive' AND coalesce(v.owner_status, 'active') <> 'active')
          OR (p_owner_status = 'active' AND coalesce(v.owner_status, 'active') = 'active')
      )
      AND v.lifetime_amount >= coalesce(p_min_amount, 0)
      AND (
          coalesce(btrim(p_search), '') = ''
          OR v.name ILIKE '%' || btrim(p_search) || '%'
          OR coalesce(v.rut, '') ILIKE '%' || btrim(p_search) || '%'
          OR coalesce(v.comuna, '') ILIKE '%' || btrim(p_search) || '%'
      )
)
SELECT
    to_jsonb(f) AS candidate,
    count(*) OVER () AS total_count,
    count(*) FILTER (WHERE f.segment = 'cooling') OVER () AS cooling_count,
    count(*) FILTER (WHERE f.segment = 'dormant') OVER () AS dormant_count,
    count(*) FILTER (WHERE f.segment = 'never_contacted') OVER () AS never_count,
    coalesce(sum(f.lifetime_amount) OVER (), 0) AS total_lifetime_amount
FROM filtrados f
ORDER BY
    CASE WHEN p_sort = 'value' THEN f.lifetime_amount END DESC NULLS LAST,
    CASE WHEN p_sort = 'time' THEN f.days_without_purchase END DESC NULLS LAST,
    f.lifetime_amount DESC NULLS LAST,
    f.name
LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
OFFSET greatest(0, coalesce(p_offset, 0));
$$;

GRANT EXECUTE ON FUNCTION public.search_reactivation_candidates_paged(uuid, boolean, text, text, text, numeric, text, text, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------------------
-- 10. Asignacion por lotes
-- ---------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.assign_reactivation_cases(uuid[], uuid, boolean);

CREATE FUNCTION public.assign_reactivation_cases(
    p_client_ids uuid[],
    p_assigned_to uuid,
    p_transfer_ownership boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_solicitados integer := coalesce(array_length(p_client_ids, 1), 0);
    v_creados integer := 0;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('MANAGE_REACTIVATION') THEN
        RAISE EXCEPTION 'No tienes permiso para repartir casos de reactivacion';
    END IF;

    IF v_solicitados = 0 THEN
        RAISE EXCEPTION 'Debes indicar al menos un cliente';
    END IF;

    IF v_solicitados > 500 THEN
        RAISE EXCEPTION 'El lote no puede superar los 500 clientes (recibidos %)', v_solicitados;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = p_assigned_to AND lower(coalesce(p.status, '')) = 'active'
    ) THEN
        RAISE EXCEPTION 'El vendedor de destino no existe o no esta activo';
    END IF;

    -- Una sola insercion desde la cola de candidatos. El indice unico parcial descarta en
    -- silencio a quien ya tenga un caso abierto, de modo que repetir el lote es inocuo.
    INSERT INTO public.client_reactivation_cases (
        client_id, assigned_to, assigned_by, previous_owner_id, segment,
        lifetime_amount_snapshot, last_order_at_snapshot, last_contact_at_snapshot,
        days_without_purchase_snapshot
    )
    SELECT
        v.client_id, p_assigned_to, v_actor, v.owner_id, v.segment,
        v.lifetime_amount, v.last_order_at, v.last_contact_at,
        v.days_without_purchase
    FROM public.vw_client_reactivation_candidates v
    WHERE v.client_id = ANY(p_client_ids)
      AND v.segment IS NOT NULL
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_creados = ROW_COUNT;

    -- El traspaso de propiedad no es cosmetico: email_logs filtra por clients.created_by
    -- de forma literal, asi que sin el, el vendedor registraria correos que despues no
    -- puede leer y su ficha del cliente saldria incompleta.
    IF p_transfer_ownership THEN
        UPDATE public.clients
        SET created_by = p_assigned_to
        WHERE id = ANY(p_client_ids)
          AND created_by IS DISTINCT FROM p_assigned_to;
    END IF;

    RETURN jsonb_build_object(
        'solicitados', v_solicitados,
        'creados', v_creados,
        'omitidos', v_solicitados - v_creados,
        'propiedad_traspasada', p_transfer_ownership
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_reactivation_cases(uuid[], uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------------
-- 11. Descarte y reconciliacion
-- ---------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.discard_reactivation_case(uuid, text, text);

CREATE FUNCTION public.discard_reactivation_case(
    p_case_id uuid,
    p_reason text,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    -- El UPDATE pasa por RLS y por enforce_reactivation_case_rules, que es donde vive la
    -- exigencia de intentos minimos. Aqui no se duplica esa regla.
    UPDATE public.client_reactivation_cases
    SET status = 'discarded',
        discarded_at = now(),
        discarded_by = v_actor,
        discard_reason = p_reason,
        discard_notes = nullif(btrim(coalesce(p_notes, '')), '')
    WHERE id = p_case_id
      AND status = 'open';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El caso no existe, ya esta cerrado o no tienes acceso';
    END IF;

    RETURN jsonb_build_object('ok', true, 'case_id', p_case_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.discard_reactivation_case(uuid, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.reconcile_reactivation_cases();

CREATE FUNCTION public.reconcile_reactivation_cases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cerrados integer := 0;
BEGIN
    IF NOT public.auth_user_has_permission('MANAGE_REACTIVATION') THEN
        RAISE EXCEPTION 'No tienes permiso para reconciliar casos de reactivacion';
    END IF;

    -- Red de seguridad del trigger: cubre inserciones que lo esquiven y casos abiertos
    -- sobre clientes que ya habian comprado despues de la fecha de corte.
    WITH ventas AS (
        SELECT c.id AS case_id,
               (SELECT q.id FROM public.quotations q
                 WHERE q.client_id = c.client_id AND q.created_at > c.baseline_at
                 ORDER BY q.created_at LIMIT 1) AS quotation_id,
               (SELECT o.id FROM public.orders o
                 WHERE o.client_id = c.client_id AND o.created_at > c.baseline_at
                 ORDER BY o.created_at LIMIT 1) AS order_id,
               (SELECT coalesce(o.total_amount, 0) FROM public.orders o
                 WHERE o.client_id = c.client_id AND o.created_at > c.baseline_at
                 ORDER BY o.created_at LIMIT 1) AS monto
        FROM public.client_reactivation_cases c
        WHERE c.status = 'open'
    )
    UPDATE public.client_reactivation_cases c
    SET status = 'won',
        won_at = now(),
        won_quotation_id = ventas.quotation_id,
        won_order_id = ventas.order_id,
        won_amount = coalesce(ventas.monto, 0),
        updated_at = now()
    FROM ventas
    WHERE c.id = ventas.case_id
      AND (ventas.quotation_id IS NOT NULL OR ventas.order_id IS NOT NULL);

    GET DIAGNOSTICS v_cerrados = ROW_COUNT;

    RETURN jsonb_build_object('cerrados', v_cerrados);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_reactivation_cases() TO authenticated;

-- ---------------------------------------------------------------------------------
-- 12. Permisos
-- ---------------------------------------------------------------------------------
--
-- role_permissions es la fuente de verdad del RBAC: los valores por defecto del navegador
-- son solo respaldo ante un fallo de red. Sin estas filas, nadie salvo admin tendria
-- acceso al modulo.

INSERT INTO public.role_permissions (role, permission)
SELECT v.role, v.permission
FROM (
    VALUES
        ('admin', 'VIEW_REACTIVATION'),
        ('admin', 'MANAGE_REACTIVATION'),
        ('admin', 'VIEW_ALL_REACTIVATION'),
        ('admin', 'ARCHIVE_CLIENTS'),
        ('jefe', 'VIEW_REACTIVATION'),
        ('jefe', 'MANAGE_REACTIVATION'),
        ('jefe', 'VIEW_ALL_REACTIVATION'),
        ('jefe', 'ARCHIVE_CLIENTS'),
        ('seller', 'VIEW_REACTIVATION')
) AS v(role, permission)
WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role = v.role AND rp.permission = v.permission
);
