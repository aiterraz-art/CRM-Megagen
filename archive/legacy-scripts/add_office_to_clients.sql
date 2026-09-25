-- AGREGAR COLUMNA DE OFICINA/DEPTO A LA TABLA DE CLIENTES
-- Ejecutar esto en el SQL Editor de Supabase (Megagen y 3Dental)
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS office TEXT;
COMMENT ON COLUMN clients.office IS 'Número de oficina, departamento o local comercial';