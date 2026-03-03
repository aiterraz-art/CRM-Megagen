-- Allow leadership roles to import clients assigned to other sellers.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers insert clients" ON public.clients;

CREATE POLICY "Sellers insert clients"
ON public.clients
FOR INSERT
WITH CHECK (
  auth.uid() = created_by
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) = ANY (
        ARRAY['admin', 'manager', 'jefe', 'administrativo', 'supervisor']
      )
  )
);
