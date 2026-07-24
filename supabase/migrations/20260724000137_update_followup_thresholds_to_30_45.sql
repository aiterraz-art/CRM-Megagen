ALTER TABLE public.client_followup_settings
    ALTER COLUMN active_warning_days SET DEFAULT 30,
    ALTER COLUMN active_critical_days SET DEFAULT 45,
    ALTER COLUMN prospect_warning_days SET DEFAULT 30,
    ALTER COLUMN prospect_critical_days SET DEFAULT 45;

UPDATE public.client_followup_settings
SET
    active_warning_days = 30,
    active_critical_days = 45,
    prospect_warning_days = 30,
    prospect_critical_days = 45,
    updated_at = now()
WHERE id = 'default';
