-- Excepciones de permisos por persona y regla unica de permisos.
--
-- El acceso efectivo de un usuario pasa a ser:
--   admin                       -> todos los permisos (no se puede bloquear la matriz)
--   excepcion 'deny' del usuario -> sin el permiso, aunque su rol lo tenga
--   excepcion 'grant' del usuario -> con el permiso, aunque su rol no lo tenga
--   sin excepcion               -> lo que diga role_permissions para su rol
--
-- auth_user_has_permission mantiene su firma, de modo que todas las politicas y
-- funciones que ya la usan heredan las excepciones sin cambios.

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    permission text NOT NULL CHECK (permission ~ '^[A-Z][A-Z0-9_]*$'),
    effect text NOT NULL CHECK (effect IN ('grant', 'deny')),
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, permission)
);

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_permission_overrides FROM anon, authenticated;
GRANT SELECT ON public.user_permission_overrides TO authenticated;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT CASE
        WHEN p.id IS NULL THEN false
        WHEN lower(coalesce(p.role, '')) IN ('admin', 'manager') THEN true
        WHEN o.effect = 'deny' THEN false
        WHEN o.effect = 'grant' THEN true
        ELSE EXISTS (
            SELECT 1
            FROM public.role_permissions rp
            WHERE rp.role = lower(coalesce(p.role, ''))
              AND rp.permission = p_permission
        )
    END
    FROM (SELECT p_user_id AS id) target
    LEFT JOIN public.profiles p ON p.id = target.id
    LEFT JOIN public.user_permission_overrides o
      ON o.user_id = target.id
     AND o.permission = p_permission;
$$;

CREATE OR REPLACE FUNCTION public.auth_user_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.user_has_permission(auth.uid(), p_permission);
$$;

REVOKE ALL ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_has_permission(text) TO authenticated;

-- Lectura: cada usuario ve sus propias excepciones; quien administra permisos ve todas.
-- Escritura: solo mediante set_user_permission_overrides.
DROP POLICY IF EXISTS "User permission overrides read" ON public.user_permission_overrides;
CREATE POLICY "User permission overrides read"
ON public.user_permission_overrides
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.auth_user_has_permission('MANAGE_PERMISSIONS')
);

-- role_permissions: sus politicas historicas venian de scripts sueltos y difieren entre
-- instancias (en alguna el rol jefe podia escribir la matriz directamente). Se reemplazan
-- por lectura para autenticados; la escritura queda solo en sync_role_permissions.
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    v_policy record;
BEGIN
    FOR v_policy IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'role_permissions'
    LOOP
        EXECUTE format('DROP POLICY %I ON public.role_permissions', v_policy.policyname);
    END LOOP;
END;
$$;

CREATE POLICY "Role permissions read"
ON public.role_permissions
FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.sync_role_permissions(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inserted_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('MANAGE_PERMISSIONS') THEN
        RAISE EXCEPTION 'No tienes permiso para configurar la matriz de permisos';
    END IF;

    IF jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'p_rows debe ser un arreglo JSON';
    END IF;

    CREATE TEMP TABLE tmp_role_permissions (
        role text NOT NULL,
        permission text NOT NULL,
        PRIMARY KEY (role, permission)
    ) ON COMMIT DROP;

    INSERT INTO tmp_role_permissions (role, permission)
    SELECT DISTINCT
        CASE
            WHEN lower(trim(coalesce(value->>'role', ''))) = 'manager' THEN 'admin'
            WHEN lower(trim(coalesce(value->>'role', ''))) = 'administrativo' THEN 'facturador'
            WHEN lower(trim(coalesce(value->>'role', ''))) = 'supervisor' THEN 'jefe'
            ELSE lower(trim(coalesce(value->>'role', '')))
        END,
        trim(coalesce(value->>'permission', ''))
    FROM jsonb_array_elements(p_rows) AS value
    WHERE trim(coalesce(value->>'role', '')) <> ''
      AND trim(coalesce(value->>'permission', '')) <> '';

    IF EXISTS (
        SELECT 1
        FROM tmp_role_permissions
        WHERE role NOT IN ('admin', 'jefe', 'bodega', 'facturador', 'tesorero', 'seller', 'driver')
    ) THEN
        RAISE EXCEPTION 'La matriz contiene roles no soportados';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_role_permissions
        WHERE permission !~ '^[A-Z][A-Z0-9_]*$'
    ) THEN
        RAISE EXCEPTION 'La matriz contiene claves de permiso invalidas';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM tmp_role_permissions WHERE role = 'admin'
    ) THEN
        RAISE EXCEPTION 'La matriz debe incluir permisos para admin';
    END IF;

    DELETE FROM public.role_permissions
    WHERE role <> 'super_admin_placeholder';

    INSERT INTO public.role_permissions (role, permission)
    SELECT role, permission
    FROM tmp_role_permissions;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    RETURN v_inserted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_role_permissions(jsonb) TO authenticated;

-- Reemplaza todas las excepciones de un usuario. p_overrides: [{"permission": "...", "effect": "grant"|"deny"}]
CREATE OR REPLACE FUNCTION public.set_user_permission_overrides(p_user_id uuid, p_overrides jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_role text;
    v_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('MANAGE_PERMISSIONS') THEN
        RAISE EXCEPTION 'No tienes permiso para asignar permisos individuales';
    END IF;

    IF jsonb_typeof(p_overrides) <> 'array' THEN
        RAISE EXCEPTION 'p_overrides debe ser un arreglo JSON';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_target_role
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado';
    END IF;

    IF v_target_role IN ('admin', 'manager') AND jsonb_array_length(p_overrides) > 0 THEN
        RAISE EXCEPTION 'Un administrador siempre tiene todos los permisos; no admite excepciones';
    END IF;

    CREATE TEMP TABLE tmp_user_overrides (
        permission text PRIMARY KEY,
        effect text NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_user_overrides (permission, effect)
    SELECT DISTINCT ON (trim(coalesce(value->>'permission', '')))
        trim(coalesce(value->>'permission', '')),
        lower(trim(coalesce(value->>'effect', '')))
    FROM jsonb_array_elements(p_overrides) AS value
    WHERE trim(coalesce(value->>'permission', '')) <> '';

    IF EXISTS (
        SELECT 1
        FROM tmp_user_overrides
        WHERE permission !~ '^[A-Z][A-Z0-9_]*$'
           OR effect NOT IN ('grant', 'deny')
    ) THEN
        RAISE EXCEPTION 'Las excepciones contienen permisos o efectos invalidos';
    END IF;

    DELETE FROM public.user_permission_overrides
    WHERE user_id = p_user_id;

    INSERT INTO public.user_permission_overrides (user_id, permission, effect, updated_by, updated_at)
    SELECT p_user_id, permission, effect, auth.uid(), now()
    FROM tmp_user_overrides;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_permission_overrides(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_permission_overrides(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
