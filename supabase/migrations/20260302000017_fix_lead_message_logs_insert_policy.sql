-- Harden lead_message_logs insert policy to prevent user_id spoofing

DROP POLICY IF EXISTS "Lead logs insert authenticated" ON public.lead_message_logs;

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
