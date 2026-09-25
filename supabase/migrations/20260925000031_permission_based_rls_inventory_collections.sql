-- Lote 4 de la Fase 3: inventario, compras, cobranzas e integraciones.
--
-- * Politicas de inventario y compras que consultaban role_permissions directamente pasan a
--   auth_user_has_permission con los mismos permisos, para respetar excepciones por persona.
-- * Movimientos, ajustes y rotacion de inventario: de admin/jefe por rol a permisos
--   (analisis de stock; los ajustes ademas exigen gestion de inventario, como la pantalla).
-- * Cobranzas: visibilidad, cargas y asignacion de vendedor pasan a permisos.
-- * Tienda web y credencial de Meta: de admin por rol a MANAGE_WEB_STORE y
--   MANAGE_META_INTEGRATION (solo admin).
-- * 3dental no habia recibido 20260907000001 (importaciones de Excel optimizadas); se
--   instalan las mismas definiciones que ya corren en Megagen.

INSERT INTO public.role_permissions (role, permission)
VALUES ('admin', 'MANAGE_META_INTEGRATION')
ON CONFLICT (role, permission) DO NOTHING;

DROP POLICY IF EXISTS "Staff edit products" ON public.products;
CREATE POLICY "Staff edit products"
ON public.products
AS PERMISSIVE
FOR ALL
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')));

DROP POLICY IF EXISTS "Procurement shipment items manage delete" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items manage delete"
ON public.inbound_shipment_items
AS PERMISSIVE
FOR DELETE
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')));

DROP POLICY IF EXISTS "Procurement shipment items manage insert" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items manage insert"
ON public.inbound_shipment_items
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')));

DROP POLICY IF EXISTS "Procurement shipment items manage update" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items manage update"
ON public.inbound_shipment_items
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')));

