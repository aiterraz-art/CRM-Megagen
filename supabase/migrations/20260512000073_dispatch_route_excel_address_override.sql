ALTER TABLE IF EXISTS public.dispatch_queue_items
    ADD COLUMN IF NOT EXISTS imported_address_input text;

ALTER TABLE IF EXISTS public.dispatch_queue_items
    ADD COLUMN IF NOT EXISTS address_source text NOT NULL DEFAULT 'client';

ALTER TABLE IF EXISTS public.dispatch_queue_items
    DROP CONSTRAINT IF EXISTS dispatch_queue_items_address_source_ck;
ALTER TABLE IF EXISTS public.dispatch_queue_items
    ADD CONSTRAINT dispatch_queue_items_address_source_ck
    CHECK (address_source IN ('client', 'excel'));

UPDATE public.dispatch_queue_items
SET address_source = CASE
    WHEN nullif(trim(coalesce(imported_address_input, '')), '') IS NOT NULL THEN 'excel'
    ELSE 'client'
END
WHERE address_source IS NULL
   OR address_source NOT IN ('client', 'excel');

DROP FUNCTION IF EXISTS public.import_dispatch_invoice_batch(jsonb, text);
CREATE OR REPLACE FUNCTION public.import_dispatch_invoice_batch(p_rows jsonb, p_file_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_batch_id uuid;
    v_error_payload jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'facturador', 'tesorero') THEN
        RAISE EXCEPTION 'No tienes permisos para importar despachos';
    END IF;

    IF jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'p_rows debe ser un arreglo JSON';
    END IF;

    CREATE TEMP TABLE tmp_dispatch_rows (
        row_number integer NOT NULL,
        invoice_number text NOT NULL,
        invoice_number_normalized text NOT NULL,
        client_rut_input text NOT NULL,
        client_rut_normalized text NOT NULL,
        order_folio_input text NOT NULL,
        order_folio_normalized text NOT NULL,
        delivery_address_input text NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_dispatch_rows (
        row_number,
        invoice_number,
        invoice_number_normalized,
        client_rut_input,
        client_rut_normalized,
        order_folio_input,
        order_folio_normalized,
        delivery_address_input
    )
    SELECT
        COALESCE(NULLIF(trim(value->>'row_number'), '')::integer, ordinality::integer + 1) AS row_number,
        btrim(coalesce(value->>'invoice_number', '')) AS invoice_number,
        lower(btrim(coalesce(value->>'invoice_number', ''))) AS invoice_number_normalized,
        btrim(coalesce(value->>'client_rut', '')) AS client_rut_input,
        public.normalize_dispatch_rut(value->>'client_rut') AS client_rut_normalized,
        btrim(coalesce(value->>'crm_order_number', '')) AS order_folio_input,
        public.normalize_dispatch_order_number(value->>'crm_order_number') AS order_folio_normalized,
        btrim(coalesce(value->>'delivery_address', '')) AS delivery_address_input
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS rows(value, ordinality);

    IF NOT EXISTS (SELECT 1 FROM tmp_dispatch_rows) THEN
        RAISE EXCEPTION 'El archivo no contiene filas válidas';
    END IF;

    CREATE TEMP TABLE tmp_dispatch_errors (
        row_number integer NOT NULL,
        invoice_number text,
        crm_order_number text,
        delivery_address text,
        reason text NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, crm_order_number, delivery_address, reason)
    SELECT row_number, invoice_number, order_folio_input, delivery_address_input, reason
    FROM (
        SELECT row_number, invoice_number, order_folio_input, delivery_address_input,
            CASE
                WHEN invoice_number = '' THEN 'Falta numero_factura'
                WHEN order_folio_normalized = '' THEN 'Falta numero_pedido_crm'
                ELSE NULL
            END AS reason
        FROM tmp_dispatch_rows
    ) src
    WHERE reason IS NOT NULL;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, crm_order_number, delivery_address, reason)
    SELECT r.row_number, r.invoice_number, r.order_folio_input, r.delivery_address_input,
           'Factura duplicada dentro del archivo'
    FROM tmp_dispatch_rows r
    JOIN (
        SELECT invoice_number_normalized
        FROM tmp_dispatch_rows
        WHERE invoice_number_normalized <> ''
        GROUP BY invoice_number_normalized
        HAVING COUNT(*) > 1
    ) dup ON dup.invoice_number_normalized = r.invoice_number_normalized;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, crm_order_number, delivery_address, reason)
    SELECT r.row_number, r.invoice_number, r.order_folio_input, r.delivery_address_input,
           'Pedido CRM duplicado dentro del archivo'
    FROM tmp_dispatch_rows r
    JOIN (
        SELECT order_folio_normalized
        FROM tmp_dispatch_rows
        WHERE order_folio_normalized <> ''
        GROUP BY order_folio_normalized
        HAVING COUNT(*) > 1
    ) dup ON dup.order_folio_normalized = r.order_folio_normalized;

    CREATE TEMP TABLE tmp_dispatch_match ON COMMIT DROP AS
    SELECT
        r.*,
        o.id AS order_id,
        o.client_id,
        o.user_id AS seller_id,
        lower(coalesce(o.status, '')) AS order_status,
        lower(coalesce(o.delivery_status, '')) AS delivery_status,
        o.total_amount,
        c.name AS client_name,
        c.address AS client_address,
        c.comuna AS client_comuna,
        c.office AS client_office,
        c.phone AS client_phone,
        c.lat AS client_lat,
        c.lng AS client_lng,
        coalesce(c.rut, '') AS client_rut_db,
        public.normalize_dispatch_rut(c.rut) AS client_rut_db_normalized,
        p.full_name AS seller_name,
        p.email AS seller_email,
        coalesce(nullif(btrim(r.delivery_address_input), ''), nullif(btrim(coalesce(c.address, '')), '')) AS effective_delivery_address
    FROM tmp_dispatch_rows r
    LEFT JOIN public.orders o
      ON o.folio::text = r.order_folio_normalized
    LEFT JOIN public.clients c
      ON c.id = o.client_id
    LEFT JOIN public.profiles p
      ON p.id = o.user_id;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, crm_order_number, delivery_address, reason)
    SELECT row_number, invoice_number, order_folio_input, delivery_address_input,
           CASE
               WHEN order_id IS NULL THEN 'Pedido CRM no existe'
               WHEN client_id IS NULL THEN 'El pedido no tiene cliente asociado'
               WHEN client_name IS NULL THEN 'Cliente del pedido no existe'
               WHEN effective_delivery_address IS NULL THEN 'El pedido no tiene direccion y la fila no trae direccion'
               WHEN client_rut_normalized <> '' AND client_rut_db_normalized = '' THEN 'El cliente del pedido no tiene RUT registrado'
               WHEN client_rut_normalized <> '' AND client_rut_db_normalized <> client_rut_normalized THEN 'El RUT no coincide con el cliente del pedido'
               WHEN order_status <> 'completed' THEN 'El pedido no esta en estado completed'
               WHEN delivery_status IN ('out_for_delivery', 'delivered') THEN 'El pedido ya esta en despacho o entregado'
               ELSE NULL
           END AS reason
    FROM tmp_dispatch_match
    WHERE order_id IS NULL
       OR client_id IS NULL
       OR client_name IS NULL
       OR effective_delivery_address IS NULL
       OR (client_rut_normalized <> '' AND client_rut_db_normalized = '')
       OR (client_rut_normalized <> '' AND client_rut_db_normalized <> client_rut_normalized)
       OR order_status <> 'completed'
       OR delivery_status IN ('out_for_delivery', 'delivered');

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, crm_order_number, delivery_address, reason)
    SELECT m.row_number, m.invoice_number, m.order_folio_input, m.delivery_address_input,
           'La factura ya existe en despachos'
    FROM tmp_dispatch_match m
    JOIN public.dispatch_queue_items q
      ON lower(btrim(q.invoice_number)) = m.invoice_number_normalized;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, crm_order_number, delivery_address, reason)
    SELECT m.row_number, m.invoice_number, m.order_folio_input, m.delivery_address_input,
           'El pedido ya fue cargado antes en despachos'
    FROM tmp_dispatch_match m
    JOIN public.dispatch_queue_items q
      ON q.order_id = m.order_id;

    IF EXISTS (SELECT 1 FROM tmp_dispatch_errors) THEN
        SELECT jsonb_build_object(
            'type', 'validation',
            'errors', (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'row_number', e.row_number,
                        'invoice_number', e.invoice_number,
                        'crm_order_number', e.crm_order_number,
                        'delivery_address', e.delivery_address,
                        'reason', e.reason
                    )
                    ORDER BY e.row_number, e.reason
                )
                FROM tmp_dispatch_errors e
            )
        ) INTO v_error_payload;

        RAISE EXCEPTION USING MESSAGE = v_error_payload::text;
    END IF;

    INSERT INTO public.dispatch_import_batches (file_name, uploaded_by, row_count)
    VALUES (coalesce(nullif(btrim(p_file_name), ''), 'despacho_importado.xlsx'), auth.uid(), (SELECT COUNT(*) FROM tmp_dispatch_rows))
    RETURNING id INTO v_batch_id;

    INSERT INTO public.dispatch_queue_items (
        batch_id,
        order_id,
        client_id,
        seller_id,
        invoice_number,
        client_rut_input,
        client_rut_normalized,
        order_folio_input,
        client_name_snapshot,
        client_address_snapshot,
        client_comuna_snapshot,
        client_office_snapshot,
        client_phone_snapshot,
        client_lat_snapshot,
        client_lng_snapshot,
        imported_address_input,
        address_source,
        seller_name_snapshot,
        seller_email_snapshot,
        order_total_snapshot,
        status,
        imported_at
    )
    SELECT
        v_batch_id,
        order_id,
        client_id,
        seller_id,
        invoice_number,
        coalesce(nullif(client_rut_input, ''), nullif(client_rut_db, ''), ''),
        coalesce(nullif(client_rut_normalized, ''), nullif(client_rut_db_normalized, ''), ''),
        order_folio_input,
        client_name,
        effective_delivery_address,
        nullif(client_comuna, ''),
        nullif(client_office, ''),
        nullif(client_phone, ''),
        client_lat,
        client_lng,
        nullif(delivery_address_input, ''),
        CASE WHEN nullif(delivery_address_input, '') IS NOT NULL THEN 'excel' ELSE 'client' END,
        nullif(seller_name, ''),
        nullif(seller_email, ''),
        total_amount,
        'queued',
        now()
    FROM tmp_dispatch_match;

    RETURN jsonb_build_object(
        'batch_id', v_batch_id,
        'imported_count', (SELECT COUNT(*) FROM tmp_dispatch_rows),
        'invoice_numbers', (SELECT jsonb_agg(invoice_number ORDER BY row_number) FROM tmp_dispatch_rows),
        'order_ids', (SELECT jsonb_agg(order_id) FROM tmp_dispatch_match)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_dispatch_invoice_batch(jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
