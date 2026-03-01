-- ============================================================================
-- FIX RLS INVITACIONES (user_whitelist)
-- Fecha: 2026-02-28
-- Objetivo:
-- 1) Asegurar que admin/jefe puedan gestionar invitaciones.
-- 2) Permitir que un usuario autenticado lea SU propia invitación por email.
-- 3) Eliminar políticas legacy inconsistentes (manager-only / duplicadas).
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.user_whitelist') IS NULL THEN
    RETURN;
  END IF;

  -- Asegurar RLS activo
  ALTER TABLE public.user_whitelist ENABLE ROW LEVEL SECURITY;

  -- Limpiar políticas previas para evitar conflictos entre instancias
  DROP POLICY IF EXISTS "Allow authenticated users to read whitelist" ON public.user_whitelist;
  DROP POLICY IF EXISTS "Allow admins to manage whitelist" ON public.user_whitelist;
  DROP POLICY IF EXISTS "Owner bypass" ON public.user_whitelist;
  DROP POLICY IF EXISTS "Admins can manage whitelist" ON public.user_whitelist;
  DROP POLICY IF EXISTS "Whitelist read own email" ON public.user_whitelist;
  DROP POLICY IF EXISTS "Whitelist admins manage" ON public.user_whitelist;

  -- Lectura: propio email invitado o admin/jefe/manager (legacy)
  CREATE POLICY "Whitelist read own email"
  ON public.user_whitelist
  FOR SELECT
  USING (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'manager')
    )
  );

  -- Gestión completa de invitaciones: admin/jefe/manager (legacy)
  CREATE POLICY "Whitelist admins manage"
  ON public.user_whitelist
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'manager')
    )
  );
END $$;

