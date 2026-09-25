-- 1. Eliminar la restricción que obliga a que todo perfil tenga un usuario de Auth
-- Esto permite crear "perfiles sombra" para pruebas o vendedores que no se loguean
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 2. Insertar perfiles de prueba (Daniela y Natalia)
INSERT INTO public.profiles (id, email, role, zone)
VALUES 
('11111111-1111-1111-1111-111111111111', 'dcarvajal@3dental.cl', 'vendedor', 'Santiago Centro'),
('22222222-2222-2222-2222-222222222222', 'nrigual@3dental.cl', 'vendedor', 'Las Condes')
ON CONFLICT (id) DO UPDATE SET 
  role = EXCLUDED.role,
  zone = EXCLUDED.zone;

-- 3. Forzar recarga de cache por seguridad
NOTIFY pgrst, 'reload schema';
