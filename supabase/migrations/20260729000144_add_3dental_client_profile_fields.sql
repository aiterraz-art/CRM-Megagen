ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS scanner_type text,
ADD COLUMN IF NOT EXISTS printer_type text,
ADD COLUMN IF NOT EXISTS implant_systems text,
ADD COLUMN IF NOT EXISTS laboratory_partner text;
