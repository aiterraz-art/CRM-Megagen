-- 1. Agregar columna SKU a la tabla de inventario si no existe
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'inventory' AND COLUMN_NAME = 'sku') THEN
        ALTER TABLE public.inventory ADD COLUMN sku TEXT;
    END IF;
END $$;

-- 2. Asegurar que el SKU sea único (opcional, pero recomendado para el reemplazo limpio)
-- ALTER TABLE public.inventory ADD CONSTRAINT inventory_sku_key UNIQUE (sku);

-- 3. Limpiar la tabla para la primera importación limpia (Opcional, el frontend hará el DELETE)
-- DELETE FROM public.inventory;

-- 4. Notificar a PostgREST para actualizar los tipos
NOTIFY pgrst, 'reload schema';
