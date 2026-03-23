CREATE TABLE IF NOT EXISTS public.dispatch_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    row_count INTEGER NOT NULL CHECK (row_count > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dispatch_queue_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.dispatch_import_batches(id) ON DELETE RESTRICT,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    seller_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    route_id UUID NULL REFERENCES public.delivery_routes(id) ON DELETE SET NULL,
    assigned_driver_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    invoice_number TEXT NOT NULL,
    client_rut_input TEXT NOT NULL,
    client_rut_normalized TEXT NOT NULL,
    order_folio_input TEXT NOT NULL,
    client_name_snapshot TEXT NOT NULL,
    client_address_snapshot TEXT NULL,
    client_comuna_snapshot TEXT NULL,
    client_office_snapshot TEXT NULL,
    client_phone_snapshot TEXT NULL,
    client_lat_snapshot NUMERIC NULL,
    client_lng_snapshot NUMERIC NULL,
    seller_name_snapshot TEXT NULL,
    seller_email_snapshot TEXT NULL,
    order_total_snapshot NUMERIC NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'routed', 'delivered', 'cancelled')),
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    routed_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    notes TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_dispatch_import_batches_uploaded_by ON public.dispatch_import_batches(uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_items_batch_id ON public.dispatch_queue_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_items_route_id ON public.dispatch_queue_items(route_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_items_assigned_driver_id ON public.dispatch_queue_items(assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_items_status ON public.dispatch_queue_items(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_queue_items_client_rut_normalized ON public.dispatch_queue_items(client_rut_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_queue_items_order_unique ON public.dispatch_queue_items(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_queue_items_invoice_unique ON public.dispatch_queue_items((lower(btrim(invoice_number))));

ALTER TABLE public.dispatch_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_queue_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dispatch managers read batches" ON public.dispatch_import_batches;
CREATE POLICY "Dispatch managers read batches" ON public.dispatch_import_batches
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
        )
    );

DROP POLICY IF EXISTS "Dispatch managers insert batches" ON public.dispatch_import_batches;
CREATE POLICY "Dispatch managers insert batches" ON public.dispatch_import_batches
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
        )
    );

DROP POLICY IF EXISTS "Dispatch managers update batches" ON public.dispatch_import_batches;
CREATE POLICY "Dispatch managers update batches" ON public.dispatch_import_batches
    FOR UPDATE USING (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
        )
    );

DROP POLICY IF EXISTS "Dispatch managers read queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers read queue" ON public.dispatch_queue_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
        )
    );

DROP POLICY IF EXISTS "Dispatch managers insert queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers insert queue" ON public.dispatch_queue_items
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
        )
    );

DROP POLICY IF EXISTS "Dispatch managers update queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers update queue" ON public.dispatch_queue_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
        )
    );

DROP POLICY IF EXISTS "Dispatch managers delete queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers delete queue" ON public.dispatch_queue_items
    FOR DELETE USING (
        EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE p.id = auth.uid()
              AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
        )
    );

