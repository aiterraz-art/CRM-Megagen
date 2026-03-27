ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS payment_proof_path text;

ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS payment_proof_name text;

ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS payment_proof_mime_type text;

ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at timestamptz;

ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS payment_proof_uploaded_by uuid;

CREATE OR REPLACE VIEW public.vw_collections_pending_current AS
SELECT
  cp.id,
  cp.batch_id,
  cp.seller_id,
  cp.seller_email,
  cp.seller_name,
  cp.client_name,
  cp.client_rut,
  cp.document_number,
  cp.document_type,
  cp.issue_date,
  cp.due_date,
  cp.amount,
  cp.outstanding_amount,
  cp.status,
  cp.notes,
  cp.created_at,
  CASE
    WHEN cp.due_date < CURRENT_DATE AND cp.status IN ('pending', 'partial')
      THEN CURRENT_DATE - cp.due_date
    ELSE 0
  END AS aging_days,
  cp.seller_comment,
  cp.seller_comment_updated_at,
  cp.seller_comment_updated_by,
  cp.payment_proof_path,
  cp.payment_proof_name,
  cp.payment_proof_mime_type,
  cp.payment_proof_uploaded_at,
  cp.payment_proof_uploaded_by
FROM public.collections_pending cp
JOIN public.collections_import_batches b ON b.id = cp.batch_id
WHERE b.is_active = true;

DROP VIEW IF EXISTS public.vw_collections_paid_history;

CREATE VIEW public.vw_collections_paid_history AS
SELECT DISTINCT ON (lower(trim(cp.document_number)))
  cp.id,
  cp.batch_id,
  cp.seller_id,
  cp.seller_email,
  cp.seller_name,
  cp.client_name,
  cp.client_rut,
  cp.document_number,
  cp.document_type,
  cp.issue_date,
  cp.due_date,
  cp.amount,
  cp.outstanding_amount,
  cp.status,
  cp.notes,
  cp.created_at,
  cp.seller_comment,
  cp.seller_comment_updated_at,
  cp.seller_comment_updated_by,
  cp.payment_proof_path,
  cp.payment_proof_name,
  cp.payment_proof_mime_type,
  cp.payment_proof_uploaded_at,
  cp.payment_proof_uploaded_by,
  b.created_at AS paid_detected_at,
  b.file_name AS paid_detected_in_file,
  CASE
    WHEN cp.due_date IS NOT NULL AND cp.due_date < b.created_at::date
      THEN b.created_at::date - cp.due_date
    ELSE 0
  END AS aging_days_when_paid
FROM public.collections_pending cp
JOIN public.collections_import_batches b ON b.id = cp.batch_id
WHERE cp.status = 'paid'
  AND NULLIF(trim(cp.document_number), '') IS NOT NULL
ORDER BY lower(trim(cp.document_number)), b.created_at DESC, cp.created_at DESC, cp.id DESC;

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
    seller_comment_updated_by uuid,
    payment_proof_path text,
    payment_proof_name text,
    payment_proof_mime_type text,
    payment_proof_uploaded_at timestamptz,
    payment_proof_uploaded_by uuid
  ) ON COMMIT DROP;

  IF v_current_batch_id IS NOT NULL THEN
    INSERT INTO tmp_collections_previous (
      normalized_document_number,
      seller_id,
      seller_email,
      seller_name,
      seller_comment,
      seller_comment_updated_at,
      seller_comment_updated_by,
      payment_proof_path,
      payment_proof_name,
      payment_proof_mime_type,
      payment_proof_uploaded_at,
      payment_proof_uploaded_by
    )
    SELECT DISTINCT ON (lower(trim(cp.document_number)))
      lower(trim(cp.document_number)) AS normalized_document_number,
      cp.seller_id,
      cp.seller_email,
      cp.seller_name,
      cp.seller_comment,
      cp.seller_comment_updated_at,
      cp.seller_comment_updated_by,
      cp.payment_proof_path,
      cp.payment_proof_name,
      cp.payment_proof_mime_type,
      cp.payment_proof_uploaded_at,
      cp.payment_proof_uploaded_by
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
    seller_comment_updated_by,
    payment_proof_path,
    payment_proof_name,
    payment_proof_mime_type,
    payment_proof_uploaded_at,
    payment_proof_uploaded_by
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
    prev.seller_comment_updated_by,
    prev.payment_proof_path,
    prev.payment_proof_name,
    prev.payment_proof_mime_type,
    prev.payment_proof_uploaded_at,
    prev.payment_proof_uploaded_by
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

DROP POLICY IF EXISTS "Payment proofs read owner or leadership" ON storage.objects;
CREATE POLICY "Payment proofs read owner or leadership"
ON storage.objects
FOR SELECT
USING (
    bucket_id = 'payment-proofs'
    AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'facturador', 'tesorero')
        )
    )
);

DROP POLICY IF EXISTS "Payment proofs upload owner or leadership" ON storage.objects;
CREATE POLICY "Payment proofs upload owner or leadership"
ON storage.objects
FOR INSERT
WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'facturador', 'tesorero')
        )
    )
);

DROP POLICY IF EXISTS "Payment proofs delete owner or leadership" ON storage.objects;

DROP POLICY IF EXISTS "Visit photos delete owner or leadership" ON public.visit_photos;
REVOKE DELETE ON public.visit_photos FROM authenticated;

NOTIFY pgrst, 'reload schema';
