-- fix_route_driver_fk.sql

-- 1. Drop existing FK to auth.users if it exists (constraint name is likely delivery_routes_driver_id_fkey)
ALTER TABLE delivery_routes DROP CONSTRAINT IF EXISTS delivery_routes_driver_id_fkey;

-- 2. Add new FK to public.profiles
-- This allows Supabase API to join delivery_routes -> profiles automatically
ALTER TABLE delivery_routes
ADD CONSTRAINT delivery_routes_driver_id_fkey
FOREIGN KEY (driver_id)
REFERENCES public.profiles(id);
