ALTER TABLE public.order_notification_settings
ADD COLUMN IF NOT EXISTS excluded_backoffice_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
