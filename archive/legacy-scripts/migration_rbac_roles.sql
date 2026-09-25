-- Migration to update roles to the new RBAC system
-- Roles: manager, jefe, administrativo, vendedor, repartidor

-- 1. Create or Update the role enum if it exists, otherwise use text with check constraint
-- Since we are in a migration flow, let's use a robust approach.

-- Check if we have an enum for roles. If not, we might be using text.
-- Based on previous sessions, 'profiles' has a 'role' column (text).

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        CREATE TYPE app_role AS ENUM ('manager', 'jefe', 'administrativo', 'seller', 'driver');
    END IF;
END $$;

-- Update profiles table to use the new roles if they are currently using old names
-- 'manager' remains 'manager'
-- 'vendedor' -> 'seller' (consistency with previous work)
-- 'repartidor' -> 'driver' (consistency with previous work)
-- New: 'jefe', 'administrativo'

-- Ensure aterraza@3dental.cl is always manager
UPDATE profiles 
SET role = 'manager' 
WHERE email = 'aterraza@3dental.cl';

-- Add a comment or documentation for these roles
COMMENT ON COLUMN profiles.role IS 'manager (Admin), jefe (Supervisor), administrativo (Ops), seller (Vendedor), driver (Repartidor)';

-- Create a helper function to check permissions if needed in SQL
CREATE OR REPLACE FUNCTION public.has_role(required_roles app_role[])
RETURNS boolean AS $$
DECLARE
    user_role text;
BEGIN
    SELECT role INTO user_role FROM profiles WHERE id = auth.uid();
    RETURN user_role::app_role = ANY(required_roles);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
