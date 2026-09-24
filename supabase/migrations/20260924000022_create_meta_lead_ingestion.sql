-- Ingesta automática de leads de Meta Lead Ads.
--
-- El webhook de Meta llega a la Edge Function meta-leads-webhook, que solo
-- valida la firma y llama a estas funciones. Toda la lógica de negocio vive
-- aquí para que sea verificable por SQL y no dependa del despliegue de Deno.
--
-- Contrato de idempotencia: Meta reenvía el mismo lead varias veces (reintentos
-- ante timeout, reentregas tras un fallo). La clave única leadgen_id es lo que
-- impide que un reenvío cree un cliente duplicado.

-- ---------------------------------------------------------------------------
-- 1. Registro crudo de lo que manda Meta
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.meta_lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    leadgen_id TEXT NOT NULL,
    page_id TEXT,
    form_id TEXT,
    ad_id TEXT,
    adgroup_id TEXT,
    campaign_id TEXT,
    meta_created_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    processed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'received',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    raw_payload JSONB,
    field_data JSONB,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    client_action TEXT,
    CONSTRAINT meta_lead_events_status_check
        CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
    CONSTRAINT meta_lead_events_client_action_check
        CHECK (client_action IS NULL OR client_action IN ('created', 'matched'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_lead_events_leadgen
    ON public.meta_lead_events (leadgen_id);

CREATE INDEX IF NOT EXISTS idx_meta_lead_events_pending
    ON public.meta_lead_events (received_at)
    WHERE status IN ('received', 'failed');

CREATE INDEX IF NOT EXISTS idx_meta_lead_events_received
    ON public.meta_lead_events (received_at DESC);

ALTER TABLE public.meta_lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_lead_events_select ON public.meta_lead_events;
CREATE POLICY meta_lead_events_select ON public.meta_lead_events
    FOR SELECT TO authenticated
    USING (public.auth_user_has_permission('IMPORT_CLIENTS'));

-- Nadie escribe directo: solo las funciones SECURITY DEFINER de más abajo.
REVOKE ALL ON public.meta_lead_events FROM anon, authenticated;
GRANT SELECT ON public.meta_lead_events TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Lectura del formulario de Meta
-- ---------------------------------------------------------------------------

-- field_data llega como [{"name":"full_name","values":["Juan Pérez"]}, ...].
-- Los nombres de los campos los define quien arma el formulario en Meta, así
-- que hay que aceptar variantes y no un nombre fijo.
CREATE OR REPLACE FUNCTION public.meta_lead_field(p_field_data JSONB, p_aliases TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT nullif(btrim(entry.value), '')
    FROM jsonb_array_elements(coalesce(p_field_data, '[]'::jsonb)) AS item,
         LATERAL (
             SELECT coalesce(item->>'name', '') AS field_name,
                    coalesce(item->'values'->>0, item->>'value', '') AS value
         ) AS entry
    WHERE lower(entry.field_name) = ANY (SELECT lower(alias) FROM unnest(p_aliases) AS alias)
      AND nullif(btrim(entry.value), '') IS NOT NULL
    LIMIT 1
$$;

-- Misma normalización que usa la detección de duplicados del navegador
-- (src/utils/clientDuplicates.ts): solo dígitos, y si viene con 56 delante se
-- queda con los últimos nueve.
CREATE OR REPLACE FUNCTION public.meta_normalize_phone(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN digits = '' THEN ''
        WHEN length(digits) > 9 AND left(digits, 2) = '56' THEN right(digits, 9)
        ELSE digits
    END
    FROM (SELECT regexp_replace(coalesce(p_value, ''), '\D', '', 'g') AS digits) AS s
$$;

-- ---------------------------------------------------------------------------
-- 3. Recepción: guardar el aviso y responder rápido
-- ---------------------------------------------------------------------------

-- Meta desactiva el webhook si tarda o falla de forma repetida, así que el
-- primer paso solo escribe el aviso crudo. La consulta a la Graph API y el
-- alta del cliente van después, y si fallan el aviso queda pendiente.
CREATE OR REPLACE FUNCTION public.record_meta_lead_event(
    p_leadgen_id TEXT,
    p_page_id TEXT DEFAULT NULL,
    p_form_id TEXT DEFAULT NULL,
    p_ad_id TEXT DEFAULT NULL,
    p_adgroup_id TEXT DEFAULT NULL,
    p_campaign_id TEXT DEFAULT NULL,
    p_created_time TIMESTAMPTZ DEFAULT NULL,
    p_raw_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.meta_lead_events%ROWTYPE;
    v_is_new BOOLEAN := false;
BEGIN
    IF nullif(btrim(coalesce(p_leadgen_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'leadgen_id es obligatorio';
    END IF;

    INSERT INTO public.meta_lead_events (
        leadgen_id, page_id, form_id, ad_id, adgroup_id, campaign_id,
        meta_created_at, raw_payload, status
    )
    VALUES (
        btrim(p_leadgen_id), p_page_id, p_form_id, p_ad_id, p_adgroup_id, p_campaign_id,
        p_created_time, p_raw_payload, 'received'
    )
    ON CONFLICT (leadgen_id) DO NOTHING
    RETURNING * INTO v_event;

    IF v_event.id IS NOT NULL THEN
        v_is_new := true;
    ELSE
        SELECT * INTO v_event
        FROM public.meta_lead_events
        WHERE leadgen_id = btrim(p_leadgen_id);
    END IF;

    RETURN jsonb_build_object(
        'event_id', v_event.id,
        'is_new', v_is_new,
        'status', v_event.status,
        'client_id', v_event.client_id,
        'needs_processing', v_event.status IN ('received', 'failed')
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Procesamiento: convertir el lead en cliente
-- ---------------------------------------------------------------------------

-- Cruce conservador a propósito: solo correo exacto o teléfono normalizado.
-- La detección completa de duplicados también cruza por nombre y dirección,
-- pero aquí un falso positivo fusionaría el lead con el cliente equivocado sin
-- que nadie lo revise, así que se prefiere crear de más a fusionar de más.
CREATE OR REPLACE FUNCTION public.process_meta_lead(
    p_leadgen_id TEXT,
    p_field_data JSONB,
    p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event public.meta_lead_events%ROWTYPE;
    v_name TEXT;
    v_first_name TEXT;
    v_last_name TEXT;
    v_email TEXT;
    v_phone_raw TEXT;
    v_phone TEXT;
    v_company TEXT;
    v_comuna TEXT;
    v_campaign TEXT;
    v_adset TEXT;
    v_ad TEXT;
    v_form TEXT;
    v_note_parts TEXT[];
    v_extra TEXT;
    v_client public.clients%ROWTYPE;
    v_client_id UUID;
    v_action TEXT;
BEGIN
    SELECT * INTO v_event
    FROM public.meta_lead_events
    WHERE leadgen_id = btrim(coalesce(p_leadgen_id, ''));

    IF v_event.id IS NULL THEN
        RAISE EXCEPTION 'No existe el aviso de Meta %', p_leadgen_id;
    END IF;

    -- Reentrada segura: si ya se procesó, no se vuelve a crear nada.
    IF v_event.status = 'processed' THEN
        RETURN jsonb_build_object(
            'event_id', v_event.id,
            'client_id', v_event.client_id,
            'action', coalesce(v_event.client_action, 'matched'),
            'already_processed', true
        );
    END IF;

    v_name       := public.meta_lead_field(p_field_data, ARRAY['full_name','nombre_completo','nombre y apellido','name','nombre','contact_name']);
    v_first_name := public.meta_lead_field(p_field_data, ARRAY['first_name','nombre','primer_nombre']);
    v_last_name  := public.meta_lead_field(p_field_data, ARRAY['last_name','apellido','apellidos']);
    v_email      := public.meta_lead_field(p_field_data, ARRAY['email','correo','correo_electronico','e-mail','mail']);
    v_phone_raw  := public.meta_lead_field(p_field_data, ARRAY['phone_number','phone','telefono','teléfono','celular','movil','móvil','numero_de_telefono']);
    v_company    := public.meta_lead_field(p_field_data, ARRAY['company_name','empresa','clinica','clínica','nombre_de_la_clinica']);
    v_comuna     := public.meta_lead_field(p_field_data, ARRAY['city','ciudad','comuna','localidad']);

    IF v_name IS NULL THEN
        v_name := nullif(btrim(concat_ws(' ', v_first_name, v_last_name)), '');
    END IF;
    IF v_name IS NULL THEN
        v_name := v_company;
    END IF;

    v_email := lower(nullif(btrim(coalesce(v_email, '')), ''));
    v_phone := public.meta_normalize_phone(v_phone_raw);
    IF v_phone = '' THEN
        v_phone := NULL;
    END IF;

    -- Un lead sin nombre y sin forma de contactarlo no sirve de nada.
    IF v_name IS NULL AND v_email IS NULL AND v_phone IS NULL THEN
        UPDATE public.meta_lead_events
        SET status = 'ignored',
            field_data = p_field_data,
            processed_at = timezone('utc', now()),
            last_error = 'El formulario no trae nombre, correo ni teléfono'
        WHERE id = v_event.id;

        RETURN jsonb_build_object('event_id', v_event.id, 'action', 'ignored', 'client_id', NULL);
    END IF;

    IF v_name IS NULL THEN
        v_name := coalesce(v_email, v_phone_raw, 'Lead de Meta');
    END IF;

    v_campaign := nullif(btrim(coalesce(p_context->>'campaign_name', '')), '');
    v_adset    := nullif(btrim(coalesce(p_context->>'adset_name', '')), '');
    v_ad       := nullif(btrim(coalesce(p_context->>'ad_name', '')), '');
    v_form     := nullif(btrim(coalesce(p_context->>'form_name', '')), '');

    -- Mismo formato de notas que usa la importación manual por CSV, para que la
    -- pantalla de Meta Leads siga mostrando campaña y anuncio como pares.
    v_note_parts := ARRAY['Generado desde Meta Ads'];
    IF v_campaign IS NOT NULL THEN v_note_parts := v_note_parts || ('Campaña: ' || v_campaign); END IF;
    IF v_adset IS NOT NULL THEN v_note_parts := v_note_parts || ('Adset: ' || v_adset); END IF;
    IF v_ad IS NOT NULL THEN v_note_parts := v_note_parts || ('Anuncio: ' || v_ad); END IF;
    IF v_form IS NOT NULL THEN v_note_parts := v_note_parts || ('Formulario: ' || v_form); END IF;
    IF v_company IS NOT NULL THEN v_note_parts := v_note_parts || ('Empresa: ' || v_company); END IF;
    IF v_comuna IS NOT NULL THEN v_note_parts := v_note_parts || ('Ciudad: ' || v_comuna); END IF;

    -- Respuestas libres del formulario: se guardan tal cual para no perderlas.
    FOR v_extra IN
        SELECT coalesce(item->>'name', '') || ': ' || coalesce(item->'values'->>0, '')
        FROM jsonb_array_elements(coalesce(p_field_data, '[]'::jsonb)) AS item
        WHERE nullif(btrim(coalesce(item->'values'->>0, '')), '') IS NOT NULL
          AND lower(coalesce(item->>'name', '')) NOT IN (
              'full_name','first_name','last_name','email','phone_number','phone'
          )
    LOOP
        v_note_parts := v_note_parts || v_extra;
    END LOOP;

    v_note_parts := v_note_parts || ('Lead Meta: ' || v_event.leadgen_id);

    -- Cruce con la cartera existente.
    IF v_email IS NOT NULL THEN
        SELECT * INTO v_client
        FROM public.clients
        WHERE lower(btrim(coalesce(email, ''))) = v_email
        ORDER BY (archived_at IS NULL) DESC, created_at ASC
        LIMIT 1;
    END IF;

    IF v_client.id IS NULL AND v_phone IS NOT NULL THEN
        SELECT * INTO v_client
        FROM public.clients
        WHERE public.meta_normalize_phone(phone) = v_phone
        ORDER BY (archived_at IS NULL) DESC, created_at ASC
        LIMIT 1;
    END IF;

    IF v_client.id IS NOT NULL THEN
        v_client_id := v_client.id;
        v_action := 'matched';

        -- Un cliente que ya existe no vuelve a ser prospecto ni cambia de dueño:
        -- solo se le completan los huecos y se le deja la constancia del lead.
        UPDATE public.clients
        SET email = coalesce(nullif(btrim(coalesce(email, '')), ''), v_email),
            phone = coalesce(nullif(btrim(coalesce(phone, '')), ''), v_phone_raw),
            notes = btrim(concat_ws(' | ', nullif(btrim(coalesce(notes, '')), ''), array_to_string(v_note_parts, ' | '))),
            updated_at = timezone('utc', now())
        WHERE id = v_client.id;
    ELSE
        v_action := 'created';
        v_client_id := gen_random_uuid();

        -- created_by queda nulo a propósito: el lead entra sin dueño y se
        -- reparte después, igual que con la importación manual.
        INSERT INTO public.clients (id, name, email, phone, purchase_contact, comuna, notes, status, created_by)
        VALUES (
            v_client_id,
            v_name,
            v_email,
            nullif(btrim(coalesce(v_phone_raw, '')), ''),
            v_name,
            v_comuna,
            array_to_string(v_note_parts, ' | '),
            'prospect_new',
            NULL
        );
    END IF;

    UPDATE public.meta_lead_events
    SET status = 'processed',
        field_data = p_field_data,
        client_id = v_client_id,
        client_action = v_action,
        processed_at = timezone('utc', now()),
        last_error = NULL
    WHERE id = v_event.id;

    RETURN jsonb_build_object(
        'event_id', v_event.id,
        'client_id', v_client_id,
        'action', v_action,
        'already_processed', false
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reintentos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fail_meta_lead_event(p_leadgen_id TEXT, p_error TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.meta_lead_events
    SET status = 'failed',
        attempts = attempts + 1,
        last_error = left(coalesce(p_error, 'error desconocido'), 2000)
    WHERE leadgen_id = btrim(coalesce(p_leadgen_id, ''))
      AND status <> 'processed';
$$;

-- Avisos que quedaron sin convertirse en cliente, normalmente porque la Graph
-- API no respondió. Se dejan de reintentar a los diez intentos para que un
-- lead roto no consuma la ventana de reintentos de los demás.
CREATE OR REPLACE FUNCTION public.pending_meta_lead_events(p_limit INTEGER DEFAULT 25)
RETURNS TABLE (
    leadgen_id TEXT,
    page_id TEXT,
    form_id TEXT,
    attempts INTEGER,
    received_at TIMESTAMPTZ,
    last_error TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT e.leadgen_id, e.page_id, e.form_id, e.attempts, e.received_at, e.last_error
    FROM public.meta_lead_events e
    WHERE e.status IN ('received', 'failed')
      AND e.attempts < 10
    ORDER BY e.received_at ASC
    LIMIT greatest(1, least(coalesce(p_limit, 25), 200));
$$;

-- ---------------------------------------------------------------------------
-- 6. Salud de la integración, para la pantalla
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.meta_lead_ingestion_health()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'total', count(*),
        'processed', count(*) FILTER (WHERE status = 'processed'),
        'pending', count(*) FILTER (WHERE status IN ('received', 'failed')),
        'ignored', count(*) FILTER (WHERE status = 'ignored'),
        'created_clients', count(*) FILTER (WHERE client_action = 'created'),
        'matched_clients', count(*) FILTER (WHERE client_action = 'matched'),
        'last_received_at', max(received_at),
        'last_processed_at', max(processed_at)
    )
    FROM public.meta_lead_events
    WHERE public.auth_user_has_permission('IMPORT_CLIENTS');
$$;

-- ---------------------------------------------------------------------------
-- 7. Permisos de ejecución
-- ---------------------------------------------------------------------------

-- Solo la Edge Function (service_role) puede escribir leads.
REVOKE ALL ON FUNCTION public.record_meta_lead_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_meta_lead(TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_meta_lead_event(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pending_meta_lead_events(INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_meta_lead_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_meta_lead(TEXT, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_meta_lead_event(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pending_meta_lead_events(INTEGER) TO service_role;

GRANT EXECUTE ON FUNCTION public.meta_lead_field(JSONB, TEXT[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_normalize_phone(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_lead_ingestion_health() TO authenticated;
