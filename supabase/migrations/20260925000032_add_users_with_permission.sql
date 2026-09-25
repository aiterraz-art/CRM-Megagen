-- Fase 4: las funciones del servidor deciden destinatarios de avisos por permiso, no por rol.
-- Devuelve los usuarios activos que tienen el permiso (rol + excepciones por persona).
-- Solo la clave de servicio puede llamarla: expone quien tiene cada acceso.

CREATE OR REPLACE FUNCTION public.users_with_permission(p_permission text)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id
    FROM public.profiles p
    WHERE coalesce(p.status, 'active') = 'active'
      AND public.user_has_permission(p.id, p_permission);
$$;

REVOKE ALL ON FUNCTION public.users_with_permission(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.users_with_permission(text) TO service_role;

NOTIFY pgrst, 'reload schema';
