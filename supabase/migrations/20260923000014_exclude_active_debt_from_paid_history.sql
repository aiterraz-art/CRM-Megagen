-- El historial de cobros no debe incluir documentos que hoy siguen adeudados.
--
-- Contexto: la carga de cobranzas reemplaza el lote completo y marca como pagado todo
-- documento que no venga en el archivo nuevo. Cuando se sube un archivo equivocado o
-- incompleto, esa marca se aplica en masa. La cartera se recupera al volver a importar
-- el archivo correcto, pero la fila antigua con estado 'paid' permanece, y esta vista
-- la seguia contando como cobrada para siempre.
--
-- Medido antes de aplicar esta correccion:
--   3Dental: 388 documentos por 170.696.699 figuraban cobrados y adeudados a la vez,
--            sobre un historial que reportaba 742.726.822 cobrados.
--   Megagen: 1 documento por 1.000.000.
--
-- La correccion no borra nada: si un documento vuelve a aparecer como deuda vigente,
-- deja de contarse como cobrado. Si mas adelante se paga de verdad y desaparece del
-- archivo, vuelve a aparecer aqui por si solo.
--
-- Efecto visible: el monto historico de cobranzas baja, porque deja de incluir lo que
-- nunca se cobro.

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
  -- Un documento que figura como deuda vigente en el lote activo no esta cobrado,
  -- por mucho que una carga anterior lo haya marcado asi.
  AND NOT EXISTS (
    SELECT 1
    FROM public.collections_pending vigente
    JOIN public.collections_import_batches lote_activo
      ON lote_activo.id = vigente.batch_id
     AND lote_activo.is_active = true
    WHERE lower(trim(vigente.document_number)) = lower(trim(cp.document_number))
      AND COALESCE(vigente.status, 'pending') <> 'paid'
  )
ORDER BY lower(trim(cp.document_number)), b.created_at DESC, cp.created_at DESC, cp.id DESC;
