CREATE TABLE IF NOT EXISTS public.order_notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    triggered_by UUID NOT NULL REFERENCES public.profiles(id),
    sender_profile_id UUID NULL REFERENCES public.profiles(id),
    sender_email TEXT NOT NULL,
    to_recipients TEXT[] NOT NULL,
    cc_recipients TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    subject TEXT NOT NULL,
    body_preview TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    gmail_message_id TEXT NULL,
    gmail_thread_id TEXT NULL,
    error_message TEXT NULL,
    request_source TEXT NOT NULL CHECK (request_source IN ('quotation_conversion', 'manual_resend')),
    attachments JSONB NOT NULL DEFAULT '[]'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    sent_at TIMESTAMPTZ NULL
);

ALTER TABLE public.order_notification_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_order_notification_logs_order_id_created_at
    ON public.order_notification_logs(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_notification_logs_status
    ON public.order_notification_logs(status);

CREATE INDEX IF NOT EXISTS idx_order_notification_logs_created_at
    ON public.order_notification_logs(created_at DESC);

DROP POLICY IF EXISTS "Order notification logs read owner or backoffice" ON public.order_notification_logs;
CREATE POLICY "Order notification logs read owner or backoffice"
ON public.order_notification_logs
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.id = order_notification_logs.order_id
          AND (
              o.user_id = auth.uid()
              OR EXISTS (
                  SELECT 1
                  FROM public.profiles p
                  WHERE p.id = auth.uid()
                    AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
              )
          )
    )
);

REVOKE ALL ON public.order_notification_logs FROM anon, authenticated;
GRANT SELECT ON public.order_notification_logs TO authenticated;
