CREATE TABLE IF NOT EXISTS public.quotation_sellers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email text NULL,
    linked_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    active boolean NOT NULL DEFAULT true,
    created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quotation_sellers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS quotation_sellers_active_idx
ON public.quotation_sellers(active);

CREATE INDEX IF NOT EXISTS quotation_sellers_linked_profile_idx
ON public.quotation_sellers(linked_profile_id);

DROP POLICY IF EXISTS "Authenticated users read quotation sellers" ON public.quotation_sellers;
CREATE POLICY "Authenticated users read quotation sellers"
ON public.quotation_sellers
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Backoffice manages quotation sellers" ON public.quotation_sellers;
CREATE POLICY "Backoffice manages quotation sellers"
ON public.quotation_sellers
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'facturador', 'administrativo', 'tesorero')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'facturador', 'administrativo', 'tesorero')
    )
);

ALTER TABLE public.quotations
    ADD COLUMN IF NOT EXISTS seller_catalog_id uuid NULL REFERENCES public.quotation_sellers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS seller_name_snapshot text NULL,
    ADD COLUMN IF NOT EXISTS seller_email_snapshot text NULL;

CREATE INDEX IF NOT EXISTS quotations_seller_catalog_id_idx
ON public.quotations(seller_catalog_id);

UPDATE public.quotations q
SET seller_name_snapshot = COALESCE(
        NULLIF(trim(q.seller_name_snapshot), ''),
        NULLIF(trim(p.full_name), ''),
        NULLIF(trim(split_part(coalesce(p.email, ''), '@', 1)), ''),
        'Vendedor'
    ),
    seller_email_snapshot = COALESCE(
        NULLIF(trim(q.seller_email_snapshot), ''),
        NULLIF(trim(p.email), '')
    )
FROM public.profiles p
WHERE q.seller_id = p.id
  AND (
      q.seller_name_snapshot IS NULL
      OR trim(q.seller_name_snapshot) = ''
      OR q.seller_email_snapshot IS NULL
      OR trim(coalesce(q.seller_email_snapshot, '')) = ''
  );
