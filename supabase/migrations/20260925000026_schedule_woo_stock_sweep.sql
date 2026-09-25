-- Barrido periódico de la cola de stock hacia la tienda WooCommerce.
--
-- El aviso inmediato solo sale cuando cambia el stock. Un envío que falló
-- porque la tienda no respondía quedaba esperando hasta el próximo cambio de
-- cualquier SKU o hasta que alguien presionara "Enviar pendientes". Este
-- barrido revisa la cola cada diez minutos y, si hay algo listo para
-- enviarse, avisa a la Edge Function.
--
-- El barrido no llama a nadie si el envío está apagado o si no hay nada que
-- hacer, así que en la instancia sin tienda no tiene ningún efecto.

-- ---------------------------------------------------------------------------
-- 1. Una sola definición de "listo para enviarse"
-- ---------------------------------------------------------------------------

-- La usan la toma de lotes y el barrido. Si cada una tuviera su propia
-- regla, el barrido podría avisar por filas que la toma después no acepta, o
-- al revés, dejar sin aviso filas que sí están listas.
--   - pendiente: siempre.
--   - fallida: tras una espera que crece con los intentos (5, 10, 15... hasta
--     60 minutos), y solo hasta diez intentos.
--   - en proceso por más de diez minutos: la ejecución que la tomó murió.
CREATE OR REPLACE FUNCTION public.woo_stock_queue_row_due(
    p_status TEXT,
    p_attempts INTEGER,
    p_queued_at TIMESTAMPTZ,
    p_claimed_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_status = 'pending' THEN true
        WHEN p_status = 'failed' THEN p_attempts < 10
            AND p_queued_at < timezone('utc', now()) - make_interval(mins => least(p_attempts * 5, 60))
        WHEN p_status = 'processing' THEN p_claimed_at < timezone('utc', now()) - interval '10 minutes'
        ELSE false
    END
$$;

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
        WHERE public.woo_stock_queue_row_due(q.status, q.attempts, q.queued_at, q.claimed_at)
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

-- ---------------------------------------------------------------------------
-- 2. El aviso ahora cubre también los reintentos
-- ---------------------------------------------------------------------------

-- Antes solo avisaba si había pendientes nuevos; ahora avisa si hay cualquier
-- fila lista, que es lo que necesita el barrido. Para el trigger no cambia
-- nada: un cambio de stock siempre deja una fila pendiente.
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

    IF NOT EXISTS (
        SELECT 1 FROM public.woo_stock_sync_queue q
        WHERE public.woo_stock_queue_row_due(q.status, q.attempts, q.queued_at, q.claimed_at)
    ) THEN
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
              jsonb_build_object('origen', 'aviso'),
              jsonb_build_object('content-type', 'application/json', 'x-dispatch-secret', v_secret);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'woo-stock-sync: no se pudo avisar a la función: %', SQLERRM;
    END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Programación con pg_cron
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron no disponible (%); los reintentos quedan a cargo del botón "Enviar pendientes".', SQLERRM;
END;
$$;

-- Se desprograma antes de programar para que volver a correr la migración no
-- deje dos tareas con el mismo trabajo.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'woo-stock-sweep';
        PERFORM cron.schedule('woo-stock-sweep', '*/10 * * * *', 'SELECT public.request_woo_stock_dispatch()');
    END IF;
END;
$$;

-- Para la pantalla. Dinámico porque el esquema cron no existe si pg_cron no
-- se pudo instalar, y una referencia directa impediría crear la función.
CREATE OR REPLACE FUNCTION public.woo_stock_sweep_scheduled()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_active BOOLEAN := false;
BEGIN
    IF to_regclass('cron.job') IS NULL THEN
        RETURN false;
    END IF;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = $1 AND active)'
    INTO v_active
    USING 'woo-stock-sweep';
    RETURN coalesce(v_active, false);
END;
$$;

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
        'sweep_scheduled', public.woo_stock_sweep_scheduled(),
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
        -- Fallos que agotaron los diez intentos: el barrido ya no los toma y
        -- necesitan que alguien revise el error.
        'exhausted', (SELECT count(*) FROM public.woo_stock_sync_queue WHERE status = 'failed' AND attempts >= 10),
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

REVOKE ALL ON FUNCTION public.woo_stock_queue_row_due(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.woo_stock_sweep_scheduled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.woo_stock_sweep_scheduled() TO authenticated;
