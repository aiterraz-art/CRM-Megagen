-- Restrict lead messaging module access to sales roles and harden policy idempotency

-- Templates read: only admin/jefe/seller
DROP POLICY IF EXISTS "Lead templates read" ON public.lead_message_templates;
CREATE POLICY "Lead templates read"
ON public.lead_message_templates
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller', 'manager')
  )
);

-- Attachments read: only admin/jefe/seller
DROP POLICY IF EXISTS "Lead attachments read" ON public.lead_message_attachments;
CREATE POLICY "Lead attachments read"
ON public.lead_message_attachments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller', 'manager')
  )
);

-- Storage read for lead-assets aligned to sales roles
DROP POLICY IF EXISTS "Lead assets read" ON storage.objects;
CREATE POLICY "Lead assets read"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'lead-assets'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller', 'manager')
  )
);

-- Re-create insert policy idempotently to avoid drift between instances
DROP POLICY IF EXISTS "Lead logs insert authenticated" ON public.lead_message_logs;
DROP POLICY IF EXISTS "Lead logs insert own user" ON public.lead_message_logs;
CREATE POLICY "Lead logs insert own user"
ON public.lead_message_logs
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND (
    user_id IS NULL
    OR user_id = auth.uid()
  )
);
