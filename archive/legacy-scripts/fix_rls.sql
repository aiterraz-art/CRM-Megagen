-- SCRIPT PARA ARREGLAR VISIBILIDAD DE COTIZACIONES (RLS)
-- Ejecuta esto en Supabase para que el Admin pueda ver todo.

-- 1. Asegurar que RLS esté activo
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar políticas antiguas (para evitar conflictos o duplicados)
DROP POLICY IF EXISTS "Users can view own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Admins see all quotations" ON public.quotations;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.quotations;

-- 3. Política: Vendedores ven SOLO lo suyo
CREATE POLICY "Users can view own quotations"
ON public.quotations
FOR SELECT
USING (
  seller_id = auth.uid()
);

-- 4. Política: Admins/Jefes ven TODO (incluido lo de Daniela/Natalia)
CREATE POLICY "Admins see all quotations"
ON public.quotations
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
);

-- 5. Dar permisos de inserción/edición (por si acaso)
DROP POLICY IF EXISTS "Users can insert own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Users can update own quotations" ON public.quotations;
CREATE POLICY "Users can insert own quotations"
ON public.quotations
FOR INSERT
WITH CHECK (true); -- Permitimos insertar, la restricción de seller_id ya la quitamos antes.

CREATE POLICY "Users can update own quotations"
ON public.quotations
FOR UPDATE
USING (seller_id = auth.uid() OR 
       EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'jefe', 'supervisor')
       ));
