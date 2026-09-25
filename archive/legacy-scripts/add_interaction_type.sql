-- SCRIPT: Agregar Tipo de Interacción a Cotizaciones

-- 1. Agregar columna interaction_type a la tabla quotations
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS interaction_type TEXT CHECK (interaction_type IN ('Presencial', 'WhatsApp', 'Teléfono'));

-- 2. Comentario para claridad
COMMENT ON COLUMN public.quotations.interaction_type IS 'Especifica si la cotización fue resultado de una visita presencial, WhatsApp o llamada telefónica.';

-- 3. Notificar cambios
NOTIFY pgrst, 'reload schema';
