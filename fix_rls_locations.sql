-- SCRIPT PARA ARREGLAR VISIBILIDAD DE RUTAS (seller_locations)
-- Ejecuta esto en Supabase para que el Admin pueda ver el historial.

-- 1. Asegurar que RLS esté activo
ALTER TABLE public.seller_locations ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar políticas antiguas (para evitar conflictos)
DROP POLICY IF EXISTS "Users can view own locations" ON public.seller_locations;
DROP POLICY IF EXISTS "Admins see all locations" ON public.seller_locations;
DROP POLICY IF EXISTS "Users can insert own locations" ON public.seller_locations;

-- 3. Política: Vendedores ven SOLO lo suyo
CREATE POLICY "Users can view own locations"
ON public.seller_locations
FOR SELECT
USING (
  seller_id = auth.uid()
);

-- 4. Política: Admins/Jefes ven TODO
CREATE POLICY "Admins see all locations"
ON public.seller_locations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
);

-- 5. Política: Permitir inserción (especialmente para Daniela/Natalia)
CREATE POLICY "Users can insert own locations"
ON public.seller_locations
FOR INSERT
WITH CHECK (true);

-- 6. Recargar PostgREST
NOTIFY pgrst, 'reload schema';
