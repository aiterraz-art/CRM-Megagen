DO $$
DECLARE
    v_enum_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_type t
        WHERE t.typnamespace = 'public'::regnamespace
          AND t.typname = 'app_role'
    ) INTO v_enum_exists;

    IF v_enum_exists AND EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typnamespace = 'public'::regnamespace
          AND t.typname = 'app_role'
          AND e.enumlabel = 'administrativo'
    ) THEN
        EXECUTE 'ALTER TYPE public.app_role RENAME VALUE ''administrativo'' TO ''facturador''';
    END IF;
END $$;

DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN
        SELECT con.conname, con.conrelid::regclass AS table_name
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE con.contype = 'c'
          AND nsp.nspname = 'public'
          AND rel.relname IN ('profiles', 'user_whitelist')
          AND pg_get_constraintdef(con.oid) ILIKE '%administrativo%'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', rec.table_name, rec.conname);
    END LOOP;
END $$;

UPDATE public.profiles
SET role = 'facturador'
WHERE lower(coalesce(role, '')) = 'administrativo';

DO $$
BEGIN
    IF to_regclass('public.user_whitelist') IS NOT NULL THEN
        EXECUTE '
            UPDATE public.user_whitelist
            SET role = ''facturador''
            WHERE lower(coalesce(role, '''')) = ''administrativo''
        ';
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.role_permissions') IS NOT NULL THEN
        CREATE TEMP TABLE tmp_role_permissions_dedup ON COMMIT DROP AS
        SELECT
            CASE
                WHEN lower(coalesce(role, '')) = 'manager' THEN 'admin'
                WHEN lower(coalesce(role, '')) = 'administrativo' THEN 'facturador'
                ELSE lower(coalesce(role, ''))
            END AS role,
            permission
        FROM public.role_permissions
        WHERE role <> 'super_admin_placeholder'
        GROUP BY 1, 2;

        DELETE FROM public.role_permissions
        WHERE role <> 'super_admin_placeholder';

        INSERT INTO public.role_permissions (role, permission)
        SELECT role, permission
        FROM tmp_role_permissions_dedup;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.profiles') IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.profiles'::regclass
          AND conname = 'profiles_role_check'
    ) THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_role_check
        CHECK (role IN ('admin', 'jefe', 'facturador', 'seller', 'driver'));
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.user_whitelist') IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'public.user_whitelist'::regclass
              AND conname = 'user_whitelist_role_check'
        ) THEN
            ALTER TABLE public.user_whitelist
            ADD CONSTRAINT user_whitelist_role_check
            CHECK (role IN ('admin', 'jefe', 'facturador', 'seller', 'driver'));
        END IF;
    END IF;
END $$;

DO $$
DECLARE
    pol record;
    v_roles_sql text;
    v_sql text;
    v_qual text;
    v_with_check text;
BEGIN
    FOR pol IN
        SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
              coalesce(qual, '') ILIKE '%administrativo%'
              OR coalesce(with_check, '') ILIKE '%administrativo%'
          )
    LOOP
        SELECT string_agg(
            CASE WHEN role_name = 'public' THEN 'PUBLIC' ELSE quote_ident(role_name) END,
            ', '
        )
        INTO v_roles_sql
        FROM unnest(pol.roles) AS role_name;

        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

        v_qual := NULLIF(replace(coalesce(pol.qual, ''), 'administrativo', 'facturador'), '');
        v_with_check := NULLIF(replace(coalesce(pol.with_check, ''), 'administrativo', 'facturador'), '');

        v_sql := format(
            'CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s',
            pol.policyname,
            pol.schemaname,
            pol.tablename,
            pol.permissive,
            pol.cmd,
            coalesce(v_roles_sql, 'PUBLIC')
        );

        IF v_qual IS NOT NULL THEN
            v_sql := v_sql || format(' USING (%s)', v_qual);
        END IF;

        IF v_with_check IS NOT NULL THEN
            v_sql := v_sql || format(' WITH CHECK (%s)', v_with_check);
        END IF;

        EXECUTE v_sql;
    END LOOP;
END $$;

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
        WHERE role NOT IN ('admin', 'jefe', 'facturador', 'seller', 'driver')
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
