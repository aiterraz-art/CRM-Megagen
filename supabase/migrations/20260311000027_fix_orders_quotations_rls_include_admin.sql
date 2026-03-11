-- Fix RLS role checks so new normalized role "admin" has global access,
-- keeping backward compatibility with legacy "manager".

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Create orders" ON public.orders;
CREATE POLICY "Create orders"
ON public.orders
FOR INSERT
TO public
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  )
);

DROP POLICY IF EXISTS "View orders" ON public.orders;
CREATE POLICY "View orders"
ON public.orders
FOR SELECT
TO public
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  )
);

DROP POLICY IF EXISTS "Update orders" ON public.orders;
CREATE POLICY "Update orders"
ON public.orders
FOR UPDATE
TO public
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  )
);

DROP POLICY IF EXISTS "Delete orders" ON public.orders;
CREATE POLICY "Delete orders"
ON public.orders
FOR DELETE
TO public
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  )
);

DROP POLICY IF EXISTS "Sellers manage own quotations" ON public.quotations;
CREATE POLICY "Sellers manage own quotations"
ON public.quotations
FOR ALL
TO public
USING (
  seller_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  )
)
WITH CHECK (
  seller_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  )
);
