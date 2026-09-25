-- Add missing 'name' column to delivery_routes table
ALTER TABLE public.delivery_routes 
ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Ruta sin nombre';

-- Verify the column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'delivery_routes' AND column_name = 'name';
