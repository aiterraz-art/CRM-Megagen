-- Ensure admin/jefe can see team visits in Visit History.
-- This normalizes legacy policies that were left with "own visits only" behavior.

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

-- Drop legacy/duplicate policy names if they exist.
DROP POLICY IF EXISTS "Users view own visits" ON public.visits;
DROP POLICY IF EXISTS "Users can view their own visits" ON public.visits;
DROP POLICY IF EXISTS "Users create visits" ON public.visits;
DROP POLICY IF EXISTS "Users can create visits" ON public.visits;
DROP POLICY IF EXISTS "Users update visits" ON public.visits;
DROP POLICY IF EXISTS "Users can update visits" ON public.visits;
DROP POLICY IF EXISTS "Users delete visits" ON public.visits;
DROP POLICY IF EXISTS "Users can delete visits" ON public.visits;
DROP POLICY IF EXISTS "Users can delete their own visits" ON public.visits;
DROP POLICY IF EXISTS "Managers can delete any visit" ON public.visits;
DROP POLICY IF EXISTS "Visits select own or manager" ON public.visits;
DROP POLICY IF EXISTS "Visits insert own or manager" ON public.visits;
DROP POLICY IF EXISTS "Visits update own or manager" ON public.visits;
DROP POLICY IF EXISTS "Visits delete own or manager" ON public.visits;

CREATE POLICY "Visits select own or manager"
ON public.visits
FOR SELECT
TO authenticated
USING (
  sales_rep_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'administrativo', 'manager', 'supervisor')
  )
);

CREATE POLICY "Visits insert own or manager"
ON public.visits
FOR INSERT
TO authenticated
WITH CHECK (
  sales_rep_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'administrativo', 'manager', 'supervisor')
  )
);

CREATE POLICY "Visits update own or manager"
ON public.visits
FOR UPDATE
TO authenticated
USING (
  sales_rep_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'administrativo', 'manager', 'supervisor')
  )
)
WITH CHECK (
  sales_rep_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'administrativo', 'manager', 'supervisor')
  )
);

CREATE POLICY "Visits delete own or manager"
ON public.visits
FOR DELETE
TO authenticated
USING (
  sales_rep_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'administrativo', 'manager', 'supervisor')
  )
);