CREATE OR REPLACE FUNCTION public.normalize_dispatch_rut(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_normalized text;
BEGIN
    v_normalized := upper(regexp_replace(coalesce(p_value, ''), '[^0-9kK]', '', 'g'));
    IF v_normalized = '' THEN
        RETURN '';
    END IF;
    RETURN v_normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_dispatch_order_number(p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_trimmed text;
BEGIN
    v_trimmed := btrim(coalesce(p_value, ''));
    IF v_trimmed = '' THEN
        RETURN '';
    END IF;

    IF v_trimmed ~ '^\d+(\.0+)?$' THEN
        RETURN ((v_trimmed)::numeric)::bigint::text;
    END IF;

    RETURN regexp_replace(v_trimmed, '\s+', '', 'g');
END;
$$;

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

    IF v_actor_role NOT IN ('admin', 'facturador') THEN
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
        order_folio_normalized text NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_dispatch_rows (
        row_number,
        invoice_number,
        invoice_number_normalized,
        client_rut_input,
        client_rut_normalized,
        order_folio_input,
        order_folio_normalized
    )
    SELECT
        COALESCE(NULLIF(trim(value->>'row_number'), '')::integer, ordinality::integer + 1) AS row_number,
        btrim(coalesce(value->>'invoice_number', '')) AS invoice_number,
        lower(btrim(coalesce(value->>'invoice_number', ''))) AS invoice_number_normalized,
        btrim(coalesce(value->>'client_rut', '')) AS client_rut_input,
        public.normalize_dispatch_rut(value->>'client_rut') AS client_rut_normalized,
        btrim(coalesce(value->>'crm_order_number', '')) AS order_folio_input,
        public.normalize_dispatch_order_number(value->>'crm_order_number') AS order_folio_normalized
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS rows(value, ordinality);

    IF NOT EXISTS (SELECT 1 FROM tmp_dispatch_rows) THEN
        RAISE EXCEPTION 'El archivo no contiene filas válidas';
    END IF;

    CREATE TEMP TABLE tmp_dispatch_errors (
        row_number integer NOT NULL,
        invoice_number text,
        client_rut text,
        crm_order_number text,
        reason text NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, client_rut, crm_order_number, reason)
    SELECT row_number, invoice_number, client_rut_input, order_folio_input, reason
    FROM (
        SELECT row_number, invoice_number, client_rut_input, order_folio_input,
            CASE
                WHEN invoice_number = '' THEN 'Falta numero_factura'
                WHEN client_rut_normalized = '' THEN 'Falta rut_cliente'
                WHEN order_folio_normalized = '' THEN 'Falta numero_pedido_crm'
                ELSE NULL
            END AS reason
        FROM tmp_dispatch_rows
    ) src
    WHERE reason IS NOT NULL;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, client_rut, crm_order_number, reason)
    SELECT r.row_number, r.invoice_number, r.client_rut_input, r.order_folio_input,
           'Factura duplicada dentro del archivo'
    FROM tmp_dispatch_rows r
    JOIN (
        SELECT invoice_number_normalized
        FROM tmp_dispatch_rows
        WHERE invoice_number_normalized <> ''
        GROUP BY invoice_number_normalized
        HAVING COUNT(*) > 1
    ) dup ON dup.invoice_number_normalized = r.invoice_number_normalized;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, client_rut, crm_order_number, reason)
    SELECT r.row_number, r.invoice_number, r.client_rut_input, r.order_folio_input,
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
        p.email AS seller_email
    FROM tmp_dispatch_rows r
    LEFT JOIN public.orders o
      ON o.folio::text = r.order_folio_normalized
    LEFT JOIN public.clients c
      ON c.id = o.client_id
    LEFT JOIN public.profiles p
      ON p.id = o.user_id;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, client_rut, crm_order_number, reason)
    SELECT row_number, invoice_number, client_rut_input, order_folio_input,
           CASE
               WHEN order_id IS NULL THEN 'Pedido CRM no existe'
               WHEN client_id IS NULL THEN 'El pedido no tiene cliente asociado'
               WHEN client_name IS NULL THEN 'Cliente del pedido no existe'
               WHEN client_rut_db_normalized = '' THEN 'El cliente del pedido no tiene RUT registrado'
               WHEN client_rut_db_normalized <> client_rut_normalized THEN 'El RUT no coincide con el cliente del pedido'
               WHEN order_status <> 'completed' THEN 'El pedido no esta en estado completed'
               WHEN delivery_status IN ('out_for_delivery', 'delivered') THEN 'El pedido ya esta en despacho o entregado'
               ELSE NULL
           END AS reason
    FROM tmp_dispatch_match
    WHERE order_id IS NULL
       OR client_id IS NULL
       OR client_name IS NULL
       OR client_rut_db_normalized = ''
       OR client_rut_db_normalized <> client_rut_normalized
       OR order_status <> 'completed'
       OR delivery_status IN ('out_for_delivery', 'delivered');

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, client_rut, crm_order_number, reason)
    SELECT m.row_number, m.invoice_number, m.client_rut_input, m.order_folio_input,
           'La factura ya existe en despachos'
    FROM tmp_dispatch_match m
    JOIN public.dispatch_queue_items q
      ON lower(btrim(q.invoice_number)) = m.invoice_number_normalized;

    INSERT INTO tmp_dispatch_errors (row_number, invoice_number, client_rut, crm_order_number, reason)
    SELECT m.row_number, m.invoice_number, m.client_rut_input, m.order_folio_input,
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
                        'client_rut', e.client_rut,
                        'crm_order_number', e.crm_order_number,
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
        client_rut_input,
        client_rut_normalized,
        order_folio_input,
        client_name,
        nullif(client_address, ''),
        nullif(client_comuna, ''),
        nullif(client_office, ''),
        nullif(client_phone, ''),
        client_lat,
        client_lng,
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

