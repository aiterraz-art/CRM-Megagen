-- Ensure admin can read/update clients created by other sellers.
-- This keeps backward compatibility with legacy "manager" role and
-- avoids null client relation in VisitHistory joins.

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers view own clients" ON public.clients;
CREATE POLICY "Sellers view own clients"
ON public.clients
FOR SELECT
TO public
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo', 'supervisor')
  )
);

DROP POLICY IF EXISTS "Sellers update own clients" ON public.clients;
CREATE POLICY "Sellers update own clients"
ON public.clients
FOR UPDATE
TO public
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo', 'supervisor')
  )
);
