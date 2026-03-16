ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_proof_path TEXT;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_proof_name TEXT;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_proof_mime_type TEXT;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TIMESTAMPTZ;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_email_status TEXT NOT NULL DEFAULT 'not_required';

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_email_error TEXT;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS payment_email_sent_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'orders_payment_email_status_ck'
          AND conrelid = 'public.orders'::regclass
    ) THEN
        ALTER TABLE public.orders
        ADD CONSTRAINT orders_payment_email_status_ck
        CHECK (payment_email_status IN ('not_required', 'pending', 'sent', 'failed'));
    END IF;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

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
              AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
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
              AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
        )
    )
);

DROP POLICY IF EXISTS "Payment proofs delete owner or leadership" ON storage.objects;
CREATE POLICY "Payment proofs delete owner or leadership"
ON storage.objects
FOR DELETE
USING (
    bucket_id = 'payment-proofs'
    AND (
        (storage.foldername(name))[1] = auth.uid()::text
        OR EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
        )
    )
);
