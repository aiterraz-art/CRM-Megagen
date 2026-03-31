CREATE TABLE IF NOT EXISTS public.quotation_order_conversion_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL,
    quotation_id UUID NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
    order_id UUID NULL REFERENCES public.orders(id) ON DELETE SET NULL,
    actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('started', 'payment_proof_upload', 'order_creation', 'notification', 'cleanup', 'completed')),
    status TEXT NOT NULL CHECK (status IN ('info', 'success', 'failed')),
    message TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_quotation_order_conversion_logs_attempt_id
    ON public.quotation_order_conversion_logs (attempt_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotation_order_conversion_logs_quotation_id
    ON public.quotation_order_conversion_logs (quotation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotation_order_conversion_logs_order_id
    ON public.quotation_order_conversion_logs (order_id, created_at DESC);

ALTER TABLE public.quotation_order_conversion_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotation_order_conversion_logs_select" ON public.quotation_order_conversion_logs;
CREATE POLICY "quotation_order_conversion_logs_select"
ON public.quotation_order_conversion_logs
FOR SELECT
USING (
    actor_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM public.quotations q
        WHERE q.id = quotation_id
          AND q.seller_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'facturador', 'tesorero')
    )
);

DROP POLICY IF EXISTS "quotation_order_conversion_logs_insert" ON public.quotation_order_conversion_logs;
CREATE POLICY "quotation_order_conversion_logs_insert"
ON public.quotation_order_conversion_logs
FOR INSERT
WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.quotations q
        WHERE q.id = quotation_id
          AND (
              q.seller_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'facturador', 'tesorero')
              )
          )
    )
);

GRANT SELECT, INSERT ON public.quotation_order_conversion_logs TO authenticated;

NOTIFY pgrst, 'reload schema';
