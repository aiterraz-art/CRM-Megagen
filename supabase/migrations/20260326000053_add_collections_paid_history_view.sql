CREATE OR REPLACE VIEW public.vw_collections_paid_history AS
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
