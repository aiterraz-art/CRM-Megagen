-- CLEAN UP ROUTES FOR FRESH START
-- Resets everything so you can test from scratch without "zombie" data.

-- 1. Unlink orders from any routes
UPDATE public.orders SET route_id = NULL;

-- 2. Delete all route items
DELETE FROM public.route_items;

-- 3. Delete all routes
DELETE FROM public.delivery_routes;

-- Verify it's empty
SELECT count(*) as routes_count FROM public.delivery_routes;
