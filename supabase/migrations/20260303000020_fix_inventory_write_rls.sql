-- Fix inventory write permissions for admin/jefe/administrativo/manager.
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff edit products" ON public.inventory;
DROP POLICY IF EXISTS "Inventory insert staff" ON public.inventory;
DROP POLICY IF EXISTS "Inventory update staff" ON public.inventory;
DROP POLICY IF EXISTS "Inventory delete staff" ON public.inventory;

CREATE POLICY "Inventory insert staff"
ON public.inventory
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) = ANY (
        ARRAY['admin', 'manager', 'jefe', 'administrativo']
      )
  )
);

CREATE POLICY "Inventory update staff"
ON public.inventory
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) = ANY (
        ARRAY['admin', 'manager', 'jefe', 'administrativo']
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) = ANY (
        ARRAY['admin', 'manager', 'jefe', 'administrativo']
      )
  )
);

CREATE POLICY "Inventory delete staff"
ON public.inventory
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) = ANY (
        ARRAY['admin', 'manager', 'jefe', 'administrativo']
      )
  )
);
