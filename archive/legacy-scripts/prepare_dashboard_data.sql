-- SCRIPT PARA DASHBOARD: REPARACIÓN Y ESTRANDARIZACIÓN

-- 1. Renombrar columnas si existen los nombres antiguos
-- Usamos 'lower' para evitar problemas de mayúsculas/minúsculas y 'table_schema' para precisión
DO $$ 
BEGIN 
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'visits' 
        AND lower(column_name) = 'check_in'
    ) THEN
        ALTER TABLE public.visits RENAME COLUMN check_in TO check_in_time;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'visits' 
        AND lower(column_name) = 'check_out'
    ) THEN
        ALTER TABLE public.visits RENAME COLUMN check_out TO check_out_time;
    END IF;
END $$;

-- 2. Asegurar columnas de rastreo faltantes
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES public.profiles(id);

-- 3. Crear índices (Solo si las columnas ya existen tras el rename)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='visits' AND column_name='check_in_time') THEN
        CREATE INDEX IF NOT EXISTS idx_visits_check_in_date ON public.visits (check_in_time);
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotations' AND column_name='created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_quotations_created_date ON public.quotations (created_at);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clients_creator ON public.clients (created_by);

-- 4. Notificar recarga de caché
NOTIFY pgrst, 'reload schema';
