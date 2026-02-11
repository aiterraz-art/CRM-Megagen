-- MASTER SCRIPT: ARMONIZACIÓN DE RLS PARA VISIBILIDAD DE VENTAS Y CLIENTES
-- Este script asegura que vendedores, jefes y supervisores tengan la visibilidad correcta.

-------------------------------------------------------------------------------
-- 1. TABLA: public.quotations
-------------------------------------------------------------------------------
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

-- Limpieza de políticas antiguas
DROP POLICY IF EXISTS "Visibilidad Restringida de Cotizaciones" ON public.quotations;
DROP POLICY IF EXISTS "Users can view own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Admins see all quotations" ON public.quotations;
DROP POLICY IF EXISTS "Lectura de Cotizaciones" ON public.quotations;
DROP POLICY IF EXISTS "Users can insert own quotations" ON public.quotations;
DROP POLICY IF EXISTS "Users can update own quotations" ON public.quotations;

-- SELECT: Vendedores ven lo suyo, Roles superiores ven todo
CREATE POLICY "quotations_select_policy" ON public.quotations
FOR SELECT TO authenticated
USING (
    seller_id = auth.uid() OR 
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
        AND role IN ('admin', 'manager', 'jefe', 'supervisor')
    )
);

-- INSERT: Permitir a todos los autenticados insertar
CREATE POLICY "quotations_insert_policy" ON public.quotations
FOR INSERT TO authenticated
WITH CHECK (true);

-- UPDATE: Dueño o Roles superiores
CREATE POLICY "quotations_update_policy" ON public.quotations
FOR UPDATE TO authenticated
USING (
    seller_id = auth.uid() OR 
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
        AND role IN ('admin', 'manager', 'jefe', 'supervisor')
    )
);

-- DELETE: Dueño o Roles superiores
CREATE POLICY "quotations_delete_policy" ON public.quotations
FOR DELETE TO authenticated
USING (
    seller_id = auth.uid() OR 
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
        AND role IN ('admin', 'manager', 'jefe', 'supervisor')
    )
);

-------------------------------------------------------------------------------
-- 2. TABLA: public.clients
-------------------------------------------------------------------------------
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers can view own clients" ON public.clients;
DROP POLICY IF EXISTS "Admins can do everything on clients" ON public.clients;

-- SELECT para Clientes: Armonizado con roles de supervisión
CREATE POLICY "clients_select_policy" ON public.clients
FOR SELECT TO authenticated
USING (
    created_by = auth.uid() OR 
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
        AND role IN ('admin', 'manager', 'jefe', 'supervisor')
    )
);

-------------------------------------------------------------------------------
-- 3. TABLA: public.seller_locations (Rastro de cotizaciones)
-------------------------------------------------------------------------------
ALTER TABLE public.seller_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View seller locations" ON public.seller_locations;

CREATE POLICY "seller_locations_select_policy" ON public.seller_locations
FOR SELECT TO authenticated
USING (
    seller_id = auth.uid() OR 
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
        AND role IN ('admin', 'manager', 'jefe', 'supervisor')
    )
);

-- INSERT para ubicaciones
CREATE POLICY "seller_locations_insert_policy" ON public.seller_locations
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = seller_id);

-------------------------------------------------------------------------------
-- 4. Notificar cambios
-------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
