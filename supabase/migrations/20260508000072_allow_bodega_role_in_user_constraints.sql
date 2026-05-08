DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'app_role'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'app_role'
          AND e.enumlabel = 'bodega'
    ) THEN
        EXECUTE 'ALTER TYPE public.app_role ADD VALUE ''bodega''';
    END IF;
END $$;

ALTER TABLE IF EXISTS public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE IF EXISTS public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK ((role = ANY (ARRAY['admin'::text, 'jefe'::text, 'bodega'::text, 'facturador'::text, 'tesorero'::text, 'seller'::text, 'driver'::text])));

ALTER TABLE IF EXISTS public.user_whitelist
    DROP CONSTRAINT IF EXISTS user_whitelist_role_check;
ALTER TABLE IF EXISTS public.user_whitelist
    ADD CONSTRAINT user_whitelist_role_check
    CHECK ((role = ANY (ARRAY['admin'::text, 'jefe'::text, 'bodega'::text, 'facturador'::text, 'tesorero'::text, 'seller'::text, 'driver'::text])));

DROP FUNCTION IF EXISTS public.sync_role_permissions(jsonb);

CREATE OR REPLACE FUNCTION public.sync_role_permissions(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_inserted_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role <> 'admin' THEN
        RAISE EXCEPTION 'Solo admin puede sincronizar permisos';
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

NOTIFY pgrst, 'reload schema';
