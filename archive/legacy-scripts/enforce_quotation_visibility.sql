-- SCRIPT PARA RESTRINGIR VISIBILIDAD DE COTIZACIONES POR VENDEDOR

-- 1. Asegurar que RLS esté activado
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar políticas de lectura existentes para evitar duplicados
DROP POLICY IF EXISTS "Lectura de Cotizaciones" ON public.quotations;
DROP POLICY IF EXISTS "Users can view own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Admins see all quotations" ON public.quotations;

-- 3. Crear política: Vendedores solo ven lo suyo, Admins ven todo
CREATE POLICY "Visibilidad Restringida de Cotizaciones"
ON public.quotations FOR SELECT
TO authenticated
USING (
  -- El creador puede ver su cotización
  seller_id = auth.uid() 
  OR 
  -- Los roles privilegiados pueden ver todas
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
);

-- 4. Notificar recarga de caché a la API
NOTIFY pgrst, 'reload schema';
