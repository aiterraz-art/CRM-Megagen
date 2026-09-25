-- 1. Eliminar la restricción en seller_locations para permitir vendedores simulados
ALTER TABLE public.seller_locations DROP CONSTRAINT IF EXISTS seller_locations_seller_id_fkey;

-- 2. Vincularlo opcionalmente a profiles para mantener integridad lógica (si no existe)
-- Esto asegura que solo IDs en profiles puedan tener ubicaciones, sin requerir Auth real.
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seller_locations_seller_id_profiles_fkey') THEN
        ALTER TABLE public.seller_locations 
            ADD CONSTRAINT seller_locations_seller_id_profiles_fkey 
            FOREIGN KEY (seller_id) REFERENCES public.profiles(id)
            ON DELETE CASCADE;
    END IF;
END $$;

-- 3. Recargar configuración
NOTIFY pgrst, 'reload schema';
