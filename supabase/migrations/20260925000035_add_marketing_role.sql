-- Nuevo perfil: marketing.
--
-- * El rol se agrega a las listas de roles validos (perfiles, invitaciones y matriz).
-- * Paquete inicial: leads y Meta (ver, gestionar, importar, plantillas) e inventario y
--   tienda web. Se ajusta despues en Configuracion -> Roles.
-- * Los leads son clientes en estado prospecto. MANAGE_LEADS (nuevo) permite ver, mover de
--   etapa, importar y asignar solo prospectos, sin acceso a clientes activos.
-- * La tienda web leia datos con MANAGE_INVENTORY; ahora basta MANAGE_WEB_STORE, para que
--   quien gestiona la tienda sin gestionar inventario vea la pagina. Hoy solo admin tiene
--   MANAGE_WEB_STORE, asi que nadie cambia de acceso.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role = ANY (ARRAY['admin', 'jefe', 'bodega', 'facturador', 'tesorero', 'seller', 'driver', 'marketing']));

ALTER TABLE public.user_whitelist DROP CONSTRAINT IF EXISTS user_whitelist_role_check;
ALTER TABLE public.user_whitelist ADD CONSTRAINT user_whitelist_role_check
    CHECK (role = ANY (ARRAY['admin', 'jefe', 'bodega', 'facturador', 'tesorero', 'seller', 'driver', 'marketing']));

INSERT INTO public.role_permissions (role, permission)
VALUES
    ('admin', 'MANAGE_LEADS'), ('jefe', 'MANAGE_LEADS'),
    ('marketing', 'VIEW_LEADS'), ('marketing', 'VIEW_ALL_LEADS'), ('marketing', 'MANAGE_LEADS'),
    ('marketing', 'MANAGE_LEAD_TEMPLATES'), ('marketing', 'VIEW_META_LEADS'), ('marketing', 'IMPORT_CLIENTS'),
    ('marketing', 'VIEW_INVENTORY'), ('marketing', 'VIEW_INVENTORY_VALUE'), ('marketing', 'MANAGE_WEB_STORE')
ON CONFLICT (role, permission) DO NOTHING;

DROP POLICY IF EXISTS "Leads read all team" ON public.clients;
CREATE POLICY "Leads read all team"
ON public.clients
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((status = 'prospect' OR status LIKE 'prospect\_%') AND (SELECT public.auth_user_has_permission('VIEW_ALL_LEADS')));

DROP POLICY IF EXISTS "Leads manage all team" ON public.clients;
CREATE POLICY "Leads manage all team"
ON public.clients
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((status = 'prospect' OR status LIKE 'prospect\_%') AND (SELECT public.auth_user_has_permission('MANAGE_LEADS')))
WITH CHECK ((status = 'prospect' OR status LIKE 'prospect\_%') AND (SELECT public.auth_user_has_permission('MANAGE_LEADS')));

DROP POLICY IF EXISTS "Leads import unassigned" ON public.clients;
CREATE POLICY "Leads import unassigned"
ON public.clients
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (created_by IS NULL AND (status = 'prospect' OR status LIKE 'prospect\_%') AND (SELECT public.auth_user_has_permission('IMPORT_CLIENTS')));

DROP POLICY IF EXISTS "woo_catalog_snapshot_select" ON public.woo_catalog_snapshot;
CREATE POLICY "woo_catalog_snapshot_select"
ON public.woo_catalog_snapshot
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')) OR (SELECT public.auth_user_has_permission('MANAGE_WEB_STORE')));

DROP POLICY IF EXISTS "woo_stock_links_select" ON public.woo_stock_links;
CREATE POLICY "woo_stock_links_select"
ON public.woo_stock_links
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')) OR (SELECT public.auth_user_has_permission('MANAGE_WEB_STORE')));

DROP POLICY IF EXISTS "woo_stock_sync_queue_select" ON public.woo_stock_sync_queue;
CREATE POLICY "woo_stock_sync_queue_select"
ON public.woo_stock_sync_queue
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')) OR (SELECT public.auth_user_has_permission('MANAGE_WEB_STORE')));

CREATE OR REPLACE FUNCTION public.enforce_client_reassignment_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
BEGIN
  -- Service role / backend jobs can bypass this trigger.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    -- Quien gestiona leads puede asignar prospectos a un vendedor, pero no mover clientes.
    IF NOT (
      public.auth_user_has_permission('ASSIGN_CLIENTS')
      OR (
        public.auth_user_has_permission('MANAGE_LEADS')
        AND (OLD.status = 'prospect' OR OLD.status LIKE 'prospect\_%')
      )
    ) THEN
      RAISE EXCEPTION 'No tienes permiso para reasignar clientes.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_role_permissions(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        WHERE role NOT IN ('admin', 'jefe', 'bodega', 'facturador', 'tesorero', 'seller', 'driver', 'marketing')
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
$function$
;

