-- check_routes_status_v2.sql
-- Check if data exists
SELECT count(*) as total_routes FROM delivery_routes;

-- Check Foreign Key status
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.delivery_routes'::regclass
AND contype = 'f';

-- Check RLS Policy status on delivery_routes
SELECT policyname, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'delivery_routes';
