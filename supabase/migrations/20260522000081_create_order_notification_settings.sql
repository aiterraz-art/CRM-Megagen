CREATE TABLE IF NOT EXISTS public.order_notification_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    recipient_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    include_backoffice_recipients BOOLEAN NOT NULL DEFAULT true,
    include_seller_cc BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT order_notification_settings_singleton_ck CHECK (id = 'default')
);

ALTER TABLE public.order_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read order notification settings" ON public.order_notification_settings;
CREATE POLICY "Admins read order notification settings"
ON public.order_notification_settings
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) = 'admin'
    )
);

DROP POLICY IF EXISTS "Admins manage order notification settings" ON public.order_notification_settings;
CREATE POLICY "Admins manage order notification settings"
ON public.order_notification_settings
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) = 'admin'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) = 'admin'
    )
);

INSERT INTO public.order_notification_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
