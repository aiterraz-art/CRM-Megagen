-- SCRIPT DE PERMISOS Y ROLES (RBAC)

-- 1. PERMISOS DE INVENTARIO
-- Los vendedores solo pueden VER (SELECT).
-- Los admins/jefes pueden hacer TODO (INSERT, UPDATE, DELETE).

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lectura de Inventario para todos" ON public.inventory;
DROP POLICY IF EXISTS "Gestión de Inventario para Admins" ON public.inventory;
DROP POLICY IF EXISTS "Permitir gestión total" ON public.inventory;
DROP POLICY IF EXISTS "Permitir lectura para usuarios autenticados" ON public.inventory;

-- Política de Lectura (Todos los autenticados)
CREATE POLICY "Lectura de Inventario para todos"
ON public.inventory FOR SELECT
TO authenticated
USING (true);

-- Política de Gestión (Solo Admins, Jefes y Supervisores)
CREATE POLICY "Gestión de Inventario para Admins"
ON public.inventory FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
);


-- 2. PERMISOS DE COTIZACIONES (QUOTATIONS)
-- Los vendedores pueden VER, EDITAR y BORRAR solo sus propias cotizaciones.
-- Los admins pueden VER, EDITAR y BORRAR todas las cotizaciones.

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Admins see all quotations" ON public.quotations;
DROP POLICY IF EXISTS "Users can insert own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Users can update own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Users can delete own quotations" ON public.quotations;

-- Política de Lectura
CREATE POLICY "Lectura de Cotizaciones"
ON public.quotations FOR SELECT
TO authenticated
USING (
  seller_id = auth.uid() OR 
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
);

-- Política de Inserción
CREATE POLICY "Inserción de Cotizaciones"
ON public.quotations FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política de Actualización (Edición)
CREATE POLICY "Edición de Cotizaciones"
ON public.quotations FOR UPDATE
TO authenticated
USING (
  seller_id = auth.uid() OR 
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
);

-- Política de Eliminación (Borrado)
CREATE POLICY "Eliminación de Cotizaciones"
ON public.quotations FOR DELETE
TO authenticated
USING (
  seller_id = auth.uid() OR 
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'jefe', 'supervisor')
  )
);

-- Notificar recarga de cache
NOTIFY pgrst, 'reload schema';
