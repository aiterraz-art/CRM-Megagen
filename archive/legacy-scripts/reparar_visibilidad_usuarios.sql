-- MASTER FIX: USER VISIBILITY & SCHEMA SYNC
-- Ejecuta este script en el SQL Editor de Supabase para resolver la invisibilidad de usuarios nuevos.

-- 1. Asegurar que el esquema public.profiles es una VISTA o tiene los mismos datos que crm.profiles
-- Si public.profiles es una tabla independiente, sincronizamos los datos:
INSERT INTO public.profiles (id, email, role, status, full_name, created_at)
SELECT id, email, role, status, full_name, created_at FROM crm.profiles
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  role = EXCLUDED.role,
  full_name = EXCLUDED.full_name;

-- 2. Habilitar RLS en AMBOS esquemas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Políticas para el esquema CRM (Crucial para Settings.tsx)
DROP POLICY IF EXISTS "Admins view all crm profiles" ON crm.profiles;
CREATE POLICY "Admins view all crm profiles"
ON crm.profiles FOR SELECT
TO authenticated
USING (
    (auth.jwt() ->> 'email' = 'aterraza@3dental.cl')
    OR (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('manager', 'admin')))
);

DROP POLICY IF EXISTS "Users view own crm profile" ON crm.profiles;
CREATE POLICY "Users view own crm profile"
ON crm.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users insert own crm profile" ON crm.profiles;
CREATE POLICY "Users insert own crm profile"
ON crm.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- 4. Notificamos éxito
SELECT 'Permisos reparados. Por favor refresca el CRM.' as status;
