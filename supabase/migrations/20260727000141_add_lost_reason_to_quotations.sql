ALTER TABLE public.quotations
ADD COLUMN IF NOT EXISTS lost_reason text NULL;
