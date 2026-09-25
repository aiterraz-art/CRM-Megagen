-- debug_join_relation.sql

-- 1. Get the Raw Routes (LIMIT 5)
SELECT id, name, driver_id FROM delivery_routes LIMIT 5;

-- 2. Take those driver_ids and check if they exist in profiles
SELECT * FROM public.profiles 
WHERE id IN (SELECT driver_id FROM delivery_routes LIMIT 5);

-- 3. Simulate the JOIN the API is doing (Left Join)
SELECT 
  dr.id as route_id, 
  dr.name, 
  dr.driver_id, 
  p.email as driver_email, 
  p.role as driver_role
FROM delivery_routes dr
LEFT JOIN public.profiles p ON dr.driver_id = p.id;

-- 4. Check RLS on Profiles explicitly for the admin user (simulate)
-- (This is just a check, assuming the previous script ran)
SELECT * FROM pg_policies WHERE tablename = 'profiles';
