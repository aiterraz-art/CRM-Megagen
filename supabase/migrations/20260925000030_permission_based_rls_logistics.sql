-- Lote 3 de la Fase 3: despacho, rutas de entrega, kits y cambios de medida pasan de
-- chequeos por rol a permisos. Mismo metodo que los lotes anteriores; ademas deja iguales
-- las funciones y politicas que habian quedado distintas entre 3dental y Megagen.
--
-- Rutas: quien gestiona despacho actua sobre cualquier ruta; el repartidor (EXECUTE_DELIVERY)
-- solo sobre las suyas. Las rutas conservan el acceso de quien gestiona envios courier.

-- Megagen nunca recibio la migracion 20260729000148: le faltaban el estado 'closed' de las
-- entregas y la funcion mark_delivery_route_item_closed que usa src/utils/deliveryProof.ts.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumtypid = 'public.delivery_item_status'::regtype
          AND enumlabel = 'closed'
    ) THEN
        ALTER TYPE public.delivery_item_status ADD VALUE 'closed';
    END IF;
END $$;

DROP POLICY IF EXISTS "Dispatch managers read batches" ON public.dispatch_import_batches;
CREATE POLICY "Dispatch managers read batches"
ON public.dispatch_import_batches
AS PERMISSIVE
FOR SELECT
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')));

DROP POLICY IF EXISTS "Dispatch managers insert batches" ON public.dispatch_import_batches;
CREATE POLICY "Dispatch managers insert batches"
ON public.dispatch_import_batches
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')));

DROP POLICY IF EXISTS "Dispatch managers update batches" ON public.dispatch_import_batches;
CREATE POLICY "Dispatch managers update batches"
ON public.dispatch_import_batches
AS PERMISSIVE
FOR UPDATE
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')));

DROP POLICY IF EXISTS "Dispatch managers read queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers read queue"
ON public.dispatch_queue_items
AS PERMISSIVE
FOR SELECT
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')));

DROP POLICY IF EXISTS "Dispatch managers insert queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers insert queue"
ON public.dispatch_queue_items
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')));

DROP POLICY IF EXISTS "Dispatch managers update queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers update queue"
ON public.dispatch_queue_items
AS PERMISSIVE
FOR UPDATE
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')));

DROP POLICY IF EXISTS "Dispatch managers delete queue" ON public.dispatch_queue_items;
CREATE POLICY "Dispatch managers delete queue"
ON public.dispatch_queue_items
AS PERMISSIVE
FOR DELETE
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')));

