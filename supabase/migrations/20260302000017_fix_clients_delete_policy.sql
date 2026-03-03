-- Enable client deletion for rightful owners and leadership roles.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers delete own clients" ON public.clients;
DROP POLICY IF EXISTS "Clients delete own or manager" ON public.clients;

CREATE POLICY "Sellers delete own clients"
ON public.clients
FOR DELETE
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) = ANY (
        ARRAY['admin', 'manager', 'jefe', 'administrativo', 'supervisor']
      )
  )
);
