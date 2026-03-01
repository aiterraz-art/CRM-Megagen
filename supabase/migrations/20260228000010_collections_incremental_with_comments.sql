-- Cobranzas: importación incremental por numero_documento + descargos de vendedor.

ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS seller_comment text;

ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS seller_comment_updated_at timestamptz;

ALTER TABLE IF EXISTS public.collections_pending
ADD COLUMN IF NOT EXISTS seller_comment_updated_by uuid;

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
  cp.seller_comment_updated_by
FROM public.collections_pending cp
JOIN public.collections_import_batches b ON b.id = cp.batch_id
WHERE b.is_active = true;

CREATE OR REPLACE VIEW public.vw_collections_seller_summary_current AS
SELECT
  COALESCE(v.seller_id::text, v.seller_email, 'sin_vendedor') AS seller_key,
  v.seller_id,
  v.seller_email,
  v.seller_name,
  COUNT(*) AS documents,
  SUM(v.outstanding_amount) AS outstanding_total,
  COUNT(*) FILTER (
    WHERE v.due_date < CURRENT_DATE AND v.status IN ('pending', 'partial')
  ) AS overdue_documents,
  SUM(
    CASE
      WHEN v.due_date < CURRENT_DATE AND v.status IN ('pending', 'partial')
        THEN v.outstanding_amount
      ELSE 0
    END
  ) AS overdue_total
FROM public.vw_collections_pending_current v
GROUP BY
  COALESCE(v.seller_id::text, v.seller_email, 'sin_vendedor'),
  v.seller_id, v.seller_email, v.seller_name
ORDER BY overdue_total DESC, outstanding_total DESC;

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
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows debe ser un arreglo JSON';
  END IF;

  SELECT id INTO v_current_batch_id
  FROM public.collections_import_batches
  WHERE is_active = true
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.collections_import_batches (
    file_name,
    uploaded_by,
    is_active
  )
  VALUES (
    COALESCE(NULLIF(trim(p_file_name), ''), 'collections_upload'),
    p_uploaded_by,
    false
  )
  RETURNING id INTO v_batch_id;

  -- 1) Copiar dataset activo al nuevo batch para preservar datos y descargos.
  IF v_current_batch_id IS NOT NULL THEN
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
      cp.seller_comment,
      cp.seller_comment_updated_at,
      cp.seller_comment_updated_by
    FROM public.collections_pending cp
    WHERE cp.batch_id = v_current_batch_id;
  END IF;

  -- 2) Insertar solo documentos NUEVOS (por numero_documento), sin duplicar.
  WITH parsed AS (
    SELECT
      NULLIF(trim(r.seller_email), '') AS seller_email,
      NULLIF(trim(r.seller_name), '') AS seller_name,
      NULLIF(trim(r.client_name), '') AS client_name,
      NULLIF(trim(r.client_rut), '') AS client_rut,
      NULLIF(trim(r.document_number), '') AS document_number,
      (NULLIF(trim(r.due_date), ''))::date AS due_date,
      COALESCE(r.amount, 0)::numeric AS amount
    FROM jsonb_to_recordset(p_rows) AS r(
      seller_email text,
      seller_name text,
      client_name text,
      client_rut text,
      document_number text,
      due_date text,
      amount numeric
    )
    WHERE NULLIF(trim(r.client_name), '') IS NOT NULL
      AND NULLIF(trim(r.document_number), '') IS NOT NULL
      AND NULLIF(trim(r.due_date), '') IS NOT NULL
  ),
  dedup AS (
    SELECT DISTINCT ON (lower(document_number))
      seller_email,
      seller_name,
      client_name,
      client_rut,
      document_number,
      due_date,
      amount
    FROM parsed
    ORDER BY lower(document_number)
  ),
  only_new AS (
    SELECT d.*
    FROM dedup d
    LEFT JOIN public.collections_pending cp
      ON cp.batch_id = v_batch_id
      AND lower(cp.document_number) = lower(d.document_number)
    WHERE cp.id IS NULL
  )
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
    notes
  )
  SELECT
    v_batch_id,
    p.id,
    n.seller_email,
    n.seller_name,
    n.client_name,
    n.client_rut,
    n.document_number,
    'invoice',
    NULL,
    n.due_date,
    n.amount,
    n.amount,
    'pending',
    NULL
  FROM only_new n
  LEFT JOIN public.profiles p
    ON lower(p.email) = lower(n.seller_email);

  UPDATE public.collections_import_batches
  SET row_count = (
    SELECT COUNT(*)::integer
    FROM public.collections_pending
    WHERE batch_id = v_batch_id
  )
  WHERE id = v_batch_id;

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
