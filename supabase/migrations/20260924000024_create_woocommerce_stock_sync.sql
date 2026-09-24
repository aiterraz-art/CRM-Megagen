-- Sincronización de stock del CRM hacia la tienda WooCommerce.
--
-- El CRM es la fuente de verdad del stock: la tienda solo recibe. Pero nada
-- viaja a la tienda sin que una persona lo apruebe antes. El flujo es:
--
--   1. Escaneo: la Edge Function lee el catálogo completo de la tienda y lo
--      deja en woo_catalog_snapshot. Leer no modifica nada en la web.
--   2. Revisión: woo_stock_match_review cruza ese catálogo con el inventario
--      por SKU normalizado y muestra qué coincide, qué falta de cada lado y
--      qué está duplicado.
--   3. Aprobación: un administrador aprueba SKU uno a uno o en bloque. Cada
--      aprobación queda en woo_stock_links con quién y cuándo.
--   4. Envío: solo los SKU aprobados entran a la cola. El trigger sobre
--      public.inventory los vuelve a encolar cada vez que cambia su stock.
--
-- La cola tiene una fila por SKU, no una por cambio: si un SKU cambia cinco
-- veces antes de enviarse, a la tienda solo le interesa el valor final, y la
-- función siempre lee el stock vigente al enviarlo.

-- ---------------------------------------------------------------------------
-- 1. Credenciales y configuración
-- ---------------------------------------------------------------------------

-- Mismo criterio que meta_lead_credentials: viven en la base para poder
-- cambiarlas desde el CRM sin reiniciar el contenedor, solo el service_role
-- las lee y un administrador solo puede escribirlas y ver si están puestas.
CREATE TABLE IF NOT EXISTS public.woo_stock_credentials (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT woo_stock_credentials_key_check
        CHECK (key IN ('store_url', 'consumer_key', 'consumer_secret', 'function_url', 'dispatch_secret', 'enabled'))
);

ALTER TABLE public.woo_stock_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.woo_stock_credentials FROM anon, authenticated;

-- Interruptor general del envío. Apagado, la revisión y las aprobaciones
-- siguen funcionando, pero la tienda no recibe nada.
CREATE OR REPLACE FUNCTION public.woo_stock_sync_enabled()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.woo_stock_credentials
        WHERE key = 'enabled' AND value = 'true'
    )
$$;

CREATE OR REPLACE FUNCTION public.get_woo_stock_credentials()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM public.woo_stock_credentials
$$;

CREATE OR REPLACE FUNCTION public.assert_woo_stock_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT lower(coalesce(role, '')) INTO v_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF coalesce(v_role, '') <> 'admin' THEN
        RAISE EXCEPTION 'Solo un administrador puede administrar la tienda web.'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Catálogo de la tienda (solo lectura)
-- ---------------------------------------------------------------------------

