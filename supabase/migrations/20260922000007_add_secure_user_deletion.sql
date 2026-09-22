-- Permite a administradores eliminar cuentas desde ambos CRM sin exponer la
-- clave de servicio en el navegador. El borrado se bloquea cuando afectaría la
-- última cuenta administradora activa o cuando existen relaciones históricas.
CREATE OR REPLACE FUNCTION public.delete_crm_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_target_email text;
    v_target_role text;
    v_active_admin_count integer;
BEGIN
    IF auth.uid() IS NULL
       OR NOT coalesce(public.auth_user_has_permission('MANAGE_USERS'), false) THEN
        RAISE EXCEPTION 'No tienes permisos para eliminar usuarios';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Debes indicar el usuario a eliminar';
    END IF;

    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'No puedes eliminar tu propia cuenta';
    END IF;

    SELECT email, lower(coalesce(role, ''))
    INTO v_target_email, v_target_role
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El usuario no existe o ya fue eliminado';
    END IF;

    IF v_target_role = 'admin' THEN
        SELECT count(*)
        INTO v_active_admin_count
        FROM public.profiles
        WHERE lower(coalesce(role, '')) = 'admin'
          AND coalesce(status, 'active') = 'active';

        IF v_active_admin_count <= 1 THEN
            RAISE EXCEPTION 'No se puede eliminar al último administrador activo';
        END IF;
    END IF;

    DELETE FROM auth.users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró la cuenta de acceso del usuario';
    END IF;
EXCEPTION
    WHEN foreign_key_violation THEN
        RAISE EXCEPTION 'Este usuario tiene historial operativo asociado. Deshabilítalo para conservar la trazabilidad.';
END;
$$;

REVOKE ALL ON FUNCTION public.delete_crm_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_crm_user(uuid) TO authenticated;
