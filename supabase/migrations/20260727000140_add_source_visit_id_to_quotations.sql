ALTER TABLE public.quotations
ADD COLUMN IF NOT EXISTS source_visit_id uuid NULL REFERENCES public.visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotations_source_visit_id_idx
ON public.quotations(source_visit_id);

CREATE INDEX IF NOT EXISTS orders_visit_id_idx
ON public.orders(visit_id);
