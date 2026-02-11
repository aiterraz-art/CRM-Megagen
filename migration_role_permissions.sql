-- Migration to create dynamic role permissions system
-- 0. Asegurar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create the role_permissions table
-- USAMOS TEXT para mayor flexibilidad y evitar errores de ENUMS rígidos en Postgres
CREATE TABLE IF NOT EXISTS public.role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role TEXT NOT NULL, 
    permission TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(role, permission)
);

-- 2. Seed initial permissions based on the approved plan
-- Permission Keys: 
-- UPLOAD_EXCEL, MANAGE_INVENTORY, MANAGE_PRICING, VIEW_METAS, MANAGE_METAS, MANAGE_DISPATCH, EXECUTE_DELIVERY, MANAGE_USERS

-- Manager: Acceso Total
INSERT INTO public.role_permissions (role, permission) VALUES
('manager', 'UPLOAD_EXCEL'),
('manager', 'MANAGE_INVENTORY'),
('manager', 'MANAGE_PRICING'),
('manager', 'VIEW_METAS'),
('manager', 'MANAGE_METAS'),
('manager', 'MANAGE_DISPATCH'),
('manager', 'EXECUTE_DELIVERY'),
('manager', 'MANAGE_USERS')
ON CONFLICT DO NOTHING;

-- Jefe: Supervisión (No carga archivos)
INSERT INTO public.role_permissions (role, permission) VALUES
('jefe', 'MANAGE_INVENTORY'),
('jefe', 'VIEW_METAS'),
('jefe', 'MANAGE_DISPATCH')
ON CONFLICT DO NOTHING;

-- Administrativo: Operativo (No ve metas)
INSERT INTO public.role_permissions (role, permission) VALUES
('administrativo', 'UPLOAD_EXCEL'),
('administrativo', 'MANAGE_INVENTORY'),
('administrativo', 'MANAGE_PRICING'),
('administrativo', 'MANAGE_DISPATCH')
ON CONFLICT DO NOTHING;

-- Seller: Ventas
INSERT INTO public.role_permissions (role, permission) VALUES
('seller', 'VIEW_METAS')
ON CONFLICT DO NOTHING;

-- Driver: Reparto
INSERT INTO public.role_permissions (role, permission) VALUES
('driver', 'EXECUTE_DELIVERY')
ON CONFLICT DO NOTHING;

-- 3. Enable RLS on role_permissions (Managers can manage them)
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read role_permissions" 
ON public.role_permissions FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Managers can manage role_permissions" 
ON public.role_permissions FOR ALL 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = auth.uid() AND role = 'manager'
    )
);
