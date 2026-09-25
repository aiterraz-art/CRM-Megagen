-- 1. Crear la tabla de inventario si no existe
CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    stock_qty INTEGER DEFAULT 0,
    price DECIMAL(12,2) DEFAULT 0,
    category TEXT DEFAULT 'General',
    demo_available BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Habilitar RLS
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

-- 3. Crear política para que todos los autenticados puedan ver
CREATE POLICY "Permitir lectura para usuarios autenticados" 
ON public.inventory FOR SELECT 
TO authenticated 
USING (true);

-- 4. Crear política para permitir inserción/actualización (puedes restringir esto a admins luego)
CREATE POLICY "Permitir gestión total para usuarios autenticados" 
ON public.inventory FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- 5. Forzar recarga del cache
NOTIFY pgrst, 'reload schema';
