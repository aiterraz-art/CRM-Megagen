-- Fase 2: predefined lead messages + attachments + logs + manual scrubbing RPC

CREATE TABLE IF NOT EXISTS public.lead_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp','both')),
  subject text,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.lead_message_templates(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.lead_message_templates(id),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('email','whatsapp')),
  destination text,
  status text NOT NULL CHECK (status IN ('sent','failed','opened_external')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_message_templates_active ON public.lead_message_templates (is_active, channel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_message_attachments_template_id ON public.lead_message_attachments (template_id);
CREATE INDEX IF NOT EXISTS idx_lead_message_logs_client_id ON public.lead_message_logs (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_message_logs_user_id ON public.lead_message_logs (user_id, created_at DESC);

ALTER TABLE public.lead_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_message_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lead templates read" ON public.lead_message_templates;
CREATE POLICY "Lead templates read"
ON public.lead_message_templates
FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Lead templates manage admin jefe" ON public.lead_message_templates;
CREATE POLICY "Lead templates manage admin jefe"
ON public.lead_message_templates
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role,'')) IN ('admin','jefe')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role,'')) IN ('admin','jefe')
  )
);

DROP POLICY IF EXISTS "Lead attachments read" ON public.lead_message_attachments;
CREATE POLICY "Lead attachments read"
ON public.lead_message_attachments
FOR SELECT
USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Lead attachments manage admin jefe" ON public.lead_message_attachments;
CREATE POLICY "Lead attachments manage admin jefe"
ON public.lead_message_attachments
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role,'')) IN ('admin','jefe')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role,'')) IN ('admin','jefe')
  )
);

DROP POLICY IF EXISTS "Lead logs read own or manager" ON public.lead_message_logs;
CREATE POLICY "Lead logs read own or manager"
ON public.lead_message_logs
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role,'')) IN ('admin','jefe','administrativo','supervisor','manager')
  )
);

DROP POLICY IF EXISTS "Lead logs insert authenticated" ON public.lead_message_logs;
CREATE POLICY "Lead logs insert authenticated"
ON public.lead_message_logs
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-assets', 'lead-assets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Lead assets read" ON storage.objects;
CREATE POLICY "Lead assets read"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'lead-assets'
  AND auth.role() = 'authenticated'
);

DROP POLICY IF EXISTS "Lead assets upload admin jefe" ON storage.objects;
CREATE POLICY "Lead assets upload admin jefe"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'lead-assets'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role,'')) IN ('admin','jefe')
  )
);

DROP POLICY IF EXISTS "Lead assets delete admin jefe" ON storage.objects;
CREATE POLICY "Lead assets delete admin jefe"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'lead-assets'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role,'')) IN ('admin','jefe')
  )
);

CREATE OR REPLACE FUNCTION public.archive_abandoned_prospects()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text;
  archived_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE='28000';
  END IF;

  SELECT lower(coalesce(role,'')) INTO actor_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF actor_role NOT IN ('admin','jefe') THEN
    RAISE EXCEPTION 'Solo admin o jefe pueden ejecutar limpieza de leads.' USING ERRCODE='42501';
  END IF;

  UPDATE public.clients
  SET status = 'archived'
  WHERE (status LIKE 'prospect_%' OR status = 'prospect')
    AND coalesce(nullif(trim(phone),''), '') = ''
    AND coalesce(nullif(trim(email),''), '') = ''
    AND coalesce(last_visit_date, created_at) < now() - interval '60 days';

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_abandoned_prospects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_abandoned_prospects() TO authenticated;
