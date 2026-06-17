CREATE TABLE IF NOT EXISTS public.collection_payment_proofs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id uuid NOT NULL REFERENCES public.collections_pending(id) ON DELETE CASCADE,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    uploaded_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collection_payment_proofs_collection_id_uploaded_at
    ON public.collection_payment_proofs (collection_id, uploaded_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_payment_proofs TO authenticated;

INSERT INTO public.collection_payment_proofs (
    collection_id,
    storage_path,
    file_name,
    mime_type,
    uploaded_at,
    uploaded_by
)
SELECT
    cp.id,
    cp.payment_proof_path,
    COALESCE(cp.payment_proof_name, 'comprobante_pago'),
    cp.payment_proof_mime_type,
    COALESCE(cp.payment_proof_uploaded_at, now()),
    cp.payment_proof_uploaded_by
FROM public.collections_pending cp
WHERE cp.payment_proof_path IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.collection_payment_proofs cpp
      WHERE cpp.collection_id = cp.id
        AND cpp.storage_path = cp.payment_proof_path
  );
