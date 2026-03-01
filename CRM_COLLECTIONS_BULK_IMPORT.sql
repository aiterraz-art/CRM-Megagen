BEGIN;

CREATE TABLE IF NOT EXISTS public.collections_import_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name text NOT NULL,
    row_count integer NOT NULL DEFAULT 0,
    uploaded_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collections_batches_active_created
    ON public.collections_import_batches (is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.collections_pending (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES public.collections_import_batches(id) ON DELETE CASCADE,
    seller_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    seller_email text NULL,
    seller_name text NULL,
    client_name text NOT NULL,
    client_rut text NULL,
    document_number text NOT NULL,
    document_type text NOT NULL DEFAULT 'invoice',
    issue_date date NULL,
    due_date date NOT NULL,
    amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
    outstanding_amount numeric NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'disputed')),
    notes text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collections_pending_batch
    ON public.collections_pending (batch_id);

CREATE INDEX IF NOT EXISTS idx_collections_pending_seller_due
    ON public.collections_pending (seller_id, due_date);

CREATE INDEX IF NOT EXISTS idx_collections_pending_status_due
    ON public.collections_pending (status, due_date);

CREATE OR REPLACE VIEW public.vw_collections_pending_current AS
SELECT
    cp.*,
    CASE
        WHEN cp.due_date < CURRENT_DATE
             AND cp.status IN ('pending', 'partial')
        THEN (CURRENT_DATE - cp.due_date)
        ELSE 0
    END::integer AS aging_days
FROM public.collections_pending cp
JOIN public.collections_import_batches b
  ON b.id = cp.batch_id
WHERE b.is_active = true;

CREATE OR REPLACE VIEW public.vw_collections_seller_summary_current AS
SELECT
    COALESCE(seller_id::text, seller_email, 'sin_vendedor') AS seller_key,
    seller_id,
    seller_email,
    seller_name,
    COUNT(*)::bigint AS documents,
    SUM(outstanding_amount)::numeric AS outstanding_total,
    COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status IN ('pending', 'partial'))::bigint AS overdue_documents,
    SUM(CASE WHEN due_date < CURRENT_DATE AND status IN ('pending', 'partial') THEN outstanding_amount ELSE 0 END)::numeric AS overdue_total
FROM public.vw_collections_pending_current
GROUP BY seller_key, seller_id, seller_email, seller_name
ORDER BY overdue_total DESC, outstanding_total DESC;

CREATE OR REPLACE FUNCTION public.replace_collections_pending(
    p_file_name text,
    p_uploaded_by uuid,
    p_rows jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_batch_id uuid;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'p_rows debe ser un arreglo JSON';
    END IF;

    INSERT INTO public.collections_import_batches (
        file_name,
        uploaded_by,
        is_active
    )
    VALUES (
        COALESCE(NULLIF(trim(p_file_name), ''), 'collections_upload'),
        p_uploaded_by,
        false
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO public.collections_pending (
        batch_id,
        seller_id,
        seller_email,
        seller_name,
        client_name,
        client_rut,
        document_number,
        document_type,
        issue_date,
        due_date,
        amount,
        outstanding_amount,
        status,
        notes
    )
    SELECT
        v_batch_id,
        p.id,
        NULLIF(trim(r.seller_email), ''),
        NULLIF(trim(r.seller_name), ''),
        NULLIF(trim(r.client_name), ''),
        NULLIF(trim(r.client_rut), ''),
        NULLIF(trim(r.document_number), ''),
        COALESCE(NULLIF(trim(r.document_type), ''), 'invoice'),
        CASE WHEN NULLIF(trim(r.issue_date), '') IS NULL THEN NULL ELSE (NULLIF(trim(r.issue_date), ''))::date END,
        (NULLIF(trim(r.due_date), ''))::date,
        COALESCE(r.amount, 0),
        COALESCE(r.outstanding_amount, COALESCE(r.amount, 0)),
        CASE WHEN r.status IN ('pending', 'partial', 'paid', 'overdue', 'disputed') THEN r.status ELSE 'pending' END,
        NULLIF(trim(r.notes), '')
    FROM jsonb_to_recordset(p_rows) AS r(
        seller_email text,
        seller_name text,
        client_name text,
        client_rut text,
        document_number text,
        document_type text,
        issue_date text,
        due_date text,
        amount numeric,
        outstanding_amount numeric,
        status text,
        notes text
    )
    LEFT JOIN public.profiles p
      ON lower(p.email) = lower(NULLIF(trim(r.seller_email), ''))
    WHERE NULLIF(trim(r.client_name), '') IS NOT NULL
      AND NULLIF(trim(r.document_number), '') IS NOT NULL
      AND NULLIF(trim(r.due_date), '') IS NOT NULL;

    UPDATE public.collections_import_batches
    SET row_count = (
        SELECT COUNT(*)::integer
        FROM public.collections_pending
        WHERE batch_id = v_batch_id
    )
    WHERE id = v_batch_id;

    UPDATE public.collections_import_batches
    SET is_active = false
    WHERE is_active = true
      AND id <> v_batch_id;

    UPDATE public.collections_import_batches
    SET is_active = true
    WHERE id = v_batch_id;

    RETURN v_batch_id;
END;
$$;

COMMIT;

