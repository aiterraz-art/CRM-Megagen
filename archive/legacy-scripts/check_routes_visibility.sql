-- check_routes_visibility.sql
-- 1. Check actual count as superuser
SELECT 'Total Routes (Superuser)' as check_type, COUNT(*) FROM delivery_routes;

-- 2. Check as admin user
-- We simulate the query context by checking the policy logic directly or just trusting checking the public.check_user_role function
SELECT * FROM public.check_user_role();

-- 3. List recent routes status and driver
SELECT id, name, status, driver_id, created_at FROM delivery_routes ORDER BY created_at DESC LIMIT 5;

-- 4. Check policies on delivery_routes
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check 
FROM pg_policies 
WHERE tablename = 'delivery_routes';
