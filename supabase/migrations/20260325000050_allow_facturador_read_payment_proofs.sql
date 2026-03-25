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
              AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'facturador')
        )
    )
);
