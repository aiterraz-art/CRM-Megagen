-- Pipeline automation:
-- 1) Track when quotation is sent to client (sent_at)
-- 2) Move quotation to won when an order is generated from it
-- 3) Auto-expire sent quotations after N days without movement/order

ALTER TABLE public.quotations
ADD COLUMN IF NOT EXISTS sent_at timestamptz;

UPDATE public.quotations
SET sent_at = created_at
WHERE status = 'sent'
  AND sent_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_quotation_after_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_stage boolean;
BEGIN
  IF NEW.quotation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quotations'
      AND column_name = 'stage'
  ) INTO v_has_stage;

  IF v_has_stage THEN
    EXECUTE 'UPDATE public.quotations SET status = ''approved'', stage = ''won'' WHERE id = $1'
    USING NEW.quotation_id;
  ELSE
    UPDATE public.quotations
    SET status = 'approved'
    WHERE id = NEW.quotation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_quotation_after_order_insert ON public.orders;
CREATE TRIGGER trg_sync_quotation_after_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_quotation_after_order_insert();

CREATE OR REPLACE FUNCTION public.expire_stale_sent_quotations(p_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := GREATEST(COALESCE(p_days, 3), 1);
  v_threshold timestamptz := now() - make_interval(days => v_days);
  v_is_privileged boolean := false;
  v_has_stage boolean := false;
  v_rows integer := 0;
  v_note text := '(3 dias sin respuesta negociacion perdida)';
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'manager', 'jefe', 'administrativo')
  ) INTO v_is_privileged;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quotations'
      AND column_name = 'stage'
  ) INTO v_has_stage;

  IF v_has_stage THEN
    EXECUTE
      'UPDATE public.quotations q
       SET status = ''rejected'',
           stage = ''lost'',
           comments = CASE
             WHEN coalesce(q.comments, '''') ILIKE ''%'' || $2 || ''%''
               THEN q.comments
             ELSE trim(concat_ws(E''\n'', nullif(q.comments, ''''), $2))
           END
       WHERE q.status = ''sent''
         AND coalesce(q.sent_at, q.created_at) <= $1
         AND NOT EXISTS (
           SELECT 1
           FROM public.orders o
           WHERE o.quotation_id = q.id
         )
         AND ($3 OR q.seller_id = auth.uid())'
    USING v_threshold, v_note, v_is_privileged;
  ELSE
    UPDATE public.quotations q
    SET status = 'rejected',
        comments = CASE
          WHEN coalesce(q.comments, '') ILIKE '%' || v_note || '%'
            THEN q.comments
          ELSE trim(concat_ws(E'\n', nullif(q.comments, ''), v_note))
        END
    WHERE q.status = 'sent'
      AND coalesce(q.sent_at, q.created_at) <= v_threshold
      AND NOT EXISTS (
        SELECT 1
        FROM public.orders o
        WHERE o.quotation_id = q.id
      )
      AND (v_is_privileged OR q.seller_id = auth.uid());
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_sent_quotations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_sent_quotations(integer) TO authenticated;
