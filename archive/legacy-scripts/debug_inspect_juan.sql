-- INSPECT DUPLICATE PROFILES AND ROUTES
-- Checks if 'jmena@3dental.cl' has multiple profile entries (Mock vs Real)

-- 1. List all profiles for this email
SELECT id, email, role, full_name, status 
FROM public.profiles 
WHERE email = 'jmena@3dental.cl';

-- 2. Check the most recent created routes and their driver IDs
SELECT r.id, r.name, r.driver_id, p.full_name as driver_name, r.created_at
FROM public.delivery_routes r
LEFT JOIN public.profiles p ON r.driver_id = p.id
ORDER BY r.created_at DESC
LIMIT 5;

-- 3. Check items for those routes
SELECT ri.id, ri.route_id, ri.status, o.delivery_status
FROM public.route_items ri
LEFT JOIN public.orders o ON ri.order_id = o.id
ORDER BY ri.created_at DESC
LIMIT 10;
