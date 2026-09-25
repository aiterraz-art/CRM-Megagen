-- SCRIPT PARA REPARAR ELIMINACIÓN Y RLS DE COTIZACIONES

-- 1. Habilitar eliminación en cascada para ubicaciones
-- Primero intentamos encontrar el nombre de la restricción y recrearla
DO $$ 
BEGIN 
    -- Eliminar la restricción existente si existe
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'seller_locations_quotation_id_fkey') THEN
        ALTER TABLE public.seller_locations DROP CONSTRAINT seller_locations_quotation_id_fkey;
    END IF;
    
    -- Añadir la nueva con CASCADE
    ALTER TABLE public.seller_locations 
    ADD CONSTRAINT seller_locations_quotation_id_fkey 
    FOREIGN KEY (quotation_id) 
    REFERENCES public.quotations(id) 
    ON DELETE CASCADE;
END $$;

-- 2. Asegurar que las políticas de DELETE y UPDATE existan para todos los roles autorizados
-- (Ya estaban en fix_rbac_permissions.sql, pero las reforzamos por si acaso)

DROP POLICY IF EXISTS "Eliminación de Cotizaciones" ON public.quotations;
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

DROP POLICY IF EXISTS "Edición de Cotizaciones" ON public.quotations;
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

-- 3. Notificar recarga de cache
NOTIFY pgrst, 'reload schema';
