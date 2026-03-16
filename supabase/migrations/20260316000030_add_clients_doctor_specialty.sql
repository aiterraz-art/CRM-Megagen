ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS doctor_specialty TEXT;