DROP FUNCTION IF EXISTS public.create_dispatch_routes_from_queue(jsonb);
CREATE OR REPLACE FUNCTION public.create_dispatch_routes_from_queue(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_group record;
    v_route_id uuid;
    v_created_routes integer := 0;
    v_route_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_actor_role NOT IN ('admin', 'facturador') THEN
        RAISE EXCEPTION 'No tienes permisos para crear rutas de despacho';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Debes enviar al menos un item para crear rutas';
    END IF;

    CREATE TEMP TABLE tmp_route_payload (
        queue_item_id uuid PRIMARY KEY,
        driver_id uuid NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_route_payload (queue_item_id, driver_id)
    SELECT DISTINCT ON (queue_item_id)
        nullif(trim(value->>'queue_item_id'), '')::uuid,
        nullif(trim(value->>'driver_id'), '')::uuid
    FROM jsonb_array_elements(p_items) AS rows(value)
    WHERE nullif(trim(value->>'queue_item_id'), '') IS NOT NULL
      AND nullif(trim(value->>'driver_id'), '') IS NOT NULL;

    IF NOT EXISTS (SELECT 1 FROM tmp_route_payload) THEN
        RAISE EXCEPTION 'No se encontraron asignaciones válidas';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS rows(value)
        WHERE nullif(trim(value->>'queue_item_id'), '') IS NULL
           OR nullif(trim(value->>'driver_id'), '') IS NULL
    ) THEN
        RAISE EXCEPTION 'Todas las filas requieren queue_item_id y driver_id';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_route_payload p
        LEFT JOIN public.dispatch_queue_items q ON q.id = p.queue_item_id
        WHERE q.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Uno o más items de cola no existen';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_route_payload p
        JOIN public.dispatch_queue_items q ON q.id = p.queue_item_id
        WHERE q.status <> 'queued'
    ) THEN
        RAISE EXCEPTION 'Solo se pueden enrutar items en estado queued';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_route_payload p
        LEFT JOIN public.profiles d ON d.id = p.driver_id
        WHERE d.id IS NULL OR lower(coalesce(d.role, '')) <> 'driver'
    ) THEN
        RAISE EXCEPTION 'Todos los drivers asignados deben existir y tener rol driver';
    END IF;

    FOR v_group IN
        SELECT
            p.driver_id,
            coalesce(pr.full_name, split_part(coalesce(pr.email, ''), '@', 1), 'Repartidor') AS driver_name
        FROM tmp_route_payload p
        JOIN public.profiles pr ON pr.id = p.driver_id
        GROUP BY p.driver_id, coalesce(pr.full_name, split_part(coalesce(pr.email, ''), '@', 1), 'Repartidor')
    LOOP
        INSERT INTO public.delivery_routes (name, driver_id, status, created_at)
        VALUES (
            'Ruta ' || v_group.driver_name || ' - ' || to_char(now(), 'DD/MM/YYYY'),
            v_group.driver_id,
            'in_progress',
            now()
        )
        RETURNING id INTO v_route_id;

        INSERT INTO public.route_items (route_id, order_id, sequence_order, status, created_at)
        SELECT
            v_route_id,
            q.order_id,
            row_number() OVER (ORDER BY q.imported_at, q.id),
            'pending',
            now()
        FROM public.dispatch_queue_items q
        JOIN tmp_route_payload p ON p.queue_item_id = q.id
        WHERE p.driver_id = v_group.driver_id;

        UPDATE public.orders o
        SET route_id = v_route_id,
            delivery_status = 'out_for_delivery'
        FROM public.dispatch_queue_items q
        JOIN tmp_route_payload p ON p.queue_item_id = q.id
        WHERE p.driver_id = v_group.driver_id
          AND o.id = q.order_id;

        UPDATE public.dispatch_queue_items q
        SET route_id = v_route_id,
            assigned_driver_id = v_group.driver_id,
            status = 'routed',
            routed_at = now()
        FROM tmp_route_payload p
        WHERE p.queue_item_id = q.id
          AND p.driver_id = v_group.driver_id;

        v_created_routes := v_created_routes + 1;
        v_route_ids := array_append(v_route_ids, v_route_id);
    END LOOP;

    RETURN jsonb_build_object(
        'created_routes', v_created_routes,
        'route_ids', to_jsonb(v_route_ids)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_dispatch_queue_from_route_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.order_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF lower(coalesce(NEW.status, '')) = 'delivered' THEN
        UPDATE public.dispatch_queue_items
        SET status = 'delivered',
            delivered_at = coalesce(NEW.delivered_at, now()),
            route_id = coalesce(NEW.route_id, route_id)
        WHERE order_id = NEW.order_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_dispatch_queue_from_route_item ON public.route_items;
CREATE TRIGGER trg_sync_dispatch_queue_from_route_item
AFTER INSERT OR UPDATE OF status, delivered_at, route_id
ON public.route_items
FOR EACH ROW
EXECUTE FUNCTION public.sync_dispatch_queue_from_route_item();

GRANT EXECUTE ON FUNCTION public.import_dispatch_invoice_batch(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_dispatch_routes_from_queue(jsonb) TO authenticated;
