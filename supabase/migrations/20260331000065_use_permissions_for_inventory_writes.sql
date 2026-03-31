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
    JOIN public.role_permissions rp
      ON rp.role = lower(coalesce(p.role, ''))
     AND rp.permission = 'MANAGE_INVENTORY'
    WHERE p.id = auth.uid()
  )
);

CREATE POLICY "Inventory update staff"
ON public.inventory
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp
      ON rp.role = lower(coalesce(p.role, ''))
     AND rp.permission = 'MANAGE_INVENTORY'
    WHERE p.id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp
      ON rp.role = lower(coalesce(p.role, ''))
     AND rp.permission = 'MANAGE_INVENTORY'
    WHERE p.id = auth.uid()
  )
);

CREATE POLICY "Inventory delete staff"
ON public.inventory
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp
      ON rp.role = lower(coalesce(p.role, ''))
     AND rp.permission = 'MANAGE_INVENTORY'
    WHERE p.id = auth.uid()
  )
);

NOTIFY pgrst, 'reload schema';
