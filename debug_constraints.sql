-- SCRIPT PARA VER RESTRICCIONES ACTIVAS
-- Ejecuta esto y mándame una captura del resultado (Results)

SELECT conname as nombre_restriccion, contype as tipo
FROM pg_constraint
WHERE conrelid = 'public.quotations'::regclass;
