BEGIN;

-- ---------------------------------------------------------------------------
-- Permissions catalog for new enterprise modules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role text NOT NULL,
    permission text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permissions_role_perm
    ON public.role_permissions (role, permission);

-- ---------------------------------------------------------------------------
-- Automation engine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    module text NOT NULL,
    trigger_type text NOT NULL,
    condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    action_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_module_active
    ON public.automation_rules (module, is_active);

CREATE TABLE IF NOT EXISTS public.automation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed')),
    context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_text text NULL,
    started_at timestamptz NULL,
    finished_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_rule_created
    ON public.automation_runs (rule_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- SLA and alerting
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sla_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    module text NOT NULL,
    metric text NOT NULL,
    threshold_minutes integer NOT NULL CHECK (threshold_minutes > 0),
    severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_module_active
    ON public.sla_policies (module, is_active);

CREATE TABLE IF NOT EXISTS public.sla_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id uuid NULL REFERENCES public.sla_policies(id) ON DELETE SET NULL,
    module text NOT NULL,
    entity_id uuid NULL,
    actor_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ack', 'resolved')),
    severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    message text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    opened_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_sla_events_status_opened
    ON public.sla_events (status, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.ops_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    title text NOT NULL,
    message text NOT NULL,
    context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ack', 'resolved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_alerts_status_created
    ON public.ops_alerts (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Approvals and governance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.approval_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module text NOT NULL,
    entity_id uuid NULL,
    requester_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    approver_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    approval_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz NULL,
    decision_note text NULL
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status_requested
    ON public.approval_requests (status, requested_at DESC);

-- ---------------------------------------------------------------------------
-- Post-sale and collections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
    order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
    owner_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    title text NOT NULL,
    description text NULL,
    priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    due_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_service_tickets_status_due
    ON public.service_tickets (status, due_at, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_commitments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
    order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
    owner_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    amount numeric NOT NULL CHECK (amount >= 0),
    currency text NOT NULL DEFAULT 'CLP',
    commitment_date date NOT NULL,
    paid_date date NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
    note text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_commitments_status_date
    ON public.payment_commitments (status, commitment_date);

-- ---------------------------------------------------------------------------
-- Unified activity timeline view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_crm_activity_timeline AS
SELECT
    'visit'::text AS activity_type,
    v.id AS activity_id,
    v.client_id,
    v.sales_rep_id AS actor_id,
    COALESCE(v.status::text, 'unknown') AS status,
    COALESCE(v.notes, '') AS summary,
    v.check_in_time AS happened_at
FROM public.visits v
UNION ALL
SELECT
    'quotation'::text,
    q.id,
    q.client_id,
    q.seller_id,
    COALESCE(q.status::text, 'unknown'),
    COALESCE(q.comments, ''),
    q.created_at
FROM public.quotations q
UNION ALL
SELECT
    'order'::text,
    o.id,
    o.client_id,
    o.user_id,
    COALESCE(o.status::text, 'unknown'),
    COALESCE(o.interaction_type, ''),
    COALESCE(o.created_at, now())
FROM public.orders o
UNION ALL
SELECT
    'call'::text,
    cl.id,
    cl.client_id,
    cl.user_id,
    COALESCE(cl.status::text, 'unknown'),
    COALESCE(cl.notes, ''),
    cl.created_at
FROM public.call_logs cl
UNION ALL
SELECT
    'email'::text,
    el.id,
    el.client_id,
    el.user_id,
    'sent'::text,
    COALESCE(el.subject, ''),
    el.created_at
FROM public.email_logs el
UNION ALL
SELECT
    'task'::text,
    t.id,
    t.client_id,
    COALESCE(t.user_id, t.assigned_to) AS actor_id,
    COALESCE(t.status::text, 'unknown'),
    COALESCE(t.title, ''),
    COALESCE(t.created_at, now())
FROM public.tasks t;

-- ---------------------------------------------------------------------------
-- Operational health view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_ops_health AS
WITH v AS (
    SELECT COUNT(*)::bigint AS stale_visits
    FROM public.visits
    WHERE status::text IN ('in_progress', 'in-progress')
      AND check_in_time < now() - interval '24 hours'
),
q AS (
    SELECT COUNT(*)::bigint AS quotations_without_location
    FROM public.quotations qt
    LEFT JOIN public.seller_locations sl ON sl.quotation_id = qt.id
    WHERE sl.id IS NULL
),
r AS (
    SELECT COUNT(*)::bigint AS routes_without_pending
    FROM (
        SELECT dr.id
        FROM public.delivery_routes dr
        LEFT JOIN public.route_items ri ON ri.route_id = dr.id
        WHERE dr.status::text = 'in_progress'
        GROUP BY dr.id
        HAVING COUNT(*) FILTER (WHERE ri.status::text IN ('pending', 'rescheduled', 'failed')) = 0
    ) x
),
t AS (
    SELECT COUNT(*)::bigint AS overdue_tasks
    FROM public.tasks
    WHERE status::text = 'pending'
      AND due_date IS NOT NULL
      AND due_date < now()
)
SELECT
    v.stale_visits,
    q.quotations_without_location,
    r.routes_without_pending,
    t.overdue_tasks
FROM v, q, r, t;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_automation_rules_updated_at ON public.automation_rules;
CREATE TRIGGER trg_touch_automation_rules_updated_at
BEFORE UPDATE ON public.automation_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.enqueue_ops_alert(
    p_source text,
    p_severity text,
    p_title text,
    p_message text,
    p_context jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.ops_alerts (source, severity, title, message, context_json)
    VALUES (
        COALESCE(NULLIF(trim(p_source), ''), 'system'),
        CASE WHEN p_severity IN ('info', 'warning', 'critical') THEN p_severity ELSE 'warning' END,
        COALESCE(NULLIF(trim(p_title), ''), 'Alert'),
        COALESCE(NULLIF(trim(p_message), ''), 'No message'),
        COALESCE(p_context, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Seed baseline permissions for new modules
-- ---------------------------------------------------------------------------
INSERT INTO public.role_permissions (role, permission)
VALUES
    ('admin', 'VIEW_OPERATIONS'),
    ('admin', 'MANAGE_AUTOMATIONS'),
    ('admin', 'MANAGE_SLA'),
    ('admin', 'MANAGE_APPROVALS'),
    ('admin', 'MANAGE_POSTSALE'),
    ('admin', 'MANAGE_COLLECTIONS'),
    ('manager', 'VIEW_OPERATIONS'),
    ('manager', 'MANAGE_AUTOMATIONS'),
    ('manager', 'MANAGE_SLA'),
    ('manager', 'MANAGE_APPROVALS'),
    ('manager', 'MANAGE_POSTSALE'),
    ('manager', 'MANAGE_COLLECTIONS'),
    ('jefe', 'VIEW_OPERATIONS'),
    ('jefe', 'MANAGE_SLA'),
    ('administrativo', 'VIEW_OPERATIONS'),
    ('administrativo', 'MANAGE_COLLECTIONS'),
    ('supervisor', 'VIEW_OPERATIONS')
ON CONFLICT (role, permission) DO NOTHING;

COMMIT;

