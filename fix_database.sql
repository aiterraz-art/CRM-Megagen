-- SCRIPT DE REPARACIÓN DE BASE DE DATOS
-- Copia todo este contenido y pégalo en el "SQL Editor" de Supabase.
-- Luego dale al botón "Run".

-- 0. ELIMINAR RESTRICCIONES DE USUARIO (SOLUCIÓN ERROR 23503)
ALTER TABLE public.quotations DROP CONSTRAINT IF EXISTS quotations_seller_id_fkey;
ALTER TABLE public.quotations DROP CONSTRAINT IF EXISTS quotations_seller_id_profiles_fkey; -- El error específico que te salió recién


-- 1. Agregar columna 'items' (JSONB) para guardar los productos
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]'::jsonb;

-- 2. Agregar columna 'folio' (SERIAL) para el número correlativo
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS folio SERIAL;

-- 3. Agregar columna 'payment_terms'
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- 4. Agregar columna 'status'
-- 4. Agregar columna 'status'
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- 4.1 Agregar columna 'comments'
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS comments TEXT;

-- 5. Dar permisos a TODAS las columnas (importante)
GRANT ALL ON TABLE public.quotations TO authenticated, anon, service_role;
GRANT ALL ON SEQUENCE public.quotations_folio_seq TO authenticated, anon, service_role;

-- 6. Recargar la API
NOTIFY pgrst, 'reload config';