DROP POLICY IF EXISTS "Managers all routes" ON public.delivery_routes;
CREATE POLICY "Managers all routes"
ON public.delivery_routes
AS PERMISSIVE
FOR ALL
TO public
USING (((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')) OR (SELECT public.auth_user_has_permission('MANAGE_COURIER_SHIPMENTS'))))
WITH CHECK (((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')) OR (SELECT public.auth_user_has_permission('MANAGE_COURIER_SHIPMENTS'))));

DROP POLICY IF EXISTS "Managers all items" ON public.route_items;
CREATE POLICY "Managers all items"
ON public.route_items
AS PERMISSIVE
FOR ALL
TO public
USING (((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')) OR (SELECT public.auth_user_has_permission('MANAGE_COURIER_SHIPMENTS'))))
WITH CHECK (((SELECT public.auth_user_has_permission('MANAGE_DISPATCH')) OR (SELECT public.auth_user_has_permission('MANAGE_COURIER_SHIPMENTS'))));

DROP POLICY IF EXISTS "Loan kits read" ON public.loan_kits;
CREATE POLICY "Loan kits read"
ON public.loan_kits
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((SELECT public.auth_user_has_permission('VIEW_KIT_LOANS')));

DROP POLICY IF EXISTS "Loan kits manage insert" ON public.loan_kits;
CREATE POLICY "Loan kits manage insert"
ON public.loan_kits
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (((created_by = auth.uid()) AND (SELECT public.auth_user_has_permission('MANAGE_KIT_LOANS'))));

DROP POLICY IF EXISTS "Loan kits manage update" ON public.loan_kits;
CREATE POLICY "Loan kits manage update"
ON public.loan_kits
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_KIT_LOANS')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_KIT_LOANS')));

DROP POLICY IF EXISTS "Kit loan requests read" ON public.kit_loan_requests;
CREATE POLICY "Kit loan requests read"
ON public.kit_loan_requests
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((SELECT public.auth_user_has_permission('VIEW_KIT_LOANS')));

DROP POLICY IF EXISTS "Kit loan requests insert" ON public.kit_loan_requests;
CREATE POLICY "Kit loan requests insert"
ON public.kit_loan_requests
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (((requester_id = auth.uid()) AND (status = 'pending_dispatch'::text) AND (SELECT public.auth_user_has_permission('REQUEST_KIT_LOANS'))));

DROP POLICY IF EXISTS "Kit loan requests manage update" ON public.kit_loan_requests;
CREATE POLICY "Kit loan requests manage update"
ON public.kit_loan_requests
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_KIT_LOANS')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_KIT_LOANS')));

-- Cambios de medida: 3dental y Megagen tenian listas de roles distintas para ver todas las
-- solicitudes (una incluia a tesorero, la otra a jefe). Ambas quedan con el mismo criterio:
-- quien gestiona cambios de medida ve todas; quien puede verlos ve las propias.
DROP POLICY IF EXISTS "Size change requests read" ON public.size_change_requests;
CREATE POLICY "Size change requests read"
ON public.size_change_requests
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
    (SELECT public.auth_user_has_permission('MANAGE_SIZE_CHANGES'))
    OR (seller_id = auth.uid() AND (SELECT public.auth_user_has_permission('VIEW_SIZE_CHANGES')))
);

DROP POLICY IF EXISTS "Size change request items read" ON public.size_change_request_items;
CREATE POLICY "Size change request items read"
ON public.size_change_request_items
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.size_change_requests r
        WHERE r.id = size_change_request_items.request_id
          AND (
              (SELECT public.auth_user_has_permission('MANAGE_SIZE_CHANGES'))
              OR (r.seller_id = auth.uid() AND (SELECT public.auth_user_has_permission('VIEW_SIZE_CHANGES')))
          )
    )
);

