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
          AND e.enumlabel = 'tesorero'
    ) THEN
        EXECUTE 'ALTER TYPE public.app_role ADD VALUE ''tesorero''';
    END IF;
END $$;

ALTER TABLE IF EXISTS public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE IF EXISTS public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK ((role = ANY (ARRAY['admin'::text, 'jefe'::text, 'facturador'::text, 'tesorero'::text, 'seller'::text, 'driver'::text])));

ALTER TABLE IF EXISTS public.user_whitelist
    DROP CONSTRAINT IF EXISTS user_whitelist_role_check;
ALTER TABLE IF EXISTS public.user_whitelist
    ADD CONSTRAINT user_whitelist_role_check
    CHECK ((role = ANY (ARRAY['admin'::text, 'jefe'::text, 'facturador'::text, 'tesorero'::text, 'seller'::text, 'driver'::text])));

DELETE FROM public.role_permissions
WHERE lower(coalesce(role, '')) = 'tesorero';

INSERT INTO public.role_permissions (role, permission)
SELECT 'tesorero', permission
FROM public.role_permissions
WHERE lower(coalesce(role, '')) = 'facturador'
GROUP BY permission;

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
        WHERE role NOT IN ('admin', 'jefe', 'facturador', 'tesorero', 'seller', 'driver')
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

DO $$
DECLARE
    v_signature text;
    v_oid oid;
    v_definition text;
BEGIN
    FOR v_signature IN
        SELECT unnest(ARRAY[
            'public.replace_inventory_pricing_import(jsonb)',
            'public.replace_inventory_stock_import(jsonb)',
            'public.import_dispatch_invoice_batch(jsonb, text)',
            'public.create_dispatch_routes_from_queue(jsonb)',
            'public.mark_size_change_sent(uuid, text)',
            'public.close_size_change_request(uuid, text)',
            'public.cancel_size_change_request(uuid, text)'
        ])
    LOOP
        SELECT p.oid
        INTO v_oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE format('%I.%I(%s)', n.nspname, p.proname, oidvectortypes(p.proargtypes)) = v_signature;

        IF v_oid IS NULL THEN
            CONTINUE;
        END IF;

        SELECT pg_get_functiondef(v_oid)
        INTO v_definition;

        IF v_definition ILIKE '%tesorero%' THEN
            CONTINUE;
        END IF;

        v_definition := replace(v_definition, '''facturador''::text', '''facturador''::text, ''tesorero''::text');
        v_definition := replace(v_definition, '''facturador''', '''facturador'', ''tesorero''');

        EXECUTE v_definition;
    END LOOP;
END $$;

DO $$
DECLARE
    pol record;
    v_qual text;
    v_with_check text;
    v_roles text;
    v_sql text;
BEGIN
    FOR pol IN
        SELECT *
        FROM pg_policies
        WHERE schemaname IN ('public', 'storage')
          AND (coalesce(qual, '') ILIKE '%facturador%' OR coalesce(with_check, '') ILIKE '%facturador%')
    LOOP
        v_qual := coalesce(pol.qual, '');
        v_with_check := coalesce(pol.with_check, '');

        IF v_qual NOT ILIKE '%tesorero%' THEN
            v_qual := replace(v_qual, '''facturador''::text', '''facturador''::text, ''tesorero''::text');
            v_qual := replace(v_qual, '''facturador''', '''facturador'', ''tesorero''');
        END IF;

        IF v_with_check NOT ILIKE '%tesorero%' THEN
            v_with_check := replace(v_with_check, '''facturador''::text', '''facturador''::text, ''tesorero''::text');
            v_with_check := replace(v_with_check, '''facturador''', '''facturador'', ''tesorero''');
        END IF;

        SELECT string_agg(quote_ident(role_name), ', ')
        INTO v_roles
        FROM unnest(pol.roles) AS role_name;

        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

        v_sql := format(
            'CREATE POLICY %I ON %I.%I AS %s FOR %s%s%s%s',
            pol.policyname,
            pol.schemaname,
            pol.tablename,
            pol.permissive,
            pol.cmd,
            CASE WHEN coalesce(v_roles, '') <> '' THEN format(' TO %s', v_roles) ELSE '' END,
            CASE WHEN nullif(v_qual, '') IS NOT NULL THEN format(' USING (%s)', v_qual) ELSE '' END,
            CASE WHEN nullif(v_with_check, '') IS NOT NULL THEN format(' WITH CHECK (%s)', v_with_check) ELSE '' END
        );

        EXECUTE v_sql;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
