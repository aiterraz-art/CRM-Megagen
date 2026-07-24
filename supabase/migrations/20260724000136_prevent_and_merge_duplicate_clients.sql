CREATE OR REPLACE FUNCTION public.normalize_client_match_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(
    regexp_replace(
      translate(lower(coalesce(value, '')), 'áéíóúäëïöüàèìòùñ', 'aeiouaeiouaeioun'),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_client_match_email(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(coalesce(value, '')));
$$;

CREATE OR REPLACE FUNCTION public.normalize_client_match_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN regexp_replace(coalesce(value, ''), '\D', '', 'g') ~ '^56[0-9]{9,}$'
      THEN right(regexp_replace(coalesce(value, ''), '\D', '', 'g'), 9)
    ELSE regexp_replace(coalesce(value, ''), '\D', '', 'g')
  END;
$$;

CREATE OR REPLACE FUNCTION public.find_client_duplicate_candidates()
RETURNS TABLE (
  primary_client_id uuid,
  duplicate_client_id uuid,
  primary_name text,
  duplicate_name text,
  matched_by text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH normalized AS (
  SELECT
    c.id,
    c.created_at,
    c.name,
    public.normalize_client_match_text(c.name) AS name_key,
    public.normalize_client_match_text(c.address) AS address_key,
    public.normalize_client_match_text(c.purchase_contact) AS contact_key,
    public.normalize_client_match_text(c.comuna) AS comuna_key,
    public.normalize_client_match_text(c.office) AS office_key,
    public.normalize_client_match_email(c.email) AS email_key,
    public.normalize_client_match_phone(c.phone) AS phone_key,
    c.lat,
    c.lng
  FROM public.clients c
),
pairs AS (
  SELECT
    CASE WHEN a.created_at <= b.created_at THEN a.id ELSE b.id END AS primary_client_id,
    CASE WHEN a.created_at <= b.created_at THEN b.id ELSE a.id END AS duplicate_client_id,
    CASE WHEN a.created_at <= b.created_at THEN a.name ELSE b.name END AS primary_name,
    CASE WHEN a.created_at <= b.created_at THEN b.name ELSE a.name END AS duplicate_name,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN a.email_key <> '' AND a.email_key = b.email_key THEN 'email' END,
      CASE WHEN a.name_key <> '' AND a.name_key = b.name_key AND a.phone_key <> '' AND a.phone_key = b.phone_key THEN 'phone_name' END,
      CASE WHEN a.name_key <> '' AND a.name_key = b.name_key AND a.address_key <> '' AND a.address_key = b.address_key THEN 'name_address' END,
      CASE WHEN a.name_key <> '' AND a.name_key = b.name_key AND a.contact_key <> '' AND a.contact_key = b.contact_key THEN 'name_contact' END,
      CASE
        WHEN a.name_key <> '' AND a.name_key = b.name_key
          AND a.comuna_key <> '' AND a.comuna_key = b.comuna_key
          AND (
            (a.office_key <> '' AND a.office_key = b.office_key)
            OR (a.lat IS NOT NULL AND a.lng IS NOT NULL AND b.lat IS NOT NULL AND b.lng IS NOT NULL
              AND abs(a.lat - b.lat) <= 0.003 AND abs(a.lng - b.lng) <= 0.003)
          )
        THEN 'name_location'
      END
    ], NULL::text) AS matched_by
  FROM normalized a
  JOIN normalized b ON a.id < b.id
)
SELECT
  primary_client_id,
  duplicate_client_id,
  primary_name,
  duplicate_name,
  matched_by
FROM pairs
WHERE cardinality(matched_by) > 0;
$$;

REVOKE ALL ON FUNCTION public.find_client_duplicate_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_client_duplicate_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_client_duplicates(
  p_primary_client_id uuid,
  p_duplicate_client_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_primary public.clients%ROWTYPE;
  v_duplicate_ids uuid[];
  v_client_ids uuid[];
  v_name text;
  v_rut text;
  v_email text;
  v_phone text;
  v_address text;
  v_purchase_contact text;
  v_comuna text;
  v_office text;
  v_giro text;
  v_doctor_specialty text;
  v_zone text;
  v_notes text;
  v_status text;
  v_created_by uuid;
  v_pending_seller_email text;
  v_credit_days integer;
  v_lead_score integer;
  v_requires_discount_approval boolean;
  v_last_visit_date timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_table_name text;
  v_updated_tables text[] := ARRAY[]::text[];
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para fusionar clientes';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF coalesce(v_actor_role, '') NOT IN ('admin', 'jefe', 'facturador', 'tesorero') THEN
    RAISE EXCEPTION 'No tienes permisos para fusionar clientes';
  END IF;

  v_duplicate_ids := ARRAY(
    SELECT DISTINCT duplicate_id
    FROM unnest(coalesce(p_duplicate_client_ids, ARRAY[]::uuid[])) AS duplicate_id
    WHERE duplicate_id IS NOT NULL
      AND duplicate_id <> p_primary_client_id
  );

  IF cardinality(v_duplicate_ids) = 0 THEN
    RAISE EXCEPTION 'Debes indicar al menos un cliente duplicado';
  END IF;

  SELECT *
  INTO v_primary
  FROM public.clients
  WHERE id = p_primary_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente principal no existe';
  END IF;

  v_client_ids := array_prepend(p_primary_client_id, v_duplicate_ids);

  SELECT candidate.name
  INTO v_name
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.name), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.name) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.rut
  INTO v_rut
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.rut), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.email
  INTO v_email
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.email), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.email) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.phone
  INTO v_phone
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.phone), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.phone) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.address
  INTO v_address
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.address), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.address) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.purchase_contact
  INTO v_purchase_contact
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.purchase_contact), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.purchase_contact) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.comuna
  INTO v_comuna
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.comuna), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.comuna) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.office
  INTO v_office
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.office), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.office) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.giro
  INTO v_giro
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.giro), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.giro) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.doctor_specialty
  INTO v_doctor_specialty
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.doctor_specialty), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.doctor_specialty) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.zone
  INTO v_zone
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.zone), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.zone) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT string_agg(DISTINCT nullif(btrim(candidate.notes), ''), ' | ')
  INTO v_notes
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT candidate.status
  INTO v_status
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
  ORDER BY CASE coalesce(candidate.status, '')
    WHEN 'active' THEN 6
    WHEN 'prospect_evaluating' THEN 5
    WHEN 'prospect_contacted' THEN 4
    WHEN 'prospect_new' THEN 3
    WHEN 'prospect' THEN 2
    WHEN 'lead' THEN 1
    ELSE 0
  END DESC, (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.created_by
  INTO v_created_by
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND candidate.created_by IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.pending_seller_email
  INTO v_pending_seller_email
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.pending_seller_email), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT max(coalesce(candidate.credit_days, 0))
  INTO v_credit_days
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT max(candidate.lead_score)
  INTO v_lead_score
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT bool_or(coalesce(candidate.requires_discount_approval, false))
  INTO v_requires_discount_approval
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT max(candidate.last_visit_date)
  INTO v_last_visit_date
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT candidate.lat, candidate.lng
  INTO v_lat, v_lng
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND candidate.lat IS NOT NULL
    AND candidate.lng IS NOT NULL
    AND abs(candidate.lat) > 0.0001
    AND abs(candidate.lng) > 0.0001
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  UPDATE public.clients
  SET
    name = coalesce(v_name, name),
    rut = coalesce(v_rut, rut),
    email = coalesce(v_email, email),
    phone = coalesce(v_phone, phone),
    address = coalesce(v_address, address),
    purchase_contact = coalesce(v_purchase_contact, purchase_contact),
    comuna = coalesce(v_comuna, comuna),
    office = coalesce(v_office, office),
    giro = coalesce(v_giro, giro),
    doctor_specialty = coalesce(v_doctor_specialty, doctor_specialty),
    zone = coalesce(v_zone, zone),
    notes = coalesce(left(v_notes, 4000), notes),
    status = coalesce(v_status, status),
    created_by = coalesce(v_created_by, created_by),
    pending_seller_email = coalesce(v_pending_seller_email, pending_seller_email),
    credit_days = greatest(coalesce(v_credit_days, 0), coalesce(credit_days, 0)),
    lead_score = greatest(coalesce(v_lead_score, 0), coalesce(lead_score, 0)),
    requires_discount_approval = coalesce(v_requires_discount_approval, requires_discount_approval),
    last_visit_date = coalesce(v_last_visit_date, last_visit_date),
    lat = coalesce(v_lat, lat),
    lng = coalesce(v_lng, lng),
    updated_at = now()
  WHERE id = p_primary_client_id;

  FOREACH v_table_name IN ARRAY ARRAY[
    'visits',
    'orders',
    'quotations',
    'tasks',
    'installed_base',
    'lead_message_logs',
    'kit_loan_requests',
    'size_change_requests',
    'dispatch_queue_items',
    'call_logs',
    'email_logs'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table_name
        AND column_name = 'client_id'
    ) THEN
      EXECUTE format('UPDATE public.%I SET client_id = $1 WHERE client_id = ANY($2)', v_table_name)
      USING p_primary_client_id, v_duplicate_ids;
      v_updated_tables := array_append(v_updated_tables, v_table_name);
    END IF;
  END LOOP;

  DELETE FROM public.clients
  WHERE id = ANY(v_duplicate_ids);

  RETURN jsonb_build_object(
    'merged_into', p_primary_client_id,
    'duplicate_ids', v_duplicate_ids,
    'updated_tables', v_updated_tables
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_client_duplicates(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_client_duplicates(uuid, uuid[]) TO authenticated;