CREATE OR REPLACE FUNCTION public.woo_stock_match_review(p_status text DEFAULT 'match'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(sku text, match_status text, crm_name text, crm_stock integer, crm_skip_reason text, woo_product_id bigint, woo_parent_id bigint, woo_name text, woo_type text, woo_product_status text, woo_stock integer, woo_manage_stock boolean, woo_count integer, approved_at timestamp with time zone, sync_status text, last_synced_at timestamp with time zone, last_error text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
    v_search TEXT := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
    IF NOT (public.auth_user_has_permission('MANAGE_INVENTORY') OR public.auth_user_has_permission('MANAGE_WEB_STORE')) THEN
        RAISE EXCEPTION 'No tienes permisos para revisar la tienda web.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT r.*, count(*) OVER () AS total_count
    FROM public.woo_stock_match_rows() r
    WHERE (p_status IS NULL OR p_status = 'all' OR r.match_status = p_status)
      AND (
          v_search IS NULL
          OR r.sku ILIKE '%' || v_search || '%'
          OR r.crm_name ILIKE '%' || v_search || '%'
          OR r.woo_name ILIKE '%' || v_search || '%'
      )
    ORDER BY r.sku
    LIMIT greatest(1, least(coalesce(p_limit, 50), 500))
    OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.woo_stock_match_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.auth_user_has_permission('MANAGE_INVENTORY') OR public.auth_user_has_permission('MANAGE_WEB_STORE')) THEN
        RAISE EXCEPTION 'No tienes permisos para revisar la tienda web.' USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT coalesce(jsonb_object_agg(match_status, total), '{}'::jsonb)
        FROM (
            SELECT r.match_status, count(*) AS total
            FROM public.woo_stock_match_rows() r
            GROUP BY r.match_status
        ) counts
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.woo_stock_sync_health()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'enabled', public.woo_stock_sync_enabled(),
        'pg_net', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
        'credentials', (
            SELECT coalesce(jsonb_object_agg(esperado.key, c.key IS NOT NULL), '{}'::jsonb)
            FROM (VALUES ('store_url'), ('consumer_key'), ('consumer_secret'), ('function_url'), ('dispatch_secret')) AS esperado(key)
            LEFT JOIN public.woo_stock_credentials c ON c.key = esperado.key
        ),
        'store_url', (SELECT value FROM public.woo_stock_credentials WHERE key = 'store_url'),
        'connection', (
            SELECT jsonb_build_object(
                'ok', s.verified_ok,
                'verified_at', s.verified_at,
                'store_url', s.store_url,
                'store_name', s.store_name,
                'products_count', s.products_count,
                'consumer_key_suffix', s.consumer_key_suffix,
                'error', s.last_error
            )
            FROM public.woo_stock_connection_status s
        ),
        'last_scan_at', (SELECT max(scanned_at) FROM public.woo_catalog_snapshot),
        'catalog_size', (SELECT count(*) FROM public.woo_catalog_snapshot),
        'approved', (SELECT count(*) FROM public.woo_stock_links),
        'synced', (SELECT count(*) FROM public.woo_stock_sync_queue WHERE status = 'synced'),
        'pending', (SELECT count(*) FROM public.woo_stock_sync_queue WHERE status IN ('pending', 'processing')),
        'failed', (SELECT count(*) FROM public.woo_stock_sync_queue WHERE status = 'failed'),
        'last_synced_at', (SELECT max(last_synced_at) FROM public.woo_stock_sync_queue),
        'recent_errors', (
            SELECT coalesce(jsonb_agg(jsonb_build_object('sku', e.sku, 'error', e.last_error, 'attempts', e.attempts)), '[]'::jsonb)
            FROM (
                SELECT sku, last_error, attempts
                FROM public.woo_stock_sync_queue
                WHERE status = 'failed'
                ORDER BY queued_at DESC
                LIMIT 10
            ) e
        )
    )
    WHERE (public.auth_user_has_permission('MANAGE_INVENTORY') OR public.auth_user_has_permission('MANAGE_WEB_STORE'))
$function$
;

NOTIFY pgrst, 'reload schema';
