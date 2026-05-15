ALTER TABLE public.inventory
ADD COLUMN IF NOT EXISTS min_stock_alert integer,
ADD COLUMN IF NOT EXISTS target_coverage_days integer,
ADD COLUMN IF NOT EXISTS last_stock_reviewed_at timestamptz,
ADD COLUMN IF NOT EXISTS last_stock_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.inventory
SET min_stock_alert = COALESCE(min_stock_alert, 5),
    target_coverage_days = COALESCE(target_coverage_days, 30);

ALTER TABLE public.inventory
ALTER COLUMN min_stock_alert SET DEFAULT 5,
ALTER COLUMN min_stock_alert SET NOT NULL,
ALTER COLUMN target_coverage_days SET DEFAULT 30,
ALTER COLUMN target_coverage_days SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
    movement_type text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('in', 'out', 'adjust')),
    qty integer NOT NULL CHECK (qty > 0),
    stock_before integer NOT NULL,
    stock_after integer NOT NULL,
    unit_price_snapshot numeric,
    reason_code text NOT NULL,
    reason_note text,
    source_table text,
    source_id uuid,
    shipment_id uuid REFERENCES public.inbound_shipments(id) ON DELETE SET NULL,
    order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
    performed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_inventory_created_at
    ON public.inventory_movements (inventory_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_order_id
    ON public.inventory_movements (order_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_shipment_id
    ON public.inventory_movements (shipment_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_performed_by
    ON public.inventory_movements (performed_by, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_sale_order_item_unique
    ON public.inventory_movements (order_item_id)
    WHERE order_item_id IS NOT NULL AND movement_type = 'sale_outbound';

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;

CREATE OR REPLACE FUNCTION public.auth_user_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        JOIN public.role_permissions rp
          ON rp.role = lower(coalesce(p.role, ''))
         AND rp.permission = p_permission
        WHERE p.id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.auth_user_has_any_role(p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) = ANY (p_roles)
    );
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_has_any_role(text[]) TO authenticated;

DROP POLICY IF EXISTS "Inventory movements read managers" ON public.inventory_movements;
CREATE POLICY "Inventory movements read managers"
ON public.inventory_movements
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_any_role(ARRAY['admin', 'jefe'])
);

DROP POLICY IF EXISTS "Inventory movements insert managers" ON public.inventory_movements;
CREATE POLICY "Inventory movements insert managers"
ON public.inventory_movements
FOR INSERT
TO authenticated
WITH CHECK (
    public.auth_user_has_any_role(ARRAY['admin', 'jefe'])
);

CREATE OR REPLACE FUNCTION public.append_inventory_movement(
    p_inventory_id uuid,
    p_movement_type text,
    p_direction text,
    p_qty integer,
    p_stock_before integer,
    p_stock_after integer,
    p_reason_code text,
    p_reason_note text DEFAULT NULL,
    p_unit_price_snapshot numeric DEFAULT NULL,
    p_source_table text DEFAULT NULL,
    p_source_id uuid DEFAULT NULL,
    p_shipment_id uuid DEFAULT NULL,
    p_order_id uuid DEFAULT NULL,
    p_order_item_id uuid DEFAULT NULL,
    p_performed_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_inventory_id IS NULL THEN
        RAISE EXCEPTION 'inventory_id es obligatorio';
    END IF;

    IF p_qty IS NULL OR p_qty <= 0 THEN
        RAISE EXCEPTION 'qty debe ser mayor a 0';
    END IF;

    IF p_direction NOT IN ('in', 'out', 'adjust') THEN
        RAISE EXCEPTION 'direction inválido: %', p_direction;
    END IF;

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
        order_id,
        order_item_id,
        performed_by
    )
    VALUES (
        p_inventory_id,
        trim(coalesce(p_movement_type, '')),
        p_direction,
        p_qty,
        coalesce(p_stock_before, 0),
        coalesce(p_stock_after, 0),
        p_unit_price_snapshot,
        trim(coalesce(p_reason_code, 'other')),
        nullif(trim(coalesce(p_reason_note, '')), ''),
        nullif(trim(coalesce(p_source_table, '')), ''),
        p_source_id,
        p_shipment_id,
        p_order_id,
        p_order_item_id,
        coalesce(p_performed_by, auth.uid())
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_inventory_movement(uuid, text, text, integer, integer, integer, text, text, numeric, text, uuid, uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_rotation_metrics(
    p_days integer DEFAULT 30,
    p_search text DEFAULT NULL,
    p_only_alerts boolean DEFAULT false
)
RETURNS TABLE (
    inventory_id uuid,
    sku text,
    name text,
    category text,
    stock_qty integer,
    min_stock_alert integer,
    target_coverage_days integer,
    units_sold_window integer,
    avg_daily_sales numeric,
    days_of_coverage numeric,
    suggested_reorder_qty integer,
    alert_level text,
    last_sale_at timestamptz,
    sales_count_window integer,
    has_open_request boolean,
    linked_open_request_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_days integer := greatest(coalesce(p_days, 30), 1);
BEGIN
    IF NOT public.auth_user_has_any_role(ARRAY['admin', 'jefe']) THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_rotation_metrics(integer, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_inventory_manual_adjustment(
    p_inventory_id uuid,
    p_new_stock_qty integer,
    p_reason_code text,
    p_reason_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    IF NOT public.auth_user_has_any_role(ARRAY['admin', 'jefe']) THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.apply_inventory_manual_adjustment(uuid, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_inventory_manual_receipt(
    p_shipment_id uuid DEFAULT NULL,
    p_lines jsonb DEFAULT '[]'::jsonb,
    p_reason_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_processed integer := 0;
    v_total_units integer := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    IF NOT public.auth_user_has_any_role(ARRAY['admin', 'jefe']) THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.apply_inventory_manual_receipt(uuid, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.replace_inventory_stock_import(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
            upper(trim(coalesce(value->>'sku', ''))) AS sku,
            trim(coalesce(value->>'name', '')) AS name,
            CASE
                WHEN jsonb_typeof(value->'stock_qty') = 'number' THEN greatest(floor((value->>'stock_qty')::numeric)::integer, 0)
                ELSE
                    CASE
                        WHEN regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g') ~ '^-?[0-9]+$'
                            THEN greatest((regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g'))::integer, 0)
                        ELSE 0
                    END
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
        coalesce(i.target_coverage_days, 30)::integer AS target_coverage_days
    FROM tmp_stock_import t
    LEFT JOIN public.inventory i
      ON upper(trim(coalesce(i.sku, ''))) = t.sku
    LEFT JOIN public.inventory_price_catalog pc
      ON pc.sku = t.sku;

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
        sku,
        name,
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
    SET sku = EXCLUDED.sku,
        name = EXCLUDED.name,
        stock_qty = EXCLUDED.stock_qty,
        price = EXCLUDED.price,
        category = EXCLUDED.category,
        min_stock_alert = EXCLUDED.min_stock_alert,
        target_coverage_days = EXCLUDED.target_coverage_days,
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
        NULL,
        auth.uid()
    FROM tmp_stock_existing tse
    WHERE tse.existing_id IS NOT NULL
      AND tse.stock_before <> tse.stock_qty;
    GET DIAGNOSTICS v_changed_count = ROW_COUNT;

    CREATE TEMP TABLE tmp_obsolete_inventory ON COMMIT DROP AS
    SELECT
        i.id,
        coalesce(i.stock_qty, 0)::integer AS stock_before,
        coalesce(i.price, 0) AS price
    FROM public.inventory i
    WHERE coalesce(i.is_service_item, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM tmp_stock_import t
        WHERE t.sku = upper(trim(coalesce(i.sku, '')))
    );

    DELETE FROM public.inventory i
    USING tmp_obsolete_inventory o
    WHERE i.id = o.id
      AND NOT EXISTS (
          SELECT 1
          FROM public.order_items oi
          WHERE oi.product_id = o.id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM public.inventory_movements im
          WHERE im.inventory_id = o.id
      );
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    CREATE TEMP TABLE tmp_obsolete_keep ON COMMIT DROP AS
    SELECT o.*
    FROM tmp_obsolete_inventory o
    WHERE EXISTS (
        SELECT 1
        FROM public.inventory i
        WHERE i.id = o.id
    );

    UPDATE public.inventory i
    SET stock_qty = 0,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid()
    FROM tmp_obsolete_keep o
    WHERE i.id = o.id
      AND coalesce(i.stock_qty, 0) <> 0;

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
        o.id,
        'manual_correction',
        'adjust',
        abs(o.stock_before),
        o.stock_before,
        0,
        o.price,
        'stock_count',
        'Importación masiva de stock',
        'inventory_stock_import',
        NULL,
        auth.uid()
    FROM tmp_obsolete_keep o
    WHERE o.stock_before <> 0;

    SELECT count(*)
    INTO v_preserved_count
    FROM tmp_obsolete_keep;

    RETURN jsonb_build_object(
        'processed_count', v_processed_count,
        'deleted_count', v_deleted_count,
        'preserved_historical_count', v_preserved_count,
        'changed_count', v_changed_count
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_inventory_pricing_import(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
            upper(trim(coalesce(value->>'sku', ''))) AS sku,
            public.parse_inventory_import_price(value->>'price') AS price
        FROM jsonb_array_elements(p_items) AS value
    ) src
    WHERE sku <> ''
      AND price IS NOT NULL
    ORDER BY sku;

    IF NOT EXISTS (SELECT 1 FROM tmp_pricing_import) THEN
        RAISE EXCEPTION 'No se encontraron datos válidos para importar precios';
    END IF;

    CREATE TEMP TABLE tmp_pricing_apply ON COMMIT DROP AS
    SELECT
        p.sku,
        p.price,
        i.id AS inventory_id,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), c.product_name) AS product_name
    FROM tmp_pricing_import p
    LEFT JOIN public.inventory i
      ON upper(trim(coalesce(i.sku, ''))) = p.sku
    LEFT JOIN public.inventory_price_catalog c
      ON c.sku = p.sku;

    INSERT INTO public.inventory_price_catalog (
        sku,
        product_name,
        price,
        created_at,
        updated_at
    )
    SELECT
        sku,
        product_name,
        price,
        timezone('utc', now()),
        timezone('utc', now())
    FROM tmp_pricing_apply
    ON CONFLICT (sku) DO UPDATE
    SET product_name = COALESCE(EXCLUDED.product_name, public.inventory_price_catalog.product_name),
        price = EXCLUDED.price,
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
$$;

CREATE OR REPLACE FUNCTION public.convert_quotation_to_order(
    p_quotation_id uuid,
    p_user_id uuid,
    p_payment_proof_path text DEFAULT NULL,
    p_payment_proof_name text DEFAULT NULL,
    p_payment_proof_mime_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_quote public.quotations%ROWTYPE;
    v_existing_order_id uuid;
    v_existing_order_folio integer;
    v_existing_payment_email_status text;
    v_order_id uuid;
    v_order_folio integer;
    v_item jsonb;
    v_product_id uuid;
    v_qty integer;
    v_unit_price numeric;
    v_stock integer;
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_target_user_id uuid;
    v_item_product_id_raw text;
    v_item_code text;
    v_item_detail text;
    v_inserted_items integer := 0;
    v_client_credit_days integer := 0;
    v_payment_proof_path text := nullif(trim(coalesce(p_payment_proof_path, '')), '');
    v_payment_proof_name text := nullif(trim(coalesce(p_payment_proof_name, '')), '');
    v_payment_proof_mime_type text := nullif(trim(coalesce(p_payment_proof_mime_type, '')), '');
    v_is_service_item boolean := false;
    v_reserved_qty integer := 0;
BEGIN
    IF p_quotation_id IS NULL THEN
        RAISE EXCEPTION 'p_quotation_id es obligatorio';
    END IF;

    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    SELECT lower(coalesce(p.role, ''))
    INTO v_actor_role
    FROM public.profiles p
    WHERE p.id = v_actor_id;

    SELECT * INTO v_quote
    FROM public.quotations
    WHERE id = p_quotation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cotizacion no encontrada';
    END IF;

    IF v_quote.seller_id IS DISTINCT FROM v_actor_id
       AND coalesce(v_actor_role, '') NOT IN ('admin', 'facturador', 'administrativo') THEN
        RAISE EXCEPTION 'Solo el vendedor duenio, admin o facturacion pueden convertir la cotizacion a pedido';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.approval_requests ar
        WHERE ar.entity_id = v_quote.id
          AND ar.module = 'sales'
          AND ar.approval_type = 'extra_discount'
          AND ar.status IN ('pending', 'rejected')
    ) THEN
        RAISE EXCEPTION 'La cotizacion tiene una aprobacion de descuento pendiente o rechazada';
    END IF;

    SELECT id, folio, payment_email_status
    INTO v_existing_order_id, v_existing_order_folio, v_existing_payment_email_status
    FROM public.orders
    WHERE quotation_id = p_quotation_id
    LIMIT 1;

    IF v_existing_order_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'order_id', v_existing_order_id,
            'order_folio', v_existing_order_folio,
            'already_exists', true,
            'payment_email_status', coalesce(v_existing_payment_email_status, 'not_required')
        );
    END IF;

    SELECT coalesce(c.credit_days, 0)
    INTO v_client_credit_days
    FROM public.clients c
    WHERE c.id = v_quote.client_id;

    IF coalesce(v_client_credit_days, 0) = 0
       AND (v_payment_proof_path IS NULL OR v_payment_proof_name IS NULL) THEN
        RAISE EXCEPTION 'Debes adjuntar comprobante de pago para clientes sin credito';
    END IF;

    v_target_user_id := v_quote.seller_id;
    IF v_target_user_id IS NULL THEN
        v_target_user_id := coalesce(p_user_id, v_actor_id);
    END IF;

    IF v_target_user_id IS NULL THEN
        RAISE EXCEPTION 'No se pudo determinar el vendedor de la venta';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = v_target_user_id
    ) THEN
        RAISE EXCEPTION 'El vendedor asociado a la venta no existe';
    END IF;

    IF jsonb_typeof(v_quote.items) <> 'array' OR jsonb_array_length(v_quote.items) = 0 THEN
        RAISE EXCEPTION 'La cotizacion no tiene items validos para convertir';
    END IF;

    DROP TABLE IF EXISTS tmp_validated_order_items;
    CREATE TEMP TABLE tmp_validated_order_items (
        line_no integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        order_item_id uuid NOT NULL,
        product_id uuid NOT NULL,
        quantity integer NOT NULL,
        unit_price numeric NOT NULL,
        total_price numeric NOT NULL,
        is_service_item boolean NOT NULL DEFAULT false
    ) ON COMMIT DROP;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(v_quote.items)
    LOOP
        v_product_id := NULL;
        v_is_service_item := false;
        v_reserved_qty := 0;

        v_item_product_id_raw := trim(coalesce(v_item->>'product_id', ''));
        v_item_code := lower(trim(coalesce(v_item->>'code', '')));
        v_item_detail := lower(trim(coalesce(v_item->>'detail', '')));

        IF v_item_product_id_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            v_product_id := v_item_product_id_raw::uuid;
        END IF;

        IF v_product_id IS NULL AND v_item_code <> '' THEN
            SELECT i.id
            INTO v_product_id
            FROM public.inventory i
            WHERE lower(coalesce(i.sku, '')) = v_item_code
            LIMIT 1;
        END IF;

        IF v_product_id IS NULL AND v_item_detail <> '' THEN
            SELECT i.id
            INTO v_product_id
            FROM public.inventory i
            WHERE lower(coalesce(i.name, '')) = v_item_detail
            LIMIT 1;
        END IF;

        IF v_product_id IS NULL THEN
            RAISE EXCEPTION 'Item sin producto valido en inventario (%). Edita la cotizacion y selecciona el producto.', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END IF;

        BEGIN
            v_qty := greatest(coalesce(nullif(trim(v_item->>'qty'), '')::integer, 1), 1);
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Cantidad invalida en item %', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END;

        BEGIN
            v_unit_price := coalesce(
                nullif(trim(v_item->>'net_price'), '')::numeric,
                nullif(trim(v_item->>'price'), '')::numeric,
                0
            );
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Precio invalido en item %', coalesce(v_item->>'detail', v_item->>'code', 'sin referencia');
        END;

        SELECT stock_qty, coalesce(is_service_item, false)
        INTO v_stock, v_is_service_item
        FROM public.inventory
        WHERE id = v_product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Producto % no existe en inventario', v_product_id;
        END IF;

        IF NOT v_is_service_item THEN
            SELECT coalesce(sum(t.quantity), 0)
            INTO v_reserved_qty
            FROM tmp_validated_order_items t
            WHERE t.product_id = v_product_id
              AND t.is_service_item = false;

            IF coalesce(v_stock, 0) < v_reserved_qty + v_qty THEN
                RAISE EXCEPTION 'Stock insuficiente para producto % (stock %, solicitado %)', v_product_id, coalesce(v_stock, 0), v_reserved_qty + v_qty;
            END IF;
        END IF;

        INSERT INTO tmp_validated_order_items (
            order_item_id,
            product_id,
            quantity,
            unit_price,
            total_price,
            is_service_item
        )
        VALUES (
            gen_random_uuid(),
            v_product_id,
            v_qty,
            v_unit_price,
            v_unit_price * v_qty,
            v_is_service_item
        );

        v_inserted_items := v_inserted_items + 1;
    END LOOP;

    IF v_inserted_items = 0 THEN
        RAISE EXCEPTION 'No se pudieron generar items del pedido';
    END IF;

    INSERT INTO public.orders (
        id,
        client_id,
        user_id,
        quotation_id,
        visit_id,
        status,
        total_amount,
        notes,
        interaction_type,
        payment_proof_path,
        payment_proof_name,
        payment_proof_mime_type,
        payment_proof_uploaded_at,
        payment_email_status
    )
    VALUES (
        gen_random_uuid(),
        v_quote.client_id,
        v_target_user_id,
        v_quote.id,
        NULL,
        'completed',
        coalesce(v_quote.total_amount, 0),
        v_quote.comments,
        v_quote.interaction_type,
        v_payment_proof_path,
        v_payment_proof_name,
        v_payment_proof_mime_type,
        CASE WHEN v_payment_proof_path IS NOT NULL THEN now() ELSE NULL END,
        'pending'
    )
    RETURNING id, folio INTO v_order_id, v_order_folio;

    CREATE TEMP TABLE tmp_inventory_sale_base ON COMMIT DROP AS
    SELECT
        t.product_id,
        coalesce(i.stock_qty, 0)::integer AS stock_before,
        coalesce(i.price, 0) AS unit_price_snapshot
    FROM (
        SELECT DISTINCT product_id
        FROM tmp_validated_order_items
        WHERE is_service_item = false
    ) t
    JOIN public.inventory i
      ON i.id = t.product_id;

    INSERT INTO public.order_items (
        id,
        order_id,
        product_id,
        quantity,
        unit_price,
        total_price
    )
    SELECT
        t.order_item_id,
        v_order_id,
        t.product_id,
        t.quantity,
        t.unit_price,
        t.total_price
    FROM tmp_validated_order_items t;

    UPDATE public.inventory i
    SET stock_qty = sale_base.stock_before - movement.total_qty,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = v_actor_id
    FROM (
        SELECT
            t.product_id,
            sum(t.quantity)::integer AS total_qty
        FROM tmp_validated_order_items t
        WHERE t.is_service_item = false
        GROUP BY t.product_id
    ) AS movement
    JOIN tmp_inventory_sale_base sale_base
      ON sale_base.product_id = movement.product_id
    WHERE i.id = movement.product_id;

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
        order_id,
        order_item_id,
        performed_by
    )
    SELECT
        t.product_id,
        'sale_outbound',
        'out',
        t.quantity,
        sale_base.stock_before - coalesce(sum(t.quantity) OVER (
            PARTITION BY t.product_id
            ORDER BY t.line_no
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0),
        sale_base.stock_before - sum(t.quantity) OVER (
            PARTITION BY t.product_id
            ORDER BY t.line_no
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ),
        t.unit_price,
        'sale',
        format('Pedido generado desde cotización #%s', coalesce(v_quote.folio::text, '')),
        'order_items',
        t.order_item_id,
        v_order_id,
        t.order_item_id,
        v_actor_id
    FROM tmp_validated_order_items t
    JOIN tmp_inventory_sale_base sale_base
      ON sale_base.product_id = t.product_id
    WHERE t.is_service_item = false
    ORDER BY t.product_id, t.line_no;

    UPDATE public.quotations
    SET status = 'approved'
    WHERE id = v_quote.id;

    RETURN jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'order_folio', v_order_folio,
        'already_exists', false,
        'items_count', v_inserted_items,
        'client_credit_days', v_client_credit_days,
        'payment_email_status', 'pending'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_inventory_stock_import(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_inventory_pricing_import(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quotation_to_order(uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
