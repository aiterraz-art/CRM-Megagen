-- Reconocer los campos del formulario por lo que preguntan, no por su nombre exacto.
--
-- Quien arma el formulario en Meta bautiza los campos a mano, así que la región
-- llega como "¿a_que_región_o_comuna_pertenece?" y la especialidad como
-- "especilidad_odontológica", con la errata incluida. Exigir el nombre exacto
-- dejaba esos datos solo dentro de las notas: no se perdían, pero el lead no
-- salía en el mapa ni se podía filtrar por zona, que es justo lo que sirve para
-- decidir a qué vendedor dárselo.

-- Nombres comparables: sin tildes, sin signos y en minúsculas.
CREATE OR REPLACE FUNCTION public.meta_normalize_key(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(
        lower(translate(
            coalesce(p_value, ''),
            'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
            'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
        )),
        '[^a-z0-9]', '', 'g'
    )
$$;

-- Devuelve el primer campo cuyo nombre contenga alguna de las pistas.
CREATE OR REPLACE FUNCTION public.meta_lead_field_like(p_field_data JSONB, p_needles TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT nullif(btrim(entry.value), '')
    FROM jsonb_array_elements(coalesce(p_field_data, '[]'::jsonb)) AS item,
         LATERAL (
             SELECT public.meta_normalize_key(coalesce(item->>'name', '')) AS clave,
                    coalesce(item->'values'->>0, item->>'value', '') AS value
         ) AS entry
    WHERE nullif(btrim(entry.value), '') IS NOT NULL
      AND EXISTS (
          SELECT 1 FROM unnest(p_needles) AS pista
          WHERE entry.clave LIKE '%' || public.meta_normalize_key(pista) || '%'
      )
    LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.meta_normalize_key(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meta_lead_field_like(JSONB, TEXT[]) TO authenticated, service_role;

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
    v_specialty TEXT;
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

    -- Primero el nombre exacto; si no, cualquier campo que pregunte por el lugar.
    v_comuna := coalesce(
        public.meta_lead_field(p_field_data, ARRAY['city','ciudad','comuna','localidad','region','región']),
        public.meta_lead_field_like(p_field_data, ARRAY['comuna','region','ciudad','localidad'])
    );

    -- 'especilidad' va a propósito: es como está escrito en el formulario real.
    v_specialty := coalesce(
        public.meta_lead_field(p_field_data, ARRAY['specialty','especialidad','especialidad_odontologica']),
        public.meta_lead_field_like(p_field_data, ARRAY['especialidad','especilidad','specialty','odontolog'])
    );

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

    v_note_parts := ARRAY['Generado desde Meta Ads'];
    IF v_campaign IS NOT NULL THEN v_note_parts := v_note_parts || ('Campaña: ' || v_campaign); END IF;
    IF v_adset IS NOT NULL THEN v_note_parts := v_note_parts || ('Adset: ' || v_adset); END IF;
    IF v_ad IS NOT NULL THEN v_note_parts := v_note_parts || ('Anuncio: ' || v_ad); END IF;
    IF v_form IS NOT NULL THEN v_note_parts := v_note_parts || ('Formulario: ' || v_form); END IF;
    IF v_company IS NOT NULL THEN v_note_parts := v_note_parts || ('Empresa: ' || v_company); END IF;

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

        UPDATE public.clients
        SET email = coalesce(nullif(btrim(coalesce(email, '')), ''), v_email),
            phone = coalesce(nullif(btrim(coalesce(phone, '')), ''), v_phone_raw),
            comuna = coalesce(nullif(btrim(coalesce(comuna, '')), ''), v_comuna),
            doctor_specialty = coalesce(nullif(btrim(coalesce(doctor_specialty, '')), ''), v_specialty),
            notes = btrim(concat_ws(' | ', nullif(btrim(coalesce(notes, '')), ''), array_to_string(v_note_parts, ' | '))),
            updated_at = timezone('utc', now())
        WHERE id = v_client.id;
    ELSE
        v_action := 'created';
        v_client_id := gen_random_uuid();

        INSERT INTO public.clients (id, name, email, phone, purchase_contact, comuna, doctor_specialty, notes, status, created_by)
        VALUES (
            v_client_id,
            v_name,
            v_email,
            nullif(btrim(coalesce(v_phone_raw, '')), ''),
            v_name,
            v_comuna,
            v_specialty,
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

REVOKE ALL ON FUNCTION public.process_meta_lead(TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_meta_lead(TEXT, JSONB, JSONB) TO service_role;
