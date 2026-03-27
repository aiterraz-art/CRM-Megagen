CREATE OR REPLACE FUNCTION public.replace_collections_pending(
  p_file_name text,
  p_uploaded_by uuid,
  p_rows jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_batch_id uuid;
  v_current_batch_id uuid;
  v_incoming_count integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows debe ser un arreglo JSON';
  END IF;

  SELECT id INTO v_current_batch_id
  FROM public.collections_import_batches
  WHERE is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  DROP TABLE IF EXISTS tmp_collections_previous;
  DROP TABLE IF EXISTS tmp_collections_incoming;

  CREATE TEMP TABLE tmp_collections_previous (
    normalized_document_number text PRIMARY KEY,
    seller_id uuid,
    seller_email text,
    seller_name text,
    seller_comment text,
    seller_comment_updated_at timestamptz,
    seller_comment_updated_by uuid
  ) ON COMMIT DROP;

  IF v_current_batch_id IS NOT NULL THEN
    INSERT INTO tmp_collections_previous (
      normalized_document_number,
      seller_id,
      seller_email,
      seller_name,
      seller_comment,
      seller_comment_updated_at,
      seller_comment_updated_by
    )
    SELECT DISTINCT ON (lower(trim(cp.document_number)))
      lower(trim(cp.document_number)) AS normalized_document_number,
      cp.seller_id,
      cp.seller_email,
      cp.seller_name,
      cp.seller_comment,
      cp.seller_comment_updated_at,
      cp.seller_comment_updated_by
    FROM public.collections_pending cp
    WHERE cp.batch_id = v_current_batch_id
      AND NULLIF(trim(cp.document_number), '') IS NOT NULL
    ORDER BY lower(trim(cp.document_number)), cp.created_at DESC, cp.id DESC;
  END IF;

  CREATE TEMP TABLE tmp_collections_incoming (
    normalized_document_number text PRIMARY KEY,
    normalized_client_rut text,
    seller_email text,
    seller_name text,
    client_name text,
    client_rut text,
    document_number text,
    document_type text,
    issue_date date,
    due_date date,
    amount numeric,
    outstanding_amount numeric,
    status text,
    notes text
  ) ON COMMIT DROP;

  INSERT INTO tmp_collections_incoming (
    normalized_document_number,
    normalized_client_rut,
    seller_email,
    seller_name,
    client_name,
    client_rut,
    document_number,
    document_type,
    issue_date,
    due_date,
    amount,
    outstanding_amount,
    status,
    notes
  )
  SELECT DISTINCT ON (normalized_document_number)
    normalized_document_number,
    normalized_client_rut,
    seller_email,
    seller_name,
    client_name,
    client_rut,
    document_number,
    document_type,
    issue_date,
    due_date,
    amount,
    outstanding_amount,
    status,
    notes
  FROM (
    SELECT
      element.ordinality AS ord,
      lower(trim(NULLIF(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>2
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>4
          ELSE element.value->>'document_number'
        END,
        ''
      ))) AS normalized_document_number,
      regexp_replace(lower(COALESCE(NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>1
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>3
          ELSE element.value->>'client_rut'
        END
      ), ''), '')), '[^0-9k]', '', 'g') AS normalized_client_rut,
      NULLIF(lower(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN NULL
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>0
          ELSE element.value->>'seller_email'
        END
      )), '') AS seller_email,
      NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN NULL
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>1
          ELSE element.value->>'seller_name'
        END
      ), '') AS seller_name,
      NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>0
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>2
          ELSE element.value->>'client_name'
        END
      ), '') AS client_name,
      NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>1
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>3
          ELSE element.value->>'client_rut'
        END
      ), '') AS client_rut,
      NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>2
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>4
          ELSE element.value->>'document_number'
        END
      ), '') AS document_number,
      COALESCE(NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>3
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>5
          ELSE element.value->>'document_type'
        END
      ), ''), 'invoice') AS document_type,
      NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN NULL
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>6
          ELSE element.value->>'issue_date'
        END
      ), '')::date AS issue_date,
      NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>4
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>7
          ELSE element.value->>'due_date'
        END
      ), '')::date AS due_date,
      GREATEST(COALESCE(NULLIF(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>5
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>8
          ELSE element.value->>'amount'
        END,
        ''
      )::numeric, 0), 0) AS amount,
      GREATEST(COALESCE(NULLIF(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN NULL
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>9
          ELSE element.value->>'outstanding_amount'
        END,
        ''
      )::numeric, NULLIF(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN element.value->>5
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>8
          ELSE element.value->>'amount'
        END,
        ''
      )::numeric, 0), 0) AS outstanding_amount,
      CASE
        WHEN lower(COALESCE(NULLIF(trim(
          CASE
            WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN 'pending'
            WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>10
            ELSE element.value->>'status'
          END
        ), ''), 'pending')) IN ('pending', 'partial', 'paid', 'overdue', 'disputed')
          THEN lower(COALESCE(NULLIF(trim(
            CASE
              WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN 'pending'
              WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>10
              ELSE element.value->>'status'
            END
          ), ''), 'pending'))
        ELSE 'pending'
      END AS status,
      NULLIF(trim(
        CASE
          WHEN jsonb_typeof(element.value) = 'array' AND jsonb_array_length(element.value) <= 6 THEN NULL
          WHEN jsonb_typeof(element.value) = 'array' THEN element.value->>11
          ELSE element.value->>'notes'
        END
      ), '') AS notes
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS element(value, ordinality)
  ) parsed
  WHERE normalized_document_number IS NOT NULL
    AND client_name IS NOT NULL
    AND due_date IS NOT NULL
    AND amount > 0
  ORDER BY normalized_document_number, ord;

  SELECT COUNT(*)::integer INTO v_incoming_count
  FROM tmp_collections_incoming;

  IF COALESCE(v_incoming_count, 0) = 0 THEN
    RAISE EXCEPTION 'No se encontraron datos válidos para sincronizar cobranzas';
  END IF;

  IF v_current_batch_id IS NOT NULL THEN
    UPDATE public.collections_pending cp
    SET status = 'paid',
        outstanding_amount = 0
    WHERE cp.batch_id = v_current_batch_id
      AND COALESCE(cp.status, 'pending') <> 'paid'
      AND NOT EXISTS (
        SELECT 1
        FROM tmp_collections_incoming incoming
        WHERE incoming.normalized_document_number = lower(trim(cp.document_number))
      );
  END IF;

  INSERT INTO public.collections_import_batches (
    file_name,
    uploaded_by,
    row_count,
    is_active
  )
  VALUES (
    COALESCE(NULLIF(trim(p_file_name), ''), 'collections_upload'),
    p_uploaded_by,
    v_incoming_count,
    false
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.collections_pending (
    batch_id,
    seller_id,
    seller_email,
    seller_name,
    client_name,
    client_rut,
    document_number,
    document_type,
    issue_date,
    due_date,
    amount,
    outstanding_amount,
    status,
    notes,
    seller_comment,
    seller_comment_updated_at,
    seller_comment_updated_by
  )
  SELECT
    v_batch_id,
    COALESCE(profile_from_file.id, profile_from_client.id, profile_from_pending.id, prev.seller_id) AS seller_id,
    COALESCE(
      incoming.seller_email,
      profile_from_file.email,
      profile_from_client.email,
      profile_from_pending.email,
      prev.seller_email
    ) AS seller_email,
    COALESCE(
      incoming.seller_name,
      NULLIF(trim(profile_from_file.full_name), ''),
      NULLIF(trim(profile_from_client.full_name), ''),
      NULLIF(trim(profile_from_pending.full_name), ''),
      prev.seller_name,
      split_part(
        COALESCE(
          incoming.seller_email,
          profile_from_file.email,
          profile_from_client.email,
          profile_from_pending.email,
          prev.seller_email,
          ''
        ),
        '@',
        1
      )
    ) AS seller_name,
    incoming.client_name,
    incoming.client_rut,
    incoming.document_number,
    incoming.document_type,
    incoming.issue_date,
    incoming.due_date,
    incoming.amount,
    incoming.outstanding_amount,
    CASE
      WHEN incoming.outstanding_amount <= 0 THEN 'paid'
      WHEN incoming.status = 'paid' THEN 'pending'
      ELSE incoming.status
    END AS status,
    incoming.notes,
    prev.seller_comment,
    prev.seller_comment_updated_at,
    prev.seller_comment_updated_by
  FROM tmp_collections_incoming incoming
  LEFT JOIN tmp_collections_previous prev
    ON prev.normalized_document_number = incoming.normalized_document_number
  LEFT JOIN public.profiles profile_from_file
    ON incoming.seller_email IS NOT NULL
   AND lower(profile_from_file.email) = incoming.seller_email
  LEFT JOIN LATERAL (
    SELECT c.created_by, c.pending_seller_email
    FROM public.clients c
    WHERE regexp_replace(lower(COALESCE(c.rut, '')), '[^0-9k]', '', 'g') = incoming.normalized_client_rut
    ORDER BY
      CASE
        WHEN c.created_by IS NOT NULL THEN 0
        WHEN c.pending_seller_email IS NOT NULL THEN 1
        ELSE 2
      END,
      c.updated_at DESC NULLS LAST,
      c.created_at DESC
    LIMIT 1
  ) client_match ON true
  LEFT JOIN public.profiles profile_from_client
    ON profile_from_client.id = client_match.created_by
  LEFT JOIN public.profiles profile_from_pending
    ON client_match.pending_seller_email IS NOT NULL
   AND lower(profile_from_pending.email) = lower(client_match.pending_seller_email);

  UPDATE public.collections_import_batches
  SET is_active = false
  WHERE is_active = true
    AND id <> v_batch_id;

  UPDATE public.collections_import_batches
  SET is_active = true
  WHERE id = v_batch_id;

  RETURN v_batch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_collection_seller(
  p_collection_id uuid,
  p_seller_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_collection public.collections_pending%ROWTYPE;
  v_seller public.profiles%ROWTYPE;
  v_normalized_rut text;
  v_updated_documents integer := 0;
  v_updated_clients integer := 0;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT p.role INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  IF COALESCE(v_actor_role, '') NOT IN ('admin', 'jefe') THEN
    RAISE EXCEPTION 'Sin permisos para asignar vendedor en cobranzas';
  END IF;

  SELECT * INTO v_collection
  FROM public.collections_pending
  WHERE id = p_collection_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento de cobranza no encontrado';
  END IF;

  SELECT * INTO v_seller
  FROM public.profiles
  WHERE id = p_seller_id
    AND lower(COALESCE(role, '')) IN ('seller', 'jefe', 'manager', 'admin')
    AND COALESCE(status, 'active') = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendedor inválido o inactivo';
  END IF;

  v_normalized_rut := regexp_replace(lower(COALESCE(v_collection.client_rut, '')), '[^0-9k]', '', 'g');

  IF v_normalized_rut <> '' THEN
    UPDATE public.collections_pending cp
    SET seller_id = v_seller.id,
        seller_email = lower(v_seller.email),
        seller_name = COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1))
    WHERE regexp_replace(lower(COALESCE(cp.client_rut, '')), '[^0-9k]', '', 'g') = v_normalized_rut;

    GET DIAGNOSTICS v_updated_documents = ROW_COUNT;

    UPDATE public.clients c
    SET created_by = v_seller.id,
        pending_seller_email = NULL,
        updated_at = now()
    WHERE regexp_replace(lower(COALESCE(c.rut, '')), '[^0-9k]', '', 'g') = v_normalized_rut;

    GET DIAGNOSTICS v_updated_clients = ROW_COUNT;
  ELSE
    UPDATE public.collections_pending cp
    SET seller_id = v_seller.id,
        seller_email = lower(v_seller.email),
        seller_name = COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1))
    WHERE cp.id = p_collection_id;

    GET DIAGNOSTICS v_updated_documents = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'seller_id', v_seller.id,
    'seller_email', lower(v_seller.email),
    'seller_name', COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1)),
    'updated_documents', v_updated_documents,
    'updated_clients', v_updated_clients
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assign_collection_seller(uuid, uuid) TO authenticated;