-- Foto del catálogo de la tienda en el último escaneo. Incluye productos
-- simples, variables y cada variación, porque el stock de un producto con
-- tallas o medidas vive en la variación y no en el padre.
CREATE TABLE IF NOT EXISTS public.woo_catalog_snapshot (
    woo_id BIGINT PRIMARY KEY,
    parent_id BIGINT,
    sku TEXT,
    normalized_sku TEXT NOT NULL DEFAULT '',
    name TEXT,
    product_type TEXT,
    product_status TEXT,
    manage_stock BOOLEAN,
    stock_quantity INTEGER,
    scan_id UUID NOT NULL,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_woo_catalog_snapshot_sku
    ON public.woo_catalog_snapshot (normalized_sku)
    WHERE normalized_sku <> '';

ALTER TABLE public.woo_catalog_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS woo_catalog_snapshot_select ON public.woo_catalog_snapshot;
CREATE POLICY woo_catalog_snapshot_select ON public.woo_catalog_snapshot
    FOR SELECT TO authenticated
    USING (public.auth_user_has_permission('MANAGE_INVENTORY'));

REVOKE ALL ON public.woo_catalog_snapshot FROM anon, authenticated;
GRANT SELECT ON public.woo_catalog_snapshot TO authenticated;

-- El escaneo llega por partes (la tienda pagina de a 100). Cada parte se
-- guarda con el identificador del escaneo y, al terminar, se borra lo que
-- quedó de escaneos anteriores. Si el escaneo se corta a medias, la foto
-- previa sigue completa.
CREATE OR REPLACE FUNCTION public.stage_woo_catalog_snapshot(p_scan_id UUID, p_items JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.woo_catalog_snapshot (
        woo_id, parent_id, sku, normalized_sku, name, product_type,
        product_status, manage_stock, stock_quantity, scan_id, scanned_at
    )
    SELECT
        item.woo_id,
        nullif(item.parent_id, 0),
        nullif(btrim(coalesce(item.sku, '')), ''),
        public.normalize_inventory_sku(item.sku),
        item.name,
        item.product_type,
        item.product_status,
        item.manage_stock,
        item.stock_quantity,
        p_scan_id,
        timezone('utc', now())
    FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS item(
        woo_id BIGINT,
        parent_id BIGINT,
        sku TEXT,
        name TEXT,
        product_type TEXT,
        product_status TEXT,
        manage_stock BOOLEAN,
        stock_quantity INTEGER
    )
    WHERE item.woo_id IS NOT NULL
    ON CONFLICT (woo_id) DO UPDATE
    SET parent_id = excluded.parent_id,
        sku = excluded.sku,
        normalized_sku = excluded.normalized_sku,
        name = excluded.name,
        product_type = excluded.product_type,
        product_status = excluded.product_status,
        manage_stock = excluded.manage_stock,
        stock_quantity = excluded.stock_quantity,
        scan_id = excluded.scan_id,
        scanned_at = excluded.scanned_at;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_woo_catalog_snapshot(p_scan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_removed INTEGER;
    v_total INTEGER;
BEGIN
    DELETE FROM public.woo_catalog_snapshot WHERE scan_id <> p_scan_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    SELECT count(*) INTO v_total FROM public.woo_catalog_snapshot;

    RETURN jsonb_build_object('productos', v_total, 'eliminados', v_removed);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Vínculos aprobados
-- ---------------------------------------------------------------------------

-- Un SKU del CRM solo envía stock a la tienda si está aquí. El producto de
-- destino se fija al aprobar, así lo que se envía es exactamente lo que la
-- persona revisó aunque después cambie algo en la tienda.
CREATE TABLE IF NOT EXISTS public.woo_stock_links (
    sku TEXT PRIMARY KEY,
    woo_product_id BIGINT NOT NULL,
    woo_parent_id BIGINT,
    woo_name TEXT,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.woo_stock_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS woo_stock_links_select ON public.woo_stock_links;
CREATE POLICY woo_stock_links_select ON public.woo_stock_links
    FOR SELECT TO authenticated
    USING (public.auth_user_has_permission('MANAGE_INVENTORY'));

REVOKE ALL ON public.woo_stock_links FROM anon, authenticated;
GRANT SELECT ON public.woo_stock_links TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Cola por SKU
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.woo_stock_sync_queue (
    sku TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    queued_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    claimed_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    last_synced_qty INTEGER,
    CONSTRAINT woo_stock_sync_queue_status_check
        CHECK (status IN ('pending', 'processing', 'synced', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_woo_stock_sync_queue_pending
    ON public.woo_stock_sync_queue (queued_at)
    WHERE status IN ('pending', 'failed', 'processing');

ALTER TABLE public.woo_stock_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS woo_stock_sync_queue_select ON public.woo_stock_sync_queue;
CREATE POLICY woo_stock_sync_queue_select ON public.woo_stock_sync_queue
    FOR SELECT TO authenticated
    USING (public.auth_user_has_permission('MANAGE_INVENTORY'));

REVOKE ALL ON public.woo_stock_sync_queue FROM anon, authenticated;
GRANT SELECT ON public.woo_stock_sync_queue TO authenticated;

-- Encola solo si el SKU está aprobado. Un cambio nuevo de stock merece una
-- oportunidad nueva aunque el envío anterior haya fallado, por eso se
-- reinician los intentos.
CREATE OR REPLACE FUNCTION public.enqueue_woo_stock_sku(p_sku TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.woo_stock_sync_queue (sku, status, queued_at, attempts, last_error)
    SELECT l.sku, 'pending', timezone('utc', now()), 0, NULL
    FROM public.woo_stock_links l
    WHERE l.sku = public.normalize_inventory_sku(p_sku)
    ON CONFLICT (sku) DO UPDATE
    SET status = 'pending',
        queued_at = excluded.queued_at,
        attempts = 0,
        last_error = NULL;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_all_linked_woo_stock()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.woo_stock_sync_queue (sku, status, queued_at, attempts, last_error)
    SELECT l.sku, 'pending', timezone('utc', now()), 0, NULL
    FROM public.woo_stock_links l
    ON CONFLICT (sku) DO UPDATE
    SET status = 'pending',
        queued_at = excluded.queued_at,
        attempts = 0,
        last_error = NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Configuración desde la pantalla
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_woo_stock_credential(p_key TEXT, p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_was_enabled BOOLEAN;
BEGIN
    PERFORM public.assert_woo_stock_admin();

    v_was_enabled := public.woo_stock_sync_enabled();

    IF nullif(btrim(coalesce(p_value, '')), '') IS NULL THEN
        DELETE FROM public.woo_stock_credentials WHERE key = p_key;
        RETURN jsonb_build_object('key', p_key, 'configurado', false);
    END IF;

    INSERT INTO public.woo_stock_credentials (key, value, updated_by)
    VALUES (p_key, btrim(p_value), auth.uid())
    ON CONFLICT (key) DO UPDATE
    SET value = excluded.value,
        updated_at = timezone('utc', now()),
        updated_by = excluded.updated_by;

    -- Al reactivar el envío se ponen al día solo los SKU ya aprobados: el
    -- stock pudo cambiar mientras estuvo apagado. Nada sin aprobar viaja.
    IF p_key = 'enabled' AND btrim(p_value) = 'true' AND NOT v_was_enabled THEN
        PERFORM public.enqueue_all_linked_woo_stock();
    END IF;

    RETURN jsonb_build_object('key', p_key, 'configurado', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Revisión del cruce CRM ↔ tienda
-- ---------------------------------------------------------------------------

-- Estados posibles de cada SKU:
--   match            coincide 1 a 1 y está listo para aprobar
--   approved         ya aprobado; se le envía stock
--   broken           aprobado, pero el producto ya no aparece en la tienda
--   duplicate        el SKU está en más de un producto de la tienda
--   no_stock_control en el CRM es servicio o se vende sin stock (cursos)
--   crm_only         existe en el CRM pero no en la tienda
--   woo_only         existe en la tienda pero no en el CRM
CREATE OR REPLACE FUNCTION public.woo_stock_match_rows()
RETURNS TABLE (
    sku TEXT,
    match_status TEXT,
    crm_name TEXT,
    crm_stock INTEGER,
    crm_skip_reason TEXT,
    woo_product_id BIGINT,
    woo_parent_id BIGINT,
    woo_name TEXT,
    woo_type TEXT,
    woo_product_status TEXT,
    woo_stock INTEGER,
    woo_manage_stock BOOLEAN,
    woo_count INTEGER,
    approved_at TIMESTAMPTZ,
    sync_status TEXT,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH crm AS (
        -- Fila canónica del SKU, con el mismo orden que usa la importación
        -- masiva cuando hay filas duplicadas.
        SELECT DISTINCT ON (public.normalize_inventory_sku(i.sku))
            public.normalize_inventory_sku(i.sku) AS sku,
            i.name,
            greatest(coalesce(i.stock_qty, 0), 0)::INTEGER AS stock,
            CASE
                WHEN coalesce(i.is_service_item, false) THEN 'servicio'
                WHEN coalesce(i.allow_sale_without_stock, false) THEN 'venta sin stock'
                ELSE NULL
            END AS skip_reason
        FROM public.inventory i
        WHERE public.normalize_inventory_sku(i.sku) <> ''
        ORDER BY
            public.normalize_inventory_sku(i.sku),
            CASE WHEN i.sku LIKE '''%' THEN 0 ELSE 1 END,
            CASE WHEN i.supplier_id IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN coalesce(i.price, 0) > 0 THEN 0 ELSE 1 END,
            i.created_at ASC,
            i.id ASC
    ),
    woo AS (
        SELECT DISTINCT ON (s.normalized_sku)
            s.normalized_sku AS sku,
            s.woo_id,
            s.parent_id,
            s.name,
            s.product_type,
            s.product_status,
            s.stock_quantity,
            s.manage_stock,
            count(*) OVER (PARTITION BY s.normalized_sku)::INTEGER AS woo_count
        FROM public.woo_catalog_snapshot s
        WHERE s.normalized_sku <> ''
        ORDER BY s.normalized_sku, s.woo_id
    ),
    keys AS (
        SELECT crm.sku FROM crm
        UNION
        SELECT woo.sku FROM woo
        UNION
        SELECT l.sku FROM public.woo_stock_links l
    )
    SELECT
        k.sku,
        CASE
            WHEN l.sku IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM public.woo_catalog_snapshot s WHERE s.woo_id = l.woo_product_id
            ) THEN 'broken'
            WHEN l.sku IS NOT NULL THEN 'approved'
            WHEN crm.sku IS NOT NULL AND woo.sku IS NOT NULL AND woo.woo_count > 1 THEN 'duplicate'
            WHEN crm.sku IS NOT NULL AND woo.sku IS NOT NULL AND crm.skip_reason IS NOT NULL THEN 'no_stock_control'
            WHEN crm.sku IS NOT NULL AND woo.sku IS NOT NULL THEN 'match'
            WHEN crm.sku IS NOT NULL THEN 'crm_only'
            ELSE 'woo_only'
        END,
        crm.name,
        crm.stock,
        crm.skip_reason,
        coalesce(l.woo_product_id, woo.woo_id),
        CASE WHEN l.sku IS NOT NULL THEN l.woo_parent_id ELSE woo.parent_id END,
        coalesce(woo.name, l.woo_name),
        woo.product_type,
        woo.product_status,
        woo.stock_quantity,
        woo.manage_stock,
        coalesce(woo.woo_count, 0),
        l.approved_at,
        q.status,
        q.last_synced_at,
        q.last_error
    FROM keys k
    LEFT JOIN crm ON crm.sku = k.sku
    LEFT JOIN woo ON woo.sku = k.sku
    LEFT JOIN public.woo_stock_links l ON l.sku = k.sku
    LEFT JOIN public.woo_stock_sync_queue q ON q.sku = k.sku
$$;

CREATE OR REPLACE FUNCTION public.woo_stock_match_review(
    p_status TEXT DEFAULT 'match',
    p_search TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    sku TEXT,
    match_status TEXT,
    crm_name TEXT,
    crm_stock INTEGER,
    crm_skip_reason TEXT,
    woo_product_id BIGINT,
    woo_parent_id BIGINT,
    woo_name TEXT,
    woo_type TEXT,
    woo_product_status TEXT,
    woo_stock INTEGER,
    woo_manage_stock BOOLEAN,
    woo_count INTEGER,
    approved_at TIMESTAMPTZ,
    sync_status TEXT,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_search TEXT := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
    IF NOT public.auth_user_has_permission('MANAGE_INVENTORY') THEN
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
$$;

CREATE OR REPLACE FUNCTION public.woo_stock_match_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.auth_user_has_permission('MANAGE_INVENTORY') THEN
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
$$;

-- ---------------------------------------------------------------------------
-- 7. Aprobar y quitar aprobaciones
-- ---------------------------------------------------------------------------

-- Aprueba los SKU indicados, o todos los que están en estado "match" si
-- p_all es verdadero. Solo se aprueba lo que coincide 1 a 1 en el último
-- escaneo: un SKU duplicado, inexistente en la tienda o sin control de stock
-- se rechaza aunque venga en la lista. Lo aprobado se encola para su primer
-- envío, que ocurre solo si el interruptor general está encendido.
CREATE OR REPLACE FUNCTION public.approve_woo_stock_links(p_skus TEXT[] DEFAULT NULL, p_all BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requested INTEGER;
    v_approved INTEGER;
BEGIN
    PERFORM public.assert_woo_stock_admin();

    IF NOT coalesce(p_all, false) AND coalesce(cardinality(p_skus), 0) = 0 THEN
        RAISE EXCEPTION 'No se indicó ningún SKU para aprobar.';
    END IF;

    CREATE TEMP TABLE tmp_woo_approve ON COMMIT DROP AS
    SELECT r.sku, r.woo_product_id, r.woo_parent_id, r.woo_name
    FROM public.woo_stock_match_rows() r
    WHERE r.match_status = 'match'
      AND (
          coalesce(p_all, false)
          OR r.sku IN (SELECT public.normalize_inventory_sku(x) FROM unnest(p_skus) AS x)
      );

    v_requested := CASE WHEN coalesce(p_all, false) THEN NULL ELSE cardinality(p_skus) END;

    INSERT INTO public.woo_stock_links (sku, woo_product_id, woo_parent_id, woo_name, approved_by)
    SELECT sku, woo_product_id, woo_parent_id, woo_name, auth.uid()
    FROM tmp_woo_approve
    ON CONFLICT (sku) DO NOTHING;

    GET DIAGNOSTICS v_approved = ROW_COUNT;

    INSERT INTO public.woo_stock_sync_queue (sku, status, queued_at, attempts, last_error)
    SELECT sku, 'pending', timezone('utc', now()), 0, NULL
    FROM tmp_woo_approve
    ON CONFLICT (sku) DO UPDATE
    SET status = 'pending',
        queued_at = excluded.queued_at,
        attempts = 0,
        last_error = NULL;

    RETURN jsonb_build_object(
        'aprobados', v_approved,
        'rechazados', CASE WHEN v_requested IS NULL THEN 0 ELSE greatest(v_requested - v_approved, 0) END
    );
END;
$$;

-- Quitar la aprobación detiene los envíos de ese SKU. No toca el stock que
-- la tienda ya tenga: el producto queda como estaba.
CREATE OR REPLACE FUNCTION public.revoke_woo_stock_links(p_skus TEXT[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_removed INTEGER;
BEGIN
    PERFORM public.assert_woo_stock_admin();

    DELETE FROM public.woo_stock_links
    WHERE sku IN (SELECT public.normalize_inventory_sku(x) FROM unnest(coalesce(p_skus, ARRAY[]::TEXT[])) AS x);

    GET DIAGNOSTICS v_removed = ROW_COUNT;

    DELETE FROM public.woo_stock_sync_queue
    WHERE sku IN (SELECT public.normalize_inventory_sku(x) FROM unnest(coalesce(p_skus, ARRAY[]::TEXT[])) AS x);

    RETURN jsonb_build_object('quitados', v_removed);
END;
$$;

-- Botón "reenviar todo": vuelve a mandar el stock de todos los aprobados.
CREATE OR REPLACE FUNCTION public.enqueue_all_woo_stock_sync()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.assert_woo_stock_admin();

    IF NOT public.woo_stock_sync_enabled() THEN
        RAISE EXCEPTION 'El envío a la tienda web está apagado.';
    END IF;

    RETURN jsonb_build_object('encolados', public.enqueue_all_linked_woo_stock());
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Trigger sobre el inventario
-- ---------------------------------------------------------------------------

-- La importación masiva reescribe todas las filas aunque el stock no cambie,
-- por eso en UPDATE solo se encola si cambió algo que afecta lo que se envía.
-- enqueue_woo_stock_sku descarta por sí solo los SKU no aprobados.
CREATE OR REPLACE FUNCTION public.enqueue_woo_stock_sync_from_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.woo_stock_sync_enabled() THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'INSERT' THEN
        PERFORM public.enqueue_woo_stock_sku(NEW.sku);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM public.enqueue_woo_stock_sku(OLD.sku);
    ELSIF NEW.stock_qty IS DISTINCT FROM OLD.stock_qty
       OR NEW.allow_sale_without_stock IS DISTINCT FROM OLD.allow_sale_without_stock
       OR NEW.is_service_item IS DISTINCT FROM OLD.is_service_item
       OR public.normalize_inventory_sku(NEW.sku) IS DISTINCT FROM public.normalize_inventory_sku(OLD.sku) THEN
        PERFORM public.enqueue_woo_stock_sku(NEW.sku);
        -- Si cambió el SKU, el vínculo viejo recibe el stock que le quede
        -- (cero si ya no hay filas con ese SKU).
        IF public.normalize_inventory_sku(NEW.sku) IS DISTINCT FROM public.normalize_inventory_sku(OLD.sku) THEN
            PERFORM public.enqueue_woo_stock_sku(OLD.sku);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_woo_stock_sync_from_inventory ON public.inventory;
CREATE TRIGGER enqueue_woo_stock_sync_from_inventory
AFTER INSERT OR DELETE OR UPDATE OF stock_qty, sku, allow_sale_without_stock, is_service_item
ON public.inventory
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_woo_stock_sync_from_inventory();

-- Aviso inmediato a la Edge Function, una vez por sentencia y no por fila:
-- una importación de miles de SKU dispara un solo llamado. pg_net encola la
-- petición dentro de la transacción y la envía recién al confirmarse, así que
-- la función nunca lee una cola que después se revierte.
--
-- Si pg_net no está instalado o falta la URL, no se hace nada: los SKU quedan
-- en la cola y los recoge el barrido periódico o el botón de la pantalla. Un
-- fallo aquí nunca debe impedir que se guarde un pedido o una importación.
CREATE OR REPLACE FUNCTION public.request_woo_stock_dispatch()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_url TEXT;
    v_secret TEXT;
BEGIN
    IF NOT public.woo_stock_sync_enabled() THEN
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.woo_stock_sync_queue WHERE status = 'pending') THEN
        RETURN;
    END IF;

    SELECT value INTO v_url FROM public.woo_stock_credentials WHERE key = 'function_url';
    SELECT value INTO v_secret FROM public.woo_stock_credentials WHERE key = 'dispatch_secret';

    IF v_url IS NULL OR v_secret IS NULL THEN
        RETURN;
    END IF;

    BEGIN
        -- EXECUTE dinámico para que la función compile aunque pg_net no exista.
        EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
        USING v_url || '?task=run',
              jsonb_build_object('origen', 'trigger'),
              jsonb_build_object('content-type', 'application/json', 'x-dispatch-secret', v_secret);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'woo-stock-sync: no se pudo avisar a la función: %', SQLERRM;
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_woo_stock_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.request_woo_stock_dispatch();
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notify_woo_stock_sync ON public.inventory;
CREATE TRIGGER notify_woo_stock_sync
AFTER INSERT OR DELETE OR UPDATE OF stock_qty, sku, allow_sale_without_stock, is_service_item
ON public.inventory
FOR EACH STATEMENT
EXECUTE FUNCTION public.notify_woo_stock_sync();

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_net no disponible (%); la tienda se actualizará por barrido periódico.', SQLERRM;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Trabajo de la Edge Function
-- ---------------------------------------------------------------------------

-- Toma un lote y lo marca como en proceso. SKIP LOCKED evita que dos
-- ejecuciones simultáneas (el aviso del trigger y el barrido) envíen el mismo
-- SKU. Un lote que quedó "en proceso" más de diez minutos se da por
-- abandonado. El destino sale del vínculo aprobado; un SKU que ya no existe
-- en el inventario se envía como cero.
CREATE OR REPLACE FUNCTION public.claim_woo_stock_sync_batch(p_limit INTEGER DEFAULT 100)
RETURNS TABLE (
    sku TEXT,
    stock_qty INTEGER,
    skip_reason TEXT,
    woo_product_id BIGINT,
    woo_parent_id BIGINT,
    attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT q.sku
        FROM public.woo_stock_sync_queue q
        WHERE q.status = 'pending'
           OR (q.status = 'failed' AND q.attempts < 10
               AND q.queued_at < timezone('utc', now()) - make_interval(mins => least(q.attempts * 5, 60)))
           OR (q.status = 'processing' AND q.claimed_at < timezone('utc', now()) - interval '10 minutes')
        ORDER BY q.queued_at
        LIMIT greatest(1, least(coalesce(p_limit, 100), 500))
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.woo_stock_sync_queue q
        SET status = 'processing',
            claimed_at = timezone('utc', now())
        FROM candidates c
        WHERE q.sku = c.sku
        RETURNING q.sku, q.attempts
    ),
    canonical AS (
        SELECT DISTINCT ON (public.normalize_inventory_sku(i.sku))
            public.normalize_inventory_sku(i.sku) AS normalized_sku,
            i.stock_qty,
            i.is_service_item,
            i.allow_sale_without_stock
        FROM public.inventory i
        WHERE public.normalize_inventory_sku(i.sku) IN (SELECT claimed.sku FROM claimed)
        ORDER BY
            public.normalize_inventory_sku(i.sku),
            CASE WHEN i.sku LIKE '''%' THEN 0 ELSE 1 END,
            CASE WHEN i.supplier_id IS NOT NULL THEN 0 ELSE 1 END,
            CASE WHEN coalesce(i.price, 0) > 0 THEN 0 ELSE 1 END,
            i.created_at ASC,
            i.id ASC
    )
    SELECT
        cl.sku,
        greatest(coalesce(ca.stock_qty, 0), 0)::INTEGER,
        -- Servicios y productos que se venden sin stock (los cursos) tienen
        -- stock 0 a propósito: enviarlo los dejaría agotados en la tienda.
        CASE
            WHEN l.sku IS NULL THEN 'sin aprobación'
            WHEN coalesce(ca.is_service_item, false) THEN 'servicio'
            WHEN coalesce(ca.allow_sale_without_stock, false) THEN 'venta sin stock'
            ELSE NULL
        END,
        l.woo_product_id,
        l.woo_parent_id,
        cl.attempts
    FROM claimed cl
    LEFT JOIN public.woo_stock_links l ON l.sku = cl.sku
    LEFT JOIN canonical ca ON ca.normalized_sku = cl.sku;
END;
$$;

-- Resultado de un lote. Cada elemento trae sku y status (synced, failed,
-- skipped), y según el caso qty y error. Si el SKU volvió a cambiar mientras
-- se enviaba, el trigger lo dejó en pendiente otra vez y no se pisa.
CREATE OR REPLACE FUNCTION public.complete_woo_stock_sync_batch(p_results JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.woo_stock_sync_queue q
    SET status = r.status,
        attempts = CASE WHEN r.status = 'failed' THEN q.attempts + 1 ELSE 0 END,
        last_error = CASE WHEN r.status = 'synced' THEN NULL ELSE left(r.error, 2000) END,
        last_synced_at = CASE WHEN r.status = 'synced' THEN timezone('utc', now()) ELSE q.last_synced_at END,
        last_synced_qty = CASE WHEN r.status = 'synced' THEN r.qty ELSE q.last_synced_qty END,
        claimed_at = NULL
    FROM jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) AS r(
        sku TEXT,
        status TEXT,
        qty INTEGER,
        error TEXT
    )
    WHERE q.sku = r.sku
      AND q.status = 'processing'
      AND r.status IN ('synced', 'failed', 'skipped');

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Estado para la pantalla
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.woo_stock_sync_health()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'enabled', public.woo_stock_sync_enabled(),
        'pg_net', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net'),
        'credentials', (
            SELECT coalesce(jsonb_object_agg(esperado.key, c.key IS NOT NULL), '{}'::jsonb)
            FROM (VALUES ('store_url'), ('consumer_key'), ('consumer_secret'), ('function_url'), ('dispatch_secret')) AS esperado(key)
            LEFT JOIN public.woo_stock_credentials c ON c.key = esperado.key
        ),
        'store_url', (SELECT value FROM public.woo_stock_credentials WHERE key = 'store_url'),
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
    WHERE public.auth_user_has_permission('MANAGE_INVENTORY')
$$;

-- ---------------------------------------------------------------------------
-- 11. Permisos de ejecución
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_woo_stock_credentials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_woo_stock_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stage_woo_catalog_snapshot(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_woo_catalog_snapshot(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_woo_stock_sku(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_all_linked_woo_stock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.woo_stock_match_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_woo_stock_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_woo_stock_sync_batch(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_woo_stock_sync_batch(JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_woo_stock_credentials() TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_woo_catalog_snapshot(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_woo_catalog_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_woo_stock_sync_batch(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_woo_stock_sync_batch(JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION public.woo_stock_sync_enabled() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_woo_stock_credential(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.woo_stock_match_review(TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.woo_stock_match_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_woo_stock_links(TEXT[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_woo_stock_links(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_all_woo_stock_sync() TO authenticated;
GRANT EXECUTE ON FUNCTION public.woo_stock_sync_health() TO authenticated;
