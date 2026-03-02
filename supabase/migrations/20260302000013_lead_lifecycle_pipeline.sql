-- Lead lifecycle foundation: status taxonomy, scoring, pool access and reassignment control.

ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS lead_score SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_lead_score_range_ck'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients
    ADD CONSTRAINT clients_lead_score_range_ck CHECK (lead_score BETWEEN 1 AND 3);
  END IF;
END $$;

-- Backfill legacy status
UPDATE public.clients
SET status = 'prospect_new'
WHERE status = 'prospect';

-- Recommended indexes
CREATE INDEX IF NOT EXISTS idx_clients_pipeline_pool
  ON public.clients (status, created_by, last_visit_date, created_at);

CREATE INDEX IF NOT EXISTS idx_visits_cold_pipeline
  ON public.visits (type, sales_rep_id, check_in_time);

-- Keep/refresh policies with explicit pool read logic and update permissions.
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sellers view own clients" ON public.clients;
CREATE POLICY "Sellers view own clients"
ON public.clients
FOR SELECT
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(COALESCE(p.role, '')) = ANY (ARRAY['admin','manager','jefe','administrativo','supervisor'])
  )
);

DROP POLICY IF EXISTS "Pool read abandoned prospects" ON public.clients;
CREATE POLICY "Pool read abandoned prospects"
ON public.clients
FOR SELECT
USING (
  (
    status = 'prospect'
    OR status LIKE 'prospect\_%' ESCAPE '\\'
  )
  AND (
    (last_visit_date IS NOT NULL AND last_visit_date < (NOW() - INTERVAL '30 days'))
    OR (last_visit_date IS NULL AND created_at < (NOW() - INTERVAL '30 days'))
  )
);

DROP POLICY IF EXISTS "Sellers update own clients" ON public.clients;
CREATE POLICY "Sellers update own clients"
ON public.clients
FOR UPDATE
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(COALESCE(p.role, '')) = ANY (ARRAY['admin','manager','jefe','administrativo','supervisor'])
  )
)
WITH CHECK (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(COALESCE(p.role, '')) = ANY (ARRAY['admin','manager','jefe','administrativo','supervisor'])
  )
);

CREATE OR REPLACE FUNCTION public.enforce_client_reassignment_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_role text;
BEGIN
  -- Service role / backend jobs can bypass this trigger.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    SELECT lower(COALESCE(p.role, '')) INTO actor_role
    FROM public.profiles p
    WHERE p.id = auth.uid();

    IF actor_role IS NULL OR actor_role NOT IN ('admin','jefe') THEN
      RAISE EXCEPTION 'Solo admin o jefe pueden reasignar leads.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_client_reassignment_permissions ON public.clients;
CREATE TRIGGER trg_enforce_client_reassignment_permissions
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.enforce_client_reassignment_permissions();
