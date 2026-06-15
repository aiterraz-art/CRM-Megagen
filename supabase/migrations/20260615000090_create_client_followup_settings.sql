CREATE TABLE IF NOT EXISTS public.client_followup_settings (
    id text PRIMARY KEY DEFAULT 'default',
    active_warning_days integer NOT NULL DEFAULT 15,
    active_critical_days integer NOT NULL DEFAULT 30,
    prospect_warning_days integer NOT NULL DEFAULT 15,
    prospect_critical_days integer NOT NULL DEFAULT 30,
    pool_reassignment_days integer NOT NULL DEFAULT 30,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT client_followup_settings_singleton_ck CHECK (id = 'default'),
    CONSTRAINT client_followup_settings_ranges_ck CHECK (
        active_warning_days >= 0
        AND active_critical_days >= active_warning_days
        AND prospect_warning_days >= 0
        AND prospect_critical_days >= prospect_warning_days
        AND pool_reassignment_days >= 0
    )
);

ALTER TABLE public.client_followup_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read client followup settings" ON public.client_followup_settings;
CREATE POLICY "Admins read client followup settings"
ON public.client_followup_settings
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) = 'admin'
    )
);

DROP POLICY IF EXISTS "Admins manage client followup settings" ON public.client_followup_settings;
CREATE POLICY "Admins manage client followup settings"
ON public.client_followup_settings
FOR ALL
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

INSERT INTO public.client_followup_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
