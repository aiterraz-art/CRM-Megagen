-- Harden pool read policy to authenticated profiles only.

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Pool read abandoned prospects" ON public.clients;
CREATE POLICY "Pool read abandoned prospects"
ON public.clients
FOR SELECT
USING (
  auth.role() = 'authenticated'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(COALESCE(p.role, '')) = ANY (ARRAY['admin','jefe','seller','administrativo','supervisor','manager'])
  )
  AND (
    status = 'prospect'
    OR status LIKE 'prospect\_%' ESCAPE '\\'
  )
  AND (
    (last_visit_date IS NOT NULL AND last_visit_date < (NOW() - INTERVAL '30 days'))
    OR (last_visit_date IS NULL AND created_at < (NOW() - INTERVAL '30 days'))
  )
);