CREATE OR REPLACE FUNCTION public.create_dispatch_routes_from_queue(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    IF NOT public.auth_user_has_permission('MANAGE_DISPATCH') THEN
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
    SELECT
        nullif(trim(value->>'queue_item_id'), '')::uuid,
        nullif(trim(value->>'driver_id'), '')::uuid
    FROM jsonb_array_elements(p_items) AS rows(value)
    WHERE nullif(trim(value->>'queue_item_id'), '') IS NOT NULL
      AND nullif(trim(value->>'driver_id'), '') IS NOT NULL
    ON CONFLICT (queue_item_id) DO UPDATE
    SET driver_id = EXCLUDED.driver_id;

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
            'draft',
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
            delivery_status = 'assigned'
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
$function$
;

CREATE OR REPLACE FUNCTION public.import_dispatch_invoice_batch(p_rows jsonb, p_file_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    IF NOT public.auth_user_has_permission('MANAGE_DISPATCH') THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.delete_delivery_route(p_route_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_route public.delivery_routes%ROWTYPE;
    v_delivered_items integer := 0;
    v_queue_items integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    IF NOT (public.auth_user_has_permission('MANAGE_DISPATCH') OR public.auth_user_has_permission('MANAGE_COURIER_SHIPMENTS')) THEN
        RAISE EXCEPTION 'No tienes permisos para eliminar esta ruta';
    END IF;

    SELECT *
    INTO v_route
    FROM public.delivery_routes
    WHERE id = p_route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La ruta indicada no existe';
    END IF;

    SELECT count(*)
    INTO v_delivered_items
    FROM public.route_items
    WHERE route_id = p_route_id
      AND lower(coalesce(status::text, '')) = 'delivered';

    IF v_delivered_items > 0 THEN
        RAISE EXCEPTION 'No se puede eliminar una ruta que ya tiene entregas registradas';
    END IF;

    UPDATE public.dispatch_queue_items
    SET route_id = NULL,
        assigned_driver_id = NULL,
        status = 'queued',
        routed_at = NULL,
        delivered_at = NULL,
        notes = CASE
            WHEN coalesce(notes, '') = '' THEN 'Ruta eliminada manualmente'
            ELSE notes || ' | Ruta eliminada manualmente'
        END
    WHERE route_id = p_route_id;

    GET DIAGNOSTICS v_queue_items = ROW_COUNT;

    UPDATE public.orders
    SET route_id = NULL,
        delivery_status = NULL
    WHERE route_id = p_route_id
      AND lower(coalesce(delivery_status::text, '')) <> 'delivered';

    DELETE FROM public.delivery_routes
    WHERE id = p_route_id;

    RETURN jsonb_build_object(
        'route_id', p_route_id,
        'released_queue_items', v_queue_items,
        'deleted', true
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finish_delivery_route(p_route_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_route public.delivery_routes%ROWTYPE;
    v_remaining_count integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    SELECT *
    INTO v_route
    FROM public.delivery_routes
    WHERE id = p_route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La ruta indicada no existe';
    END IF;

    IF NOT (
        public.auth_user_has_permission('MANAGE_DISPATCH')
        OR (public.auth_user_has_permission('EXECUTE_DELIVERY') AND v_route.driver_id = v_actor_id)
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para terminar esta ruta';
    END IF;

    IF lower(coalesce(v_route.status::text, '')) = 'completed' THEN
        RETURN jsonb_build_object(
            'route_id', v_route.id,
            'status', 'completed'
        );
    END IF;

    IF lower(coalesce(v_route.status::text, '')) <> 'in_progress' THEN
        RAISE EXCEPTION 'Solo se pueden terminar rutas en progreso';
    END IF;

    SELECT count(*)
    INTO v_remaining_count
    FROM public.route_items
    WHERE route_id = p_route_id
      AND lower(coalesce(status::text, '')) IN ('pending', 'rescheduled', 'failed');

    IF v_remaining_count > 0 THEN
        RAISE EXCEPTION 'Aún quedan pedidos pendientes en esta ruta';
    END IF;

    UPDATE public.delivery_routes
    SET status = 'completed'
    WHERE id = p_route_id;

    RETURN jsonb_build_object(
        'route_id', v_route.id,
        'status', 'completed'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_delivery_route_item_closed(p_route_item_id uuid, p_proof_photo_url text DEFAULT NULL::text, p_attempted_at timestamp with time zone DEFAULT now(), p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_route_item public.route_items%ROWTYPE;
    v_route public.delivery_routes%ROWTYPE;
    v_clean_notes text := nullif(btrim(coalesce(p_notes, '')), '');
    v_final_notes text;
    v_attempted_at timestamptz := coalesce(p_attempted_at, now());
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    SELECT *
    INTO v_route_item
    FROM public.route_items
    WHERE id = p_route_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El item de ruta indicado no existe';
    END IF;

    IF v_route_item.order_id IS NULL THEN
        RAISE EXCEPTION 'El item de ruta no tiene pedido asociado';
    END IF;

    SELECT *
    INTO v_route
    FROM public.delivery_routes
    WHERE id = v_route_item.route_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La ruta del pedido no existe';
    END IF;

    IF NOT (
        public.auth_user_has_permission('MANAGE_DISPATCH')
        OR public.auth_user_has_permission('MANAGE_COURIER_SHIPMENTS')
        OR (public.auth_user_has_permission('EXECUTE_DELIVERY') AND v_route.driver_id = v_actor_id)
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para cerrar esta entrega';
    END IF;

    IF lower(coalesce(v_route_item.status::text, '')) = 'delivered' THEN
        RAISE EXCEPTION 'El pedido ya fue marcado como entregado';
    END IF;

    v_final_notes := nullif(btrim(coalesce(v_route_item.notes, '')), '');
    IF position('cliente cerrado' in lower(coalesce(v_final_notes, ''))) = 0 THEN
        v_final_notes := concat_ws(E'\n', v_final_notes, 'Cliente cerrado');
    END IF;
    IF v_clean_notes IS NOT NULL THEN
        v_final_notes := concat_ws(E'\n', v_final_notes, v_clean_notes);
    END IF;
    v_final_notes := nullif(btrim(coalesce(v_final_notes, '')), '');

    UPDATE public.route_items
    SET status = 'closed',
        proof_photo_url = coalesce(nullif(btrim(coalesce(p_proof_photo_url, '')), ''), proof_photo_url),
        delivered_at = v_attempted_at,
        delivered_lat = coalesce(p_lat, delivered_lat),
        delivered_lng = coalesce(p_lng, delivered_lng),
        notes = v_final_notes
    WHERE id = p_route_item_id;

    UPDATE public.orders
    SET route_id = NULL,
        delivery_status = 'assigned',
        delivered_at = NULL,
        delivery_photo_url = NULL
    WHERE id = v_route_item.order_id;

    UPDATE public.dispatch_queue_items
    SET status = 'queued',
        route_id = NULL,
        routed_at = NULL,
        delivered_at = NULL,
        cancelled_at = NULL,
        notes = v_final_notes
    WHERE order_id = v_route_item.order_id;

    RETURN jsonb_build_object(
        'route_item_id', v_route_item.id,
        'order_id', v_route_item.order_id,
        'route_id', v_route.id,
        'status', 'closed',
        'attempted_at', v_attempted_at
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.start_delivery_routes(p_route_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_started_count integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id;

    IF coalesce(array_length(p_route_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Debes indicar al menos una ruta';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = ANY (p_route_ids)
          AND NOT (
              public.auth_user_has_permission('MANAGE_DISPATCH')
              OR (public.auth_user_has_permission('EXECUTE_DELIVERY') AND r.driver_id = v_actor_id)
          )
    ) THEN
        RAISE EXCEPTION 'No tienes permisos para iniciar una o más rutas';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = ANY (p_route_ids)
          AND lower(coalesce(r.status::text, '')) <> 'draft'
    ) THEN
        RAISE EXCEPTION 'Solo se pueden iniciar rutas en borrador';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes r
        WHERE r.id = ANY (p_route_ids)
        GROUP BY r.driver_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Solo se puede iniciar una ruta por repartidor a la vez';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.delivery_routes selected_routes
        JOIN public.delivery_routes active_routes
          ON active_routes.driver_id = selected_routes.driver_id
         AND lower(coalesce(active_routes.status::text, '')) = 'in_progress'
         AND active_routes.id <> selected_routes.id
        WHERE selected_routes.id = ANY (p_route_ids)
    ) THEN
        RAISE EXCEPTION 'El repartidor ya tiene una ruta en progreso. Debe terminarla antes de iniciar otra.';
    END IF;

    UPDATE public.delivery_routes
    SET status = 'in_progress'
    WHERE id = ANY (p_route_ids)
      AND status = 'draft';

    GET DIAGNOSTICS v_started_count = ROW_COUNT;

    UPDATE public.orders o
    SET delivery_status = 'out_for_delivery'
    FROM public.route_items ri
    WHERE ri.route_id = ANY (p_route_ids)
      AND ri.order_id = o.id
      AND lower(coalesce(o.delivery_status::text, '')) <> 'delivered';

    RETURN jsonb_build_object(
        'started_routes', v_started_count,
        'route_ids', to_jsonb(p_route_ids)
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_size_change_request(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor_role text;
    v_client_id uuid;
    v_seller_id uuid;
    v_request_comment text;
    v_request_id uuid;
    v_folio bigint;
    v_client public.clients%rowtype;
    v_seller public.profiles%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Usuario no autenticado';
    end if;

    select lower(coalesce(role, ''))
    into v_actor_role
    from public.profiles
    where id = auth.uid();

    if not public.auth_user_has_permission('CREATE_SIZE_CHANGES') then
        raise exception 'No tienes permisos para crear cambios de medida';
    end if;

    if jsonb_typeof(p_payload) <> 'object' then
        raise exception 'El payload del cambio debe ser un objeto JSON';
    end if;

    v_client_id := nullif(trim(coalesce(p_payload->>'client_id', '')), '')::uuid;
    v_seller_id := nullif(trim(coalesce(p_payload->>'seller_id', '')), '')::uuid;
    v_request_comment := nullif(trim(coalesce(p_payload->>'request_comment', '')), '');

    if v_client_id is null then
        raise exception 'Debes seleccionar un cliente';
    end if;

    if v_seller_id is null then
        raise exception 'Debes seleccionar un vendedor';
    end if;

    if not public.auth_user_has_permission('MANAGE_SIZE_CHANGES') and v_seller_id <> auth.uid() then
        raise exception 'Solo puedes crear solicitudes a tu nombre';
    end if;

    select *
    into v_client
    from public.clients
    where id = v_client_id;

    if not found then
        raise exception 'El cliente seleccionado no existe';
    end if;

    select *
    into v_seller
    from public.profiles
    where id = v_seller_id;

    if not found then
        raise exception 'El vendedor seleccionado no existe';
    end if;

    if lower(coalesce(v_seller.role, '')) not in ('seller', 'jefe') then
        raise exception 'El usuario asignado debe tener rol vendedor o jefe';
    end if;

    if lower(coalesce(v_seller.status, 'active')) <> 'active' then
        raise exception 'El vendedor asignado debe estar activo';
    end if;

    if jsonb_typeof(p_payload->'items') <> 'array' then
        raise exception 'Debes agregar al menos un producto';
    end if;

    create temp table tmp_size_change_items (
        product_id uuid,
        qty numeric,
        unit_price numeric
    ) on commit drop;

    insert into tmp_size_change_items (product_id, qty, unit_price)
    select
        nullif(trim(coalesce(value->>'product_id', '')), '')::uuid,
        coalesce(nullif(trim(coalesce(value->>'qty', '')), '')::numeric, 0),
        coalesce(nullif(trim(coalesce(value->>'unit_price', '')), '')::numeric, 0)
    from jsonb_array_elements(p_payload->'items') as rows(value);

    if not exists (select 1 from tmp_size_change_items) then
        raise exception 'Debes agregar al menos un producto';
    end if;

    if exists (select 1 from tmp_size_change_items where product_id is null) then
        raise exception 'Todos los productos deben existir en inventario';
    end if;

    if exists (select 1 from tmp_size_change_items where qty <= 0) then
        raise exception 'La cantidad debe ser mayor a cero en todas las líneas';
    end if;

    if exists (select 1 from tmp_size_change_items where unit_price < 0) then
        raise exception 'El valor unitario no puede ser negativo';
    end if;

    if exists (
        select product_id
        from tmp_size_change_items
        group by product_id
        having count(*) > 1
    ) then
        raise exception 'No puedes repetir el mismo producto en más de una línea';
    end if;

    create temp table tmp_size_change_resolved on commit drop as
    select
        t.product_id,
        t.qty,
        t.unit_price,
        i.sku,
        i.name
    from tmp_size_change_items t
    join public.inventory i
      on i.id = t.product_id;

    if (select count(*) from tmp_size_change_resolved) <> (select count(*) from tmp_size_change_items) then
        raise exception 'Uno o más productos del cambio no existen en inventario';
    end if;

    insert into public.size_change_requests (
        client_id,
        seller_id,
        created_by,
        status,
        client_name_snapshot,
        client_rut_snapshot,
        client_address_snapshot,
        client_comuna_snapshot,
        seller_name_snapshot,
        request_comment
    )
    values (
        v_client_id,
        v_seller_id,
        auth.uid(),
        'requested',
        v_client.name,
        v_client.rut,
        v_client.address,
        v_client.comuna,
        coalesce(nullif(trim(v_seller.full_name), ''), split_part(coalesce(v_seller.email, ''), '@', 1), 'Vendedor'),
        v_request_comment
    )
    returning id, folio into v_request_id, v_folio;

    insert into public.size_change_request_items (
        request_id,
        product_id,
        sku_snapshot,
        product_name_snapshot,
        qty,
        unit_price,
        line_total
    )
    select
        v_request_id,
        product_id,
        coalesce(sku, ''),
        name,
        qty,
        unit_price,
        qty * unit_price
    from tmp_size_change_resolved;

    return jsonb_build_object(
        'id', v_request_id,
        'folio', v_folio,
        'status', 'requested'
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_size_change_request(p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor_role text;
    v_request public.size_change_requests%rowtype;
    v_client_id uuid;
    v_seller_id uuid;
    v_request_comment text;
    v_client public.clients%rowtype;
    v_seller public.profiles%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Usuario no autenticado';
    end if;

    select lower(coalesce(role, ''))
    into v_actor_role
    from public.profiles
    where id = auth.uid();

    if not (public.auth_user_has_permission('CREATE_SIZE_CHANGES') or public.auth_user_has_permission('MANAGE_SIZE_CHANGES')) then
        raise exception 'No tienes permisos para editar cambios de medida';
    end if;

    select *
    into v_request
    from public.size_change_requests
    where id = p_request_id
    for update;

    if not found then
        raise exception 'La solicitud de cambio no existe';
    end if;

    if v_request.status <> 'requested' then
        raise exception 'Solo puedes editar solicitudes en estado solicitado';
    end if;

    if not public.auth_user_has_permission('MANAGE_SIZE_CHANGES') and v_request.seller_id <> auth.uid() then
        raise exception 'Solo puedes editar tus propias solicitudes';
    end if;

    if jsonb_typeof(p_payload) <> 'object' then
        raise exception 'El payload del cambio debe ser un objeto JSON';
    end if;

    v_client_id := nullif(trim(coalesce(p_payload->>'client_id', '')), '')::uuid;
    v_seller_id := nullif(trim(coalesce(p_payload->>'seller_id', '')), '')::uuid;
    v_request_comment := nullif(trim(coalesce(p_payload->>'request_comment', '')), '');

    if v_client_id is null then
        raise exception 'Debes seleccionar un cliente';
    end if;

    if v_seller_id is null then
        raise exception 'Debes seleccionar un vendedor';
    end if;

    if not public.auth_user_has_permission('MANAGE_SIZE_CHANGES') and v_seller_id <> auth.uid() then
        raise exception 'Solo puedes crear solicitudes a tu nombre';
    end if;

    select *
    into v_client
    from public.clients
    where id = v_client_id;

    if not found then
        raise exception 'El cliente seleccionado no existe';
    end if;

    select *
    into v_seller
    from public.profiles
    where id = v_seller_id;

    if not found then
        raise exception 'El vendedor seleccionado no existe';
    end if;

    if lower(coalesce(v_seller.role, '')) not in ('seller', 'jefe') then
        raise exception 'El usuario asignado debe tener rol vendedor o jefe';
    end if;

    if lower(coalesce(v_seller.status, 'active')) <> 'active' then
        raise exception 'El vendedor asignado debe estar activo';
    end if;

    if jsonb_typeof(p_payload->'items') <> 'array' then
        raise exception 'Debes agregar al menos un producto';
    end if;

    create temp table tmp_size_change_items (
        product_id uuid,
        qty numeric,
        unit_price numeric
    ) on commit drop;

    insert into tmp_size_change_items (product_id, qty, unit_price)
    select
        nullif(trim(coalesce(value->>'product_id', '')), '')::uuid,
        coalesce(nullif(trim(coalesce(value->>'qty', '')), '')::numeric, 0),
        coalesce(nullif(trim(coalesce(value->>'unit_price', '')), '')::numeric, 0)
    from jsonb_array_elements(p_payload->'items') as rows(value);

    if not exists (select 1 from tmp_size_change_items) then
        raise exception 'Debes agregar al menos un producto';
    end if;

    if exists (select 1 from tmp_size_change_items where product_id is null) then
        raise exception 'Todos los productos deben existir en inventario';
    end if;

    if exists (select 1 from tmp_size_change_items where qty <= 0) then
        raise exception 'La cantidad debe ser mayor a cero en todas las líneas';
    end if;

    if exists (select 1 from tmp_size_change_items where unit_price < 0) then
        raise exception 'El valor unitario no puede ser negativo';
    end if;

    if exists (
        select product_id
        from tmp_size_change_items
        group by product_id
        having count(*) > 1
    ) then
        raise exception 'No puedes repetir el mismo producto en más de una línea';
    end if;

    create temp table tmp_size_change_resolved on commit drop as
    select
        t.product_id,
        t.qty,
        t.unit_price,
        i.sku,
        i.name
    from tmp_size_change_items t
    join public.inventory i
      on i.id = t.product_id;

    if (select count(*) from tmp_size_change_resolved) <> (select count(*) from tmp_size_change_items) then
        raise exception 'Uno o más productos del cambio no existen en inventario';
    end if;

    update public.size_change_requests
    set client_id = v_client_id,
        seller_id = v_seller_id,
        client_name_snapshot = v_client.name,
        client_rut_snapshot = v_client.rut,
        client_address_snapshot = v_client.address,
        client_comuna_snapshot = v_client.comuna,
        seller_name_snapshot = coalesce(nullif(trim(v_seller.full_name), ''), split_part(coalesce(v_seller.email, ''), '@', 1), 'Vendedor'),
        request_comment = v_request_comment,
        sent_note = null,
        close_note = null,
        cancel_note = null,
        exchange_completed_successfully = false,
        return_products_collected = false,
        sent_at = null,
        sent_by = null,
        closed_at = null,
        closed_by = null,
        cancelled_at = null,
        cancelled_by = null,
        updated_at = timezone('utc', now())
    where id = p_request_id;

    delete from public.size_change_request_items
    where request_id = p_request_id;

    insert into public.size_change_request_items (
        request_id,
        product_id,
        sku_snapshot,
        product_name_snapshot,
        qty,
        unit_price,
        line_total
    )
    select
        p_request_id,
        product_id,
        coalesce(sku, ''),
        name,
        qty,
        unit_price,
        qty * unit_price
    from tmp_size_change_resolved;

    return jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'requested'
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_size_change_sent(p_request_id uuid, p_sent_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_role text;
    v_request public.size_change_requests%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF NOT public.auth_user_has_permission('MANAGE_SIZE_CHANGES') THEN
        RAISE EXCEPTION 'No tienes permisos para enviar cambios de medida';
    END IF;

    SELECT *
    INTO v_request
    FROM public.size_change_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La solicitud de cambio no existe';
    END IF;

    IF v_request.status <> 'requested' THEN
        RAISE EXCEPTION 'Solo puedes enviar solicitudes en estado solicitado';
    END IF;

    UPDATE public.size_change_requests
    SET status = 'sent',
        sent_at = timezone('utc', now()),
        sent_by = auth.uid(),
        sent_note = nullif(trim(coalesce(p_sent_note, '')), ''),
        updated_at = timezone('utc', now())
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'sent'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.close_size_change_request(p_request_id uuid, p_close_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_role text;
    v_request public.size_change_requests%ROWTYPE;
    v_insufficient_item record;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF NOT public.auth_user_has_permission('MANAGE_SIZE_CHANGES') THEN
        RAISE EXCEPTION 'No tienes permisos para cerrar cambios de medida';
    END IF;

    SELECT *
    INTO v_request
    FROM public.size_change_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La solicitud de cambio no existe';
    END IF;

    IF v_request.status <> 'sent' THEN
        RAISE EXCEPTION 'Solo puedes cerrar solicitudes en estado enviado';
    END IF;

    PERFORM 1
    FROM public.inventory i
    JOIN public.size_change_request_items items
      ON items.product_id = i.id
    WHERE items.request_id = p_request_id
    FOR UPDATE OF i;

    SELECT
        items.sku_snapshot,
        items.product_name_snapshot,
        items.qty,
        coalesce(i.stock_qty, 0) AS current_stock
    INTO v_insufficient_item
    FROM public.size_change_request_items items
    JOIN public.inventory i
      ON i.id = items.product_id
    WHERE items.request_id = p_request_id
      AND coalesce(i.stock_qty, 0) < items.qty
    ORDER BY items.created_at
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Stock insuficiente para % (%). Disponible: %, solicitado: %',
            v_insufficient_item.product_name_snapshot,
            coalesce(v_insufficient_item.sku_snapshot, 'SIN SKU'),
            v_insufficient_item.current_stock,
            v_insufficient_item.qty;
    END IF;

    UPDATE public.inventory i
    SET stock_qty = coalesce(i.stock_qty, 0) - items.qty
    FROM public.size_change_request_items items
    WHERE items.request_id = p_request_id
      AND items.product_id = i.id;

    UPDATE public.size_change_requests
    SET status = 'closed',
        close_note = nullif(trim(coalesce(p_close_note, '')), ''),
        closed_at = timezone('utc', now()),
        closed_by = auth.uid(),
        exchange_completed_successfully = true,
        return_products_collected = true,
        updated_at = timezone('utc', now())
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'closed'
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_size_change_request(p_request_id uuid, p_cancel_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_role text;
    v_request public.size_change_requests%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(role, ''))
    INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();

    SELECT *
    INTO v_request
    FROM public.size_change_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La solicitud de cambio no existe';
    END IF;

    IF public.auth_user_has_permission('MANAGE_SIZE_CHANGES') THEN
        IF v_request.status NOT IN ('requested', 'sent') THEN
            RAISE EXCEPTION 'Solo puedes cancelar solicitudes abiertas';
        END IF;
    ELSIF public.auth_user_has_permission('CREATE_SIZE_CHANGES') THEN
        IF v_request.seller_id <> auth.uid() THEN
            RAISE EXCEPTION 'Solo puedes cancelar tus propias solicitudes';
        END IF;
        IF v_request.status <> 'requested' THEN
            RAISE EXCEPTION 'Solo puedes cancelar solicitudes en estado solicitado';
        END IF;
    ELSE
        RAISE EXCEPTION 'No tienes permisos para cancelar cambios de medida';
    END IF;

    UPDATE public.size_change_requests
    SET status = 'cancelled',
        cancel_note = nullif(trim(coalesce(p_cancel_note, '')), ''),
        cancelled_at = timezone('utc', now()),
        cancelled_by = auth.uid(),
        updated_at = timezone('utc', now())
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
        'id', p_request_id,
        'folio', v_request.folio,
        'status', 'cancelled'
    );
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.mark_delivery_route_item_closed(uuid, text, timestamptz, double precision, double precision, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
