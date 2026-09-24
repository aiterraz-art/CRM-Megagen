-- Estado de la conexión con la tienda WooCommerce.
--
-- La prueba de conexión solo quedaba en la pantalla y se perdía al recargar,
-- así que no había forma de saber a qué tienda y con qué clave estaba
-- conectado el CRM. Aquí se guarda el resultado de la última verificación
-- (prueba o escaneo). Cambiar la URL o las claves la invalida, porque lo
-- verificado ya no es lo que está configurado.

CREATE TABLE IF NOT EXISTS public.woo_stock_connection_status (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    verified_ok BOOLEAN NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    store_url TEXT,
    store_name TEXT,
    products_count INTEGER,
    consumer_key_suffix TEXT,
    last_error TEXT
);

ALTER TABLE public.woo_stock_connection_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.woo_stock_connection_status FROM anon, authenticated;

-- Solo la Edge Function registra verificaciones: es la única que habla con
-- la tienda. La clave nunca se guarda completa, solo sus últimos caracteres
-- para reconocer cuál está activa.
CREATE OR REPLACE FUNCTION public.record_woo_connection_status(
    p_ok BOOLEAN,
    p_store_name TEXT DEFAULT NULL,
    p_products_count INTEGER DEFAULT NULL,
    p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.woo_stock_connection_status (
        id, verified_ok, verified_at, store_url, store_name,
        products_count, consumer_key_suffix, last_error
    )
    SELECT
        true,
        p_ok,
        timezone('utc', now()),
        (SELECT value FROM public.woo_stock_credentials WHERE key = 'store_url'),
        p_store_name,
        p_products_count,
        (SELECT right(value, 4) FROM public.woo_stock_credentials WHERE key = 'consumer_key'),
        CASE WHEN p_ok THEN NULL ELSE left(p_error, 1000) END
    ON CONFLICT (id) DO UPDATE
    SET verified_ok = excluded.verified_ok,
        verified_at = excluded.verified_at,
        store_url = excluded.store_url,
        -- Un fallo no borra el nombre ni el conteo de la última conexión buena.
        store_name = coalesce(excluded.store_name, public.woo_stock_connection_status.store_name),
        products_count = coalesce(excluded.products_count, public.woo_stock_connection_status.products_count),
        consumer_key_suffix = excluded.consumer_key_suffix,
        last_error = excluded.last_error;
$$;

REVOKE ALL ON FUNCTION public.record_woo_connection_status(BOOLEAN, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_woo_connection_status(BOOLEAN, TEXT, INTEGER, TEXT) TO service_role;

-- Cambiar la URL o una clave deja la conexión sin verificar.
CREATE OR REPLACE FUNCTION public.set_woo_stock_credential(p_key TEXT, p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_was_enabled BOOLEAN;
    v_previous TEXT;
BEGIN
    PERFORM public.assert_woo_stock_admin();

    v_was_enabled := public.woo_stock_sync_enabled();
    SELECT value INTO v_previous FROM public.woo_stock_credentials WHERE key = p_key;

    IF p_key IN ('store_url', 'consumer_key', 'consumer_secret')
       AND v_previous IS DISTINCT FROM nullif(btrim(coalesce(p_value, '')), '') THEN
        DELETE FROM public.woo_stock_connection_status;
    END IF;

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
    WHERE public.auth_user_has_permission('MANAGE_INVENTORY')
$$;
