-- Align schema + constraints + performance indexes for both production instances

-- 1) Normalize legacy visit status spelling
UPDATE public.visits
SET status = 'in_progress'
WHERE status = 'in-progress';

-- 2) Visits status constraint (backward-compatible set)
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_status_check;
ALTER TABLE public.visits
ADD CONSTRAINT visits_status_check
CHECK (status IN ('pending', 'scheduled', 'in_progress', 'in-progress', 'completed', 'cancelled', 'rescheduled'));

-- 3) Profiles role constraint (include admin)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check
CHECK (role IN ('admin', 'manager', 'jefe', 'administrativo', 'seller', 'driver', 'supervisor'));

-- 4) User whitelist role constraint
ALTER TABLE public.user_whitelist DROP CONSTRAINT IF EXISTS user_whitelist_role_check;
ALTER TABLE public.user_whitelist
ADD CONSTRAINT user_whitelist_role_check
CHECK (role IN ('admin', 'manager', 'jefe', 'administrativo', 'seller', 'driver', 'supervisor'));

-- 5) Tasks status constraint
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks
ADD CONSTRAINT tasks_status_check
CHECK (status IN ('pending', 'completed', 'cancelled'));

-- 6) Indexes for operational queries
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);

CREATE INDEX IF NOT EXISTS idx_visits_sales_rep_checkin ON public.visits(sales_rep_id, check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status ON public.visits(status);
CREATE INDEX IF NOT EXISTS idx_visits_client_id ON public.visits(client_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_quotation_id ON public.orders(quotation_id);

CREATE INDEX IF NOT EXISTS idx_quotations_seller_created ON public.quotations(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_client_id ON public.quotations(client_id);
CREATE INDEX IF NOT EXISTS idx_quotations_folio ON public.quotations(folio);

CREATE INDEX IF NOT EXISTS idx_delivery_routes_driver_status ON public.delivery_routes(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_dispatch_date ON public.delivery_routes(dispatch_date);

CREATE INDEX IF NOT EXISTS idx_route_items_route_status ON public.route_items(route_id, status);
CREATE INDEX IF NOT EXISTS idx_route_items_order_id ON public.route_items(order_id);

CREATE INDEX IF NOT EXISTS idx_seller_locations_seller_created ON public.seller_locations(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_locations_quotation_id ON public.seller_locations(quotation_id);

CREATE INDEX IF NOT EXISTS idx_call_logs_user_created ON public.call_logs(user_id, created_at DESC);

-- Prevent duplicated location rows for same quotation (queue/idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_locations_quotation_id
ON public.seller_locations(quotation_id)
WHERE quotation_id IS NOT NULL;
