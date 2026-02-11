-- SCRIPT PARA AGREGAR INFORMACIÓN CONTÁCTO Y PERFILES

-- 1. Actualizar tabla de Clientes
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Asegurar columna full_name en Profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS full_name TEXT;

-- 3. Notificar recarga de caché de la API
NOTIFY pgrst, 'reload schema';