DROP POLICY IF EXISTS "Procurement shipment items read" ON public.inbound_shipment_items;
CREATE POLICY "Procurement shipment items read"
ON public.inbound_shipment_items
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((SELECT public.auth_user_has_permission('VIEW_PROCUREMENT')) OR (SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT'))));

DROP POLICY IF EXISTS "Procurement shipments manage delete" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments manage delete"
ON public.inbound_shipments
AS PERMISSIVE
FOR DELETE
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')));

DROP POLICY IF EXISTS "Procurement shipments manage insert" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments manage insert"
ON public.inbound_shipments
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (((created_by = auth.uid()) AND (SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT'))));

DROP POLICY IF EXISTS "Procurement shipments manage update" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments manage update"
ON public.inbound_shipments
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')));

DROP POLICY IF EXISTS "Procurement shipments read" ON public.inbound_shipments;
CREATE POLICY "Procurement shipments read"
ON public.inbound_shipments
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((SELECT public.auth_user_has_permission('VIEW_PROCUREMENT')) OR (SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT'))));

DROP POLICY IF EXISTS "Inventory delete staff" ON public.inventory;
CREATE POLICY "Inventory delete staff"
ON public.inventory
AS PERMISSIVE
FOR DELETE
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')));

DROP POLICY IF EXISTS "Inventory insert staff" ON public.inventory;
CREATE POLICY "Inventory insert staff"
ON public.inventory
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')));

DROP POLICY IF EXISTS "Inventory update staff" ON public.inventory;
CREATE POLICY "Inventory update staff"
ON public.inventory
AS PERMISSIVE
FOR UPDATE
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_INVENTORY')));

DROP POLICY IF EXISTS "Procurement product requests insert" ON public.product_requests;
CREATE POLICY "Procurement product requests insert"
ON public.product_requests
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (((requester_id = auth.uid()) AND (SELECT public.auth_user_has_permission('REQUEST_PRODUCTS'))));

DROP POLICY IF EXISTS "Procurement product requests manage" ON public.product_requests;
CREATE POLICY "Procurement product requests manage"
ON public.product_requests
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT')));

DROP POLICY IF EXISTS "Procurement product requests read" ON public.product_requests;
CREATE POLICY "Procurement product requests read"
ON public.product_requests
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((SELECT public.auth_user_has_permission('VIEW_PROCUREMENT')) OR (SELECT public.auth_user_has_permission('REQUEST_PRODUCTS')) OR (SELECT public.auth_user_has_permission('MANAGE_PROCUREMENT'))));

DROP POLICY IF EXISTS "Procurement product requests requester update" ON public.product_requests;
CREATE POLICY "Procurement product requests requester update"
ON public.product_requests
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (((requester_id = auth.uid()) AND (status = 'pending'::text) AND (SELECT public.auth_user_has_permission('REQUEST_PRODUCTS'))))
WITH CHECK (((requester_id = auth.uid()) AND (linked_shipment_id IS NULL) AND (status = ANY (ARRAY['pending'::text, 'closed'::text]))));

-- Movimientos de inventario: antes admin y jefe por rol; ahora quien ve el analisis de stock.
DROP POLICY IF EXISTS "Inventory movements read managers" ON public.inventory_movements;
CREATE POLICY "Inventory movements read managers"
ON public.inventory_movements
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((SELECT public.auth_user_has_permission('VIEW_INVENTORY_ANALYTICS')));

DROP POLICY IF EXISTS "Inventory movements insert managers" ON public.inventory_movements;
CREATE POLICY "Inventory movements insert managers"
ON public.inventory_movements
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.auth_user_has_permission('VIEW_INVENTORY_ANALYTICS')));

CREATE OR REPLACE FUNCTION public.apply_inventory_manual_adjustment(p_inventory_id uuid, p_new_stock_qty integer, p_reason_code text, p_reason_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_id uuid := auth.uid();
    v_item public.inventory%ROWTYPE;
    v_next_stock integer := greatest(coalesce(p_new_stock_qty, 0), 0);
    v_diff integer;
    v_movement_type text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT (public.auth_user_has_permission('MANAGE_INVENTORY') AND public.auth_user_has_permission('VIEW_INVENTORY_ANALYTICS')) THEN
        RAISE EXCEPTION 'No tienes permisos para ajustar stock';
    END IF;

    IF nullif(trim(coalesce(p_reason_code, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Debes indicar un motivo';
    END IF;

    SELECT *
    INTO v_item
    FROM public.inventory
    WHERE id = p_inventory_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado';
    END IF;

    IF coalesce(v_item.is_service_item, false) THEN
        RAISE EXCEPTION 'No se puede ajustar stock de un producto de servicio';
    END IF;

    v_diff := v_next_stock - coalesce(v_item.stock_qty, 0);

    IF v_diff = 0 THEN
        RETURN jsonb_build_object(
            'ok', true,
            'changed', false,
            'inventory_id', v_item.id,
            'stock_qty', coalesce(v_item.stock_qty, 0)
        );
    END IF;

    UPDATE public.inventory
    SET stock_qty = v_next_stock,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = v_actor_id
    WHERE id = v_item.id;

    v_movement_type := CASE
        WHEN v_diff > 0 THEN 'manual_adjustment_increase'
        ELSE 'manual_adjustment_decrease'
    END;

    PERFORM public.append_inventory_movement(
        p_inventory_id => v_item.id,
        p_movement_type => v_movement_type,
        p_direction => 'adjust',
        p_qty => abs(v_diff),
        p_stock_before => coalesce(v_item.stock_qty, 0),
        p_stock_after => v_next_stock,
        p_reason_code => lower(trim(p_reason_code)),
        p_reason_note => p_reason_note,
        p_unit_price_snapshot => v_item.price,
        p_source_table => 'inventory',
        p_source_id => v_item.id,
        p_performed_by => v_actor_id
    );

    RETURN jsonb_build_object(
        'ok', true,
        'changed', true,
        'inventory_id', v_item.id,
        'stock_before', coalesce(v_item.stock_qty, 0),
        'stock_after', v_next_stock,
        'qty_delta', v_diff
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_inventory_manual_receipt(p_shipment_id uuid DEFAULT NULL::uuid, p_lines jsonb DEFAULT '[]'::jsonb, p_reason_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_id uuid := auth.uid();
    v_processed integer := 0;
    v_total_units integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT ((public.auth_user_has_permission('MANAGE_INVENTORY') AND public.auth_user_has_permission('VIEW_INVENTORY_ANALYTICS')) OR public.auth_user_has_permission('RECEIVE_IMPORTS')) THEN
        RAISE EXCEPTION 'No tienes permisos para registrar ingresos a stock';
    END IF;

    IF jsonb_typeof(p_lines) <> 'array' THEN
        RAISE EXCEPTION 'p_lines debe ser un arreglo JSON';
    END IF;

    CREATE TEMP TABLE tmp_receipt_lines (
        line_no integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        inventory_id uuid NOT NULL,
        qty integer NOT NULL,
        shipment_item_id uuid NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_receipt_lines (inventory_id, qty, shipment_item_id)
    SELECT
        nullif(trim(coalesce(value->>'inventory_id', '')), '')::uuid,
        greatest(coalesce(nullif(trim(coalesce(value->>'qty', '')), '')::integer, 0), 0),
        CASE
            WHEN nullif(trim(coalesce(value->>'shipment_item_id', '')), '') IS NULL THEN NULL
            ELSE (value->>'shipment_item_id')::uuid
        END
    FROM jsonb_array_elements(p_lines) AS value;

    DELETE FROM tmp_receipt_lines
    WHERE inventory_id IS NULL OR qty <= 0;

    SELECT count(*), coalesce(sum(qty), 0)
    INTO v_processed, v_total_units
    FROM tmp_receipt_lines;

    IF v_processed = 0 THEN
        RAISE EXCEPTION 'No se encontraron líneas válidas para ingreso de stock';
    END IF;

    IF p_shipment_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1
            FROM tmp_receipt_lines
            WHERE shipment_item_id IS NULL
        ) THEN
            RAISE EXCEPTION 'Si vinculas un embarque, cada línea debe indicar shipment_item_id';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM tmp_receipt_lines l
            LEFT JOIN public.inbound_shipment_items si
              ON si.id = l.shipment_item_id
            WHERE si.id IS NULL
               OR si.shipment_id <> p_shipment_id
        ) THEN
            RAISE EXCEPTION 'Hay líneas que no pertenecen al embarque seleccionado';
        END IF;
    END IF;

    CREATE TEMP TABLE tmp_receipt_base ON COMMIT DROP AS
    SELECT
        l.line_no,
        l.inventory_id,
        l.qty,
        l.shipment_item_id,
        coalesce(i.stock_qty, 0)::integer AS stock_before,
        coalesce(i.price, 0) AS unit_price_snapshot,
        coalesce(i.is_service_item, false) AS is_service_item,
        si.product_id AS shipment_product_id,
        si.qty AS shipment_qty,
        coalesce(received.total_received, 0)::integer AS already_received
    FROM tmp_receipt_lines l
    JOIN public.inventory i
      ON i.id = l.inventory_id
    LEFT JOIN public.inbound_shipment_items si
      ON si.id = l.shipment_item_id
    LEFT JOIN (
        SELECT
            source_id AS shipment_item_id,
            sum(qty)::integer AS total_received
        FROM public.inventory_movements
        WHERE movement_type = 'manual_receipt_increase'
          AND source_table = 'inbound_shipment_items'
          AND source_id IS NOT NULL
        GROUP BY source_id
    ) received
      ON received.shipment_item_id = l.shipment_item_id
    FOR UPDATE OF i;

    IF EXISTS (
        SELECT 1
        FROM tmp_receipt_base
        WHERE is_service_item = true
    ) THEN
        RAISE EXCEPTION 'No se puede ingresar stock para productos de servicio';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_receipt_base
        WHERE shipment_item_id IS NOT NULL
          AND shipment_product_id IS NOT NULL
          AND shipment_product_id <> inventory_id
    ) THEN
        RAISE EXCEPTION 'Una o más líneas del embarque no corresponden al producto seleccionado';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_receipt_base
        WHERE shipment_item_id IS NOT NULL
          AND qty > greatest(shipment_qty - already_received, 0)
    ) THEN
        RAISE EXCEPTION 'Una o más líneas exceden la cantidad pendiente del embarque';
    END IF;

    UPDATE public.inventory i
    SET stock_qty = coalesce(i.stock_qty, 0) + movement.total_qty,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = v_actor_id
    FROM (
        SELECT inventory_id, sum(qty)::integer AS total_qty
        FROM tmp_receipt_base
        GROUP BY inventory_id
    ) movement
    WHERE i.id = movement.inventory_id;

    INSERT INTO public.inventory_movements (
        inventory_id,
        movement_type,
        direction,
        qty,
        stock_before,
        stock_after,
        unit_price_snapshot,
        reason_code,
        reason_note,
        source_table,
        source_id,
        shipment_id,
        performed_by
    )
    SELECT
        base.inventory_id,
        'manual_receipt_increase',
        'in',
        base.qty,
        base.stock_before + coalesce(sum(base.qty) OVER (
            PARTITION BY base.inventory_id
            ORDER BY base.line_no
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0),
        base.stock_before + sum(base.qty) OVER (
            PARTITION BY base.inventory_id
            ORDER BY base.line_no
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ),
        base.unit_price_snapshot,
        'shipment_received',
        p_reason_note,
        CASE
            WHEN base.shipment_item_id IS NOT NULL THEN 'inbound_shipment_items'
            ELSE 'inventory_manual_receipt'
        END,
        base.shipment_item_id,
        p_shipment_id,
        v_actor_id
    FROM tmp_receipt_base base
    ORDER BY base.inventory_id, base.line_no;

    RETURN jsonb_build_object(
        'ok', true,
        'processed_lines', v_processed,
        'total_units', v_total_units,
        'shipment_id', p_shipment_id
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_inventory_rotation_metrics(p_days integer DEFAULT 30, p_search text DEFAULT NULL::text, p_only_alerts boolean DEFAULT false)
 RETURNS TABLE(inventory_id uuid, sku text, name text, category text, stock_qty integer, min_stock_alert integer, target_coverage_days integer, units_sold_window integer, avg_daily_sales numeric, days_of_coverage numeric, suggested_reorder_qty integer, alert_level text, last_sale_at timestamp with time zone, sales_count_window integer, has_open_request boolean, linked_open_request_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_days integer := greatest(coalesce(p_days, 30), 1);
BEGIN
    IF NOT public.auth_user_has_permission('VIEW_INVENTORY_ANALYTICS') THEN
        RAISE EXCEPTION 'No tienes permisos para ver rotación de inventario';
    END IF;

    RETURN QUERY
    WITH inventory_base AS (
        SELECT
            i.id,
            coalesce(i.sku, '') AS sku,
            i.name,
            coalesce(i.category, 'General') AS category,
            coalesce(i.stock_qty, 0)::integer AS stock_qty,
            coalesce(i.min_stock_alert, 5)::integer AS min_stock_alert,
            coalesce(i.target_coverage_days, 30)::integer AS target_coverage_days
        FROM public.inventory i
        WHERE coalesce(i.is_service_item, false) = false
    ),
    sales_window AS (
        SELECT
            oi.product_id AS inventory_id,
            coalesce(sum(oi.quantity), 0)::integer AS units_sold_window,
            count(*)::integer AS sales_count_window,
            max(o.created_at) AS last_sale_at
        FROM public.order_items oi
        JOIN public.orders o
          ON o.id = oi.order_id
        JOIN public.inventory i
          ON i.id = oi.product_id
        WHERE coalesce(i.is_service_item, false) = false
          AND o.created_at >= now() - make_interval(days => v_days)
          AND lower(coalesce(o.status, 'completed')) <> 'cancelled'
        GROUP BY oi.product_id
    ),
    latest_open_request AS (
        SELECT DISTINCT ON (pr.product_id)
            pr.product_id AS inventory_id,
            pr.id,
            pr.status
        FROM public.product_requests pr
        WHERE pr.product_id IS NOT NULL
          AND pr.status IN ('pending', 'in_purchase', 'included')
        ORDER BY pr.product_id, pr.created_at DESC
    ),
    metrics AS (
        SELECT
            ib.id AS inventory_id,
            ib.sku,
            ib.name,
            ib.category,
            ib.stock_qty,
            ib.min_stock_alert,
            ib.target_coverage_days,
            coalesce(sw.units_sold_window, 0)::integer AS units_sold_window,
            round((coalesce(sw.units_sold_window, 0)::numeric / v_days::numeric), 2) AS avg_daily_sales,
            CASE
                WHEN coalesce(sw.units_sold_window, 0) > 0
                    THEN round(ib.stock_qty::numeric / (coalesce(sw.units_sold_window, 0)::numeric / v_days::numeric), 1)
                ELSE NULL
            END AS days_of_coverage,
            greatest(
                0,
                greatest(
                    ib.min_stock_alert,
                    ceil((coalesce(sw.units_sold_window, 0)::numeric / v_days::numeric) * ib.target_coverage_days)::integer
                ) - ib.stock_qty
            )::integer AS suggested_reorder_qty,
            CASE
                WHEN ib.stock_qty <= 0 THEN 'critical'
                WHEN ib.stock_qty <= ib.min_stock_alert THEN 'low'
                WHEN coalesce(sw.units_sold_window, 0) > 0
                  AND (ib.stock_qty::numeric / (coalesce(sw.units_sold_window, 0)::numeric / v_days::numeric)) <= 7
                    THEN 'warning'
                ELSE 'healthy'
            END AS alert_level,
            sw.last_sale_at,
            coalesce(sw.sales_count_window, 0)::integer AS sales_count_window,
            (lor.id IS NOT NULL) AS has_open_request,
            lor.id AS linked_open_request_id
        FROM inventory_base ib
        LEFT JOIN sales_window sw
          ON sw.inventory_id = ib.id
        LEFT JOIN latest_open_request lor
          ON lor.inventory_id = ib.id
    )
    SELECT *
    FROM metrics
    WHERE (
        nullif(trim(coalesce(p_search, '')), '') IS NULL
        OR lower(metrics.sku) LIKE '%' || lower(trim(p_search)) || '%'
        OR lower(metrics.name) LIKE '%' || lower(trim(p_search)) || '%'
        OR lower(metrics.category) LIKE '%' || lower(trim(p_search)) || '%'
    )
      AND (
        NOT coalesce(p_only_alerts, false)
        OR metrics.alert_level <> 'healthy'
      )
    ORDER BY
        CASE metrics.alert_level
            WHEN 'critical' THEN 1
            WHEN 'low' THEN 2
            WHEN 'warning' THEN 3
            ELSE 4
        END,
        metrics.suggested_reorder_qty DESC,
        metrics.name ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_inventory_manual_price(p_inventory_id uuid, p_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor_id uuid := auth.uid();
    v_item public.inventory%ROWTYPE;
    v_next_price numeric := greatest(coalesce(p_price, 0), 0);
    v_sku text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('MANAGE_PRICING') THEN
        RAISE EXCEPTION 'No tienes permisos para actualizar precios';
    END IF;

    SELECT *
    INTO v_item
    FROM public.inventory
    WHERE id = p_inventory_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado';
    END IF;

    UPDATE public.inventory
    SET price = v_next_price
    WHERE id = v_item.id;

    v_sku := upper(trim(coalesce(v_item.sku, '')));

    IF v_sku <> '' THEN
        INSERT INTO public.inventory_price_catalog (
            sku,
            product_name,
            price,
            created_at,
            updated_at
        )
        VALUES (
            v_sku,
            nullif(trim(coalesce(v_item.name, '')), ''),
            v_next_price,
            timezone('utc', now()),
            timezone('utc', now())
        )
        ON CONFLICT (sku) DO UPDATE
        SET product_name = COALESCE(EXCLUDED.product_name, public.inventory_price_catalog.product_name),
            price = EXCLUDED.price,
            updated_at = timezone('utc', now());
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'inventory_id', v_item.id,
        'sku', nullif(v_sku, ''),
        'price', v_next_price
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_woo_stock_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT;
BEGIN
    SELECT lower(coalesce(role, '')) INTO v_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF NOT public.auth_user_has_permission('MANAGE_WEB_STORE') THEN
        RAISE EXCEPTION 'Solo un administrador puede administrar la tienda web.'
            USING ERRCODE = '42501';
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_meta_lead_credential(p_key text, p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_role TEXT;
BEGIN
    SELECT lower(coalesce(role, '')) INTO v_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF NOT public.auth_user_has_permission('MANAGE_META_INTEGRATION') THEN
        RAISE EXCEPTION 'Solo un administrador puede configurar la integración con Meta.'
            USING ERRCODE = '42501';
    END IF;

    IF nullif(btrim(coalesce(p_value, '')), '') IS NULL THEN
        DELETE FROM public.meta_lead_credentials WHERE key = p_key;
        RETURN jsonb_build_object('key', p_key, 'configurado', false);
    END IF;

    INSERT INTO public.meta_lead_credentials (key, value, updated_by)
    VALUES (p_key, btrim(p_value), auth.uid())
    ON CONFLICT (key) DO UPDATE
    SET value = excluded.value,
        updated_at = timezone('utc', now()),
        updated_by = excluded.updated_by;

    RETURN jsonb_build_object('key', p_key, 'configurado', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_collection_seller(p_collection_id uuid, p_seller_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_actor_can_manage_collections boolean := false;
  v_actor_can_manage_clients boolean := false;
  v_collection public.collections_pending%ROWTYPE;
  v_seller public.profiles%ROWTYPE;
  v_normalized_rut text;
  v_updated_documents integer := 0;
  v_updated_clients integer := 0;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT lower(coalesce(p.role, '')) INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE lower(coalesce(rp.role, '')) = lower(coalesce(v_actor_role, ''))
      AND rp.permission = 'MANAGE_COLLECTIONS'
  ) INTO v_actor_can_manage_collections;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE lower(coalesce(rp.role, '')) = lower(coalesce(v_actor_role, ''))
      AND rp.permission = 'MANAGE_CLIENTS'
  ) INTO v_actor_can_manage_clients;

  IF NOT public.auth_user_has_permission('ASSIGN_CLIENTS') THEN
    RAISE EXCEPTION 'Sin permisos para asignar vendedor en cobranzas';
  END IF;

  SELECT * INTO v_collection
  FROM public.collections_pending
  WHERE id = p_collection_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento de cobranza no encontrado';
  END IF;

  SELECT * INTO v_seller
  FROM public.profiles
  WHERE id = p_seller_id
    AND lower(COALESCE(role, '')) IN ('seller', 'jefe', 'manager', 'admin')
    AND COALESCE(status, 'active') = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendedor inválido o inactivo';
  END IF;

  v_normalized_rut := regexp_replace(lower(COALESCE(v_collection.client_rut, '')), '[^0-9k]', '', 'g');

  IF v_normalized_rut <> '' THEN
    UPDATE public.collections_pending cp
    SET seller_id = v_seller.id,
        seller_email = lower(v_seller.email),
        seller_name = COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1))
    WHERE regexp_replace(lower(COALESCE(cp.client_rut, '')), '[^0-9k]', '', 'g') = v_normalized_rut;

    GET DIAGNOSTICS v_updated_documents = ROW_COUNT;

    UPDATE public.clients c
    SET created_by = v_seller.id,
        pending_seller_email = NULL,
        updated_at = now()
    WHERE regexp_replace(lower(COALESCE(c.rut, '')), '[^0-9k]', '', 'g') = v_normalized_rut;

    GET DIAGNOSTICS v_updated_clients = ROW_COUNT;
  ELSE
    UPDATE public.collections_pending cp
    SET seller_id = v_seller.id,
        seller_email = lower(v_seller.email),
        seller_name = COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1))
    WHERE cp.id = p_collection_id;

    GET DIAGNOSTICS v_updated_documents = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'seller_id', v_seller.id,
    'seller_email', lower(v_seller.email),
    'seller_name', COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1)),
    'updated_documents', v_updated_documents,
    'updated_clients', v_updated_clients
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_see_collection(p_seller_id uuid, p_seller_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_actor uuid := auth.uid();
    v_role text;
    v_email text;
BEGIN
    IF v_actor IS NULL THEN
        RETURN false;
    END IF;

    SELECT lower(coalesce(p.role, '')), lower(btrim(coalesce(p.email, '')))
    INTO v_role, v_email
    FROM public.profiles p
    WHERE p.id = v_actor;

    -- Misma normalizacion de roles historicos que aplica la aplicacion.
    v_role := CASE v_role
        WHEN 'manager' THEN 'admin'
        WHEN 'administrativo' THEN 'facturador'
        WHEN 'supervisor' THEN 'jefe'
        ELSE v_role
    END;

    IF public.auth_user_has_permission('VIEW_ALL_COLLECTIONS') THEN
        RETURN true;
    END IF;

    IF NOT public.auth_user_has_permission('VIEW_COLLECTIONS') THEN
        RETURN false;
    END IF;

    RETURN p_seller_id = v_actor
        OR (
            p_seller_email IS NOT NULL
            AND v_email <> ''
            AND lower(btrim(p_seller_email)) = v_email
        );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.stage_collections_pending_rows(p_session_id uuid, p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_base_order integer;
  v_inserted integer;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows debe ser un arreglo JSON';
  END IF;

  IF NOT public.auth_user_has_permission('MANAGE_COLLECTIONS') THEN
    RAISE EXCEPTION 'Sin permisos para cargar cobranzas';
  END IF;

  SELECT COALESCE(MAX(row_order), 0) INTO v_base_order
  FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  INSERT INTO public.collections_import_staging_rows (session_id, row_order, row_payload)
  SELECT
    p_session_id,
    v_base_order + element.ordinality::integer,
    element.value
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS element(value, ordinality);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.stage_collections_pending_rows_text(p_session_id uuid, p_rows_text text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_base_order integer;
  v_inserted integer;
  v_rows jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
  END IF;

  IF p_rows_text IS NULL OR btrim(p_rows_text) = '' THEN
    RAISE EXCEPTION 'p_rows_text requerido';
  END IF;

  BEGIN
    v_rows := p_rows_text::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'p_rows_text inválido';
  END;

  IF jsonb_typeof(v_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows_text debe serializar un arreglo JSON';
  END IF;

  IF NOT public.auth_user_has_permission('MANAGE_COLLECTIONS') THEN
    RAISE EXCEPTION 'Sin permisos para cargar cobranzas';
  END IF;

  SELECT COALESCE(MAX(row_order), 0) INTO v_base_order
  FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  INSERT INTO public.collections_import_staging_rows (session_id, row_order, row_payload)
  SELECT
    p_session_id,
    v_base_order + element.ordinality::integer,
    element.value
  FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS element(value, ordinality);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_collections_pending_upload(p_session_id uuid, p_file_name text, p_uploaded_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_rows jsonb;
  v_batch_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
  END IF;

  IF NOT public.auth_user_has_permission('MANAGE_COLLECTIONS') THEN
    RAISE EXCEPTION 'Sin permisos para cargar cobranzas';
  END IF;

  SELECT jsonb_agg(row_payload ORDER BY row_order) INTO v_rows
  FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  IF v_rows IS NULL OR jsonb_array_length(v_rows) = 0 THEN
    RAISE EXCEPTION 'No hay filas staged para esta carga';
  END IF;

  v_batch_id := public.replace_collections_pending(p_file_name, p_uploaded_by, v_rows);

  DELETE FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  RETURN v_batch_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.discard_collections_pending_upload(p_session_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_deleted integer;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
  END IF;

  IF NOT public.auth_user_has_permission('MANAGE_COLLECTIONS') THEN
    RAISE EXCEPTION 'Sin permisos para cargar cobranzas';
  END IF;

  DELETE FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_inventory_pricing_import(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_stored_count integer := 0;
    v_synced_count integer := 0;
    v_catalog_only_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('UPLOAD_EXCEL') THEN
        RAISE EXCEPTION 'No tienes permisos para importar precios';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'p_items debe ser un arreglo JSON';
    END IF;

    CREATE TEMP TABLE tmp_pricing_import (
        sku text PRIMARY KEY,
        price numeric NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_pricing_import (sku, price)
    SELECT DISTINCT ON (sku)
        sku,
        price
    FROM (
        SELECT
            public.normalize_inventory_sku(value->>'sku') AS sku,
            public.parse_inventory_import_price(value->>'price') AS price
        FROM jsonb_array_elements(p_items) AS value
    ) src
    WHERE sku <> ''
      AND price IS NOT NULL
    ORDER BY sku;

    IF NOT EXISTS (SELECT 1 FROM tmp_pricing_import) THEN
        RAISE EXCEPTION 'No se encontraron datos válidos para importar precios';
    END IF;

    CREATE TEMP TABLE tmp_inventory_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.id,
        ranked.name
    FROM (
        SELECT
            public.normalize_inventory_sku(i.sku) AS normalized_sku,
            i.id,
            i.name,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(i.sku)
                ORDER BY
                    CASE WHEN i.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN i.supplier_id IS NOT NULL THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(i.price, 0) > 0 THEN 0 ELSE 1 END,
                    i.created_at ASC,
                    i.id ASC
            ) AS rn
        FROM public.inventory i
        WHERE public.normalize_inventory_sku(i.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_inventory_match (normalized_sku);

    CREATE TEMP TABLE tmp_catalog_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.sku,
        ranked.product_name
    FROM (
        SELECT
            public.normalize_inventory_sku(c.sku) AS normalized_sku,
            c.sku,
            c.product_name,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(c.sku)
                ORDER BY
                    CASE WHEN c.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(c.price, 0) > 0 THEN 0 ELSE 1 END,
                    c.updated_at DESC,
                    c.created_at ASC,
                    c.sku ASC
            ) AS rn
        FROM public.inventory_price_catalog c
        WHERE public.normalize_inventory_sku(c.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_catalog_match (normalized_sku);

    CREATE TEMP TABLE tmp_pricing_apply ON COMMIT DROP AS
    SELECT
        coalesce(c.sku, p.sku) AS catalog_sku,
        p.sku AS normalized_sku,
        p.price,
        i.id AS inventory_id,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), c.product_name) AS product_name
    FROM tmp_pricing_import p
    LEFT JOIN tmp_inventory_match i
      ON i.normalized_sku = p.sku
    LEFT JOIN tmp_catalog_match c
      ON c.normalized_sku = p.sku;

    INSERT INTO public.inventory_price_catalog (
        sku,
        product_name,
        price,
        created_at,
        updated_at
    )
    SELECT
        catalog_sku,
        product_name,
        price,
        timezone('utc', now()),
        timezone('utc', now())
    FROM tmp_pricing_apply
    ON CONFLICT (sku) DO UPDATE
    SET product_name = coalesce(excluded.product_name, public.inventory_price_catalog.product_name),
        price = excluded.price,
        updated_at = timezone('utc', now());
    GET DIAGNOSTICS v_stored_count = ROW_COUNT;

    UPDATE public.inventory i
    SET price = a.price
    FROM tmp_pricing_apply a
    WHERE i.id = a.inventory_id;
    GET DIAGNOSTICS v_synced_count = ROW_COUNT;

    SELECT count(*)
    INTO v_catalog_only_count
    FROM tmp_pricing_apply
    WHERE inventory_id IS NULL;

    RETURN jsonb_build_object(
        'stored_count', v_stored_count,
        'synced_inventory_count', v_synced_count,
        'catalog_only_count', v_catalog_only_count
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.replace_inventory_stock_import(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_processed_count integer := 0;
    v_deleted_count integer := 0;
    v_preserved_count integer := 0;
    v_changed_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_permission('UPLOAD_EXCEL') THEN
        RAISE EXCEPTION 'No tienes permisos para importar inventario';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'p_items debe ser un arreglo JSON';
    END IF;

    CREATE TEMP TABLE tmp_stock_import (
        sku text PRIMARY KEY,
        name text NOT NULL,
        stock_qty integer NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO tmp_stock_import (sku, name, stock_qty)
    SELECT DISTINCT ON (sku)
        sku,
        name,
        stock_qty
    FROM (
        SELECT
            public.normalize_inventory_sku(value->>'sku') AS sku,
            trim(coalesce(value->>'name', '')) AS name,
            CASE
                WHEN jsonb_typeof(value->'stock_qty') = 'number' THEN greatest(floor((value->>'stock_qty')::numeric)::integer, 0)
                WHEN regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g') ~ '^-?[0-9]+$'
                    THEN greatest((regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g'))::integer, 0)
                ELSE 0
            END AS stock_qty
        FROM jsonb_array_elements(p_items) AS value
    ) src
    WHERE sku <> ''
      AND name <> ''
    ORDER BY sku;

    SELECT count(*) INTO v_processed_count FROM tmp_stock_import;

    IF v_processed_count = 0 THEN
        RAISE EXCEPTION 'No se encontraron datos válidos para importar stock';
    END IF;

    CREATE TEMP TABLE tmp_inventory_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.id,
        ranked.sku,
        ranked.name,
        ranked.stock_qty,
        ranked.price,
        ranked.category,
        ranked.min_stock_alert,
        ranked.target_coverage_days
    FROM (
        SELECT
            public.normalize_inventory_sku(i.sku) AS normalized_sku,
            i.*,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(i.sku)
                ORDER BY
                    CASE WHEN i.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN i.supplier_id IS NOT NULL THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(i.price, 0) > 0 THEN 0 ELSE 1 END,
                    i.created_at ASC,
                    i.id ASC
            ) AS rn
        FROM public.inventory i
        WHERE public.normalize_inventory_sku(i.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_inventory_match (normalized_sku);

    CREATE TEMP TABLE tmp_catalog_match ON COMMIT DROP AS
    SELECT
        ranked.normalized_sku,
        ranked.price
    FROM (
        SELECT
            public.normalize_inventory_sku(pc.sku) AS normalized_sku,
            pc.price,
            row_number() OVER (
                PARTITION BY public.normalize_inventory_sku(pc.sku)
                ORDER BY
                    CASE WHEN pc.sku LIKE '''%' THEN 0 ELSE 1 END,
                    CASE WHEN coalesce(pc.price, 0) > 0 THEN 0 ELSE 1 END,
                    pc.updated_at DESC,
                    pc.created_at ASC,
                    pc.sku ASC
            ) AS rn
        FROM public.inventory_price_catalog pc
        WHERE public.normalize_inventory_sku(pc.sku) <> ''
    ) ranked
    WHERE ranked.rn = 1;

    CREATE INDEX ON tmp_catalog_match (normalized_sku);

    CREATE TEMP TABLE tmp_stock_existing ON COMMIT DROP AS
    SELECT
        t.sku,
        t.name,
        t.stock_qty,
        coalesce(i.id, gen_random_uuid()) AS inventory_id,
        i.id AS existing_id,
        coalesce(i.stock_qty, 0)::integer AS stock_before,
        coalesce(pc.price, i.price, 0) AS price,
        coalesce(i.category, 'General') AS category,
        coalesce(i.min_stock_alert, 5)::integer AS min_stock_alert,
        coalesce(i.target_coverage_days, 30)::integer AS target_coverage_days,
        coalesce(nullif(trim(coalesce(i.sku, '')), ''), t.sku) AS target_sku,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), t.name) AS target_name
    FROM tmp_stock_import t
    LEFT JOIN tmp_inventory_match i
      ON i.normalized_sku = t.sku
    LEFT JOIN tmp_catalog_match pc
      ON pc.normalized_sku = t.sku;

    INSERT INTO public.inventory (
        id,
        sku,
        name,
        stock_qty,
        price,
        category,
        is_service_item,
        min_stock_alert,
        target_coverage_days,
        last_stock_reviewed_at,
        last_stock_reviewed_by
    )
    SELECT
        inventory_id,
        target_sku,
        target_name,
        stock_qty,
        price,
        category,
        false,
        min_stock_alert,
        target_coverage_days,
        now(),
        auth.uid()
    FROM tmp_stock_existing
    ON CONFLICT (id) DO UPDATE
    SET sku = excluded.sku,
        name = excluded.name,
        stock_qty = excluded.stock_qty,
        price = excluded.price,
        category = excluded.category,
        min_stock_alert = excluded.min_stock_alert,
        target_coverage_days = excluded.target_coverage_days,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid();

    INSERT INTO public.inventory_movements (
        inventory_id,
        movement_type,
        direction,
        qty,
        stock_before,
        stock_after,
        unit_price_snapshot,
        reason_code,
        reason_note,
        source_table,
        source_id,
        performed_by
    )
    SELECT
        tse.inventory_id,
        'manual_correction',
        'adjust',
        abs(tse.stock_qty - tse.stock_before),
        tse.stock_before,
        tse.stock_qty,
        tse.price,
        'stock_count',
        'Importación masiva de stock',
        'inventory_stock_import',
        null,
        auth.uid()
    FROM tmp_stock_existing tse
    WHERE tse.existing_id IS NOT NULL
      AND tse.stock_before <> tse.stock_qty;

    GET DIAGNOSTICS v_changed_count = ROW_COUNT;

    CREATE TEMP TABLE tmp_order_outbound_inventory (
        inventory_id uuid PRIMARY KEY
    ) ON COMMIT DROP;

    INSERT INTO tmp_order_outbound_inventory (inventory_id)
    SELECT DISTINCT im.inventory_id
    FROM public.inventory_movements im
    WHERE im.inventory_id IS NOT NULL
      AND im.direction = 'out'
      AND im.source_table = 'order_items';

    CREATE TEMP TABLE tmp_unlisted_inventory ON COMMIT DROP AS
    SELECT
        i.id,
        (order_outbound.inventory_id IS NOT NULL) AS has_order_outbound
    FROM public.inventory i
    LEFT JOIN tmp_stock_import t
      ON t.sku = public.normalize_inventory_sku(i.sku)
    LEFT JOIN tmp_order_outbound_inventory order_outbound
      ON order_outbound.inventory_id = i.id
    WHERE t.sku IS NULL
      AND coalesce(i.stock_qty, 0) <> 0
      AND coalesce(i.is_service_item, false) = false;

    UPDATE public.inventory i
    SET stock_qty = 0,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid()
    FROM tmp_unlisted_inventory u
    WHERE i.id = u.id
      AND u.has_order_outbound;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    UPDATE public.inventory i
    SET stock_qty = 0,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid()
    FROM tmp_unlisted_inventory u
    WHERE i.id = u.id
      AND NOT u.has_order_outbound;

    GET DIAGNOSTICS v_preserved_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'processed_count', v_processed_count,
        'deleted_count', v_deleted_count,
        'preserved_historical_count', v_preserved_count,
        'changed_count', v_changed_count
    );
END;
$function$
;

NOTIFY pgrst, 'reload schema';
