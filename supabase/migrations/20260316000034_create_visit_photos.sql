CREATE TABLE IF NOT EXISTS public.visit_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'otro',
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visit_photos_visit_created_at
ON public.visit_photos (visit_id, created_at DESC);

ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Visit photos select owner or leadership" ON public.visit_photos;
CREATE POLICY "Visit photos select owner or leadership"
ON public.visit_photos
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM public.visits v
        WHERE v.id = visit_photos.visit_id
          AND v.sales_rep_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'manager')
    )
);

DROP POLICY IF EXISTS "Visit photos insert owner or leadership" ON public.visit_photos;
CREATE POLICY "Visit photos insert owner or leadership"
ON public.visit_photos
FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.visits v
        WHERE v.id = visit_photos.visit_id
          AND v.sales_rep_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'manager')
    )
);

DROP POLICY IF EXISTS "Visit photos delete owner or leadership" ON public.visit_photos;
CREATE POLICY "Visit photos delete owner or leadership"
ON public.visit_photos
FOR DELETE
USING (
    EXISTS (
        SELECT 1
        FROM public.visits v
        WHERE v.id = visit_photos.visit_id
          AND v.sales_rep_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'manager')
    )
);

GRANT SELECT, INSERT, DELETE ON public.visit_photos TO authenticated;
