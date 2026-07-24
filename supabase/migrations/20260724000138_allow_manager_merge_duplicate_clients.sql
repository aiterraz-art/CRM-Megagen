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

  SELECT lower(coalesce(role, '')) INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'manager', 'jefe', 'facturador', 'tesorero') THEN
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
    lead_score = CASE
      WHEN v_lead_score IS NULL AND lead_score IS NULL THEN NULL
      ELSE least(3, greatest(1, greatest(coalesce(v_lead_score, 1), coalesce(lead_score, 1))))
    END,
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
