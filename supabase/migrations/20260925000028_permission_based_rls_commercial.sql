-- Lote 1 de la Fase 3: clientes, cotizaciones y pedidos pasan de chequeos por rol a permisos.
--
-- Cada politica conserva su condicion de propiedad (created_by / seller_id / user_id = yo) y
-- solo reemplaza la lista de roles por auth_user_has_permission, que ademas respeta las
-- excepciones por persona. Los textos base salen de pg_policies / pg_get_functiondef de
-- produccion; ambas instancias tenian identicas estas politicas y funciones.
--
-- Permisos nuevos de este lote (misma asignacion que los roles tenian por nombre):
--   MANAGE_ALL_QUOTATIONS y MANAGE_ALL_ORDERS: admin, jefe, facturador, tesorero.

INSERT INTO public.role_permissions (role, permission)
VALUES
    ('admin', 'MANAGE_ALL_QUOTATIONS'), ('jefe', 'MANAGE_ALL_QUOTATIONS'), ('facturador', 'MANAGE_ALL_QUOTATIONS'), ('tesorero', 'MANAGE_ALL_QUOTATIONS'),
    ('admin', 'MANAGE_ALL_ORDERS'), ('jefe', 'MANAGE_ALL_ORDERS'), ('facturador', 'MANAGE_ALL_ORDERS'), ('tesorero', 'MANAGE_ALL_ORDERS')
ON CONFLICT (role, permission) DO NOTHING;

DROP POLICY IF EXISTS "Sellers view own clients" ON public.clients;
CREATE POLICY "Sellers view own clients"
ON public.clients
AS PERMISSIVE
FOR SELECT
TO public
USING (((created_by = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_ALL_CLIENTS'))));

DROP POLICY IF EXISTS "Sellers insert clients" ON public.clients;
CREATE POLICY "Sellers insert clients"
ON public.clients
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK (((auth.uid() = created_by) OR ((SELECT public.auth_user_has_permission('MANAGE_CLIENTS')) OR (SELECT public.auth_user_has_permission('ASSIGN_QUOTATION_SELLER')))));

DROP POLICY IF EXISTS "Sellers update own clients" ON public.clients;
CREATE POLICY "Sellers update own clients"
ON public.clients
AS PERMISSIVE
FOR UPDATE
TO public
USING (((created_by = auth.uid()) OR ((SELECT public.auth_user_has_permission('MANAGE_CLIENTS')) OR (SELECT public.auth_user_has_permission('MANAGE_CLIENT_CREDIT')) OR (SELECT public.auth_user_has_permission('ASSIGN_CLIENTS')) OR (SELECT public.auth_user_has_permission('MERGE_CLIENTS')))))
WITH CHECK (((created_by = auth.uid()) OR ((SELECT public.auth_user_has_permission('MANAGE_CLIENTS')) OR (SELECT public.auth_user_has_permission('MANAGE_CLIENT_CREDIT')) OR (SELECT public.auth_user_has_permission('ASSIGN_CLIENTS')) OR (SELECT public.auth_user_has_permission('MERGE_CLIENTS')))));

DROP POLICY IF EXISTS "Sellers delete own clients" ON public.clients;
CREATE POLICY "Sellers delete own clients"
ON public.clients
AS PERMISSIVE
FOR DELETE
TO public
USING (((created_by = auth.uid()) OR ((SELECT public.auth_user_has_permission('MANAGE_CLIENTS')) OR (SELECT public.auth_user_has_permission('MERGE_CLIENTS')))));

DROP POLICY IF EXISTS "Pool read abandoned prospects" ON public.clients;
CREATE POLICY "Pool read abandoned prospects"
ON public.clients
AS PERMISSIVE
FOR SELECT
TO public
USING (((auth.role() = 'authenticated'::text) AND (auth.uid() IS NOT NULL) AND (SELECT public.auth_user_has_permission('VIEW_CLIENTS')) AND ((status = 'prospect'::text) OR (status ~~ 'prospect_%'::text)) AND (((last_visit_date IS NOT NULL) AND (last_visit_date < (now() - '30 days'::interval))) OR ((last_visit_date IS NULL) AND (created_at < (now() - '30 days'::interval))))));

DROP POLICY IF EXISTS "Sellers manage own quotations" ON public.quotations;
CREATE POLICY "Sellers manage own quotations"
ON public.quotations
AS PERMISSIVE
FOR ALL
TO public
USING (((seller_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_ALL_QUOTATIONS'))))
WITH CHECK (((seller_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_ALL_QUOTATIONS'))));

DROP POLICY IF EXISTS "quotation_order_conversion_logs_select" ON public.quotation_order_conversion_logs;
CREATE POLICY "quotation_order_conversion_logs_select"
ON public.quotation_order_conversion_logs
AS PERMISSIVE
FOR SELECT
TO public
USING (((actor_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM quotations q WHERE ((q.id = quotation_order_conversion_logs.quotation_id) AND (q.seller_id = auth.uid())))) OR (SELECT public.auth_user_has_permission('VIEW_ALL_QUOTATIONS'))));

DROP POLICY IF EXISTS "quotation_order_conversion_logs_insert" ON public.quotation_order_conversion_logs;
CREATE POLICY "quotation_order_conversion_logs_insert"
ON public.quotation_order_conversion_logs
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK (((actor_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM quotations q WHERE ((q.id = quotation_order_conversion_logs.quotation_id) AND ((q.seller_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_ALL_QUOTATIONS'))))))));

DROP POLICY IF EXISTS "Backoffice manages quotation sellers" ON public.quotation_sellers;
CREATE POLICY "Backoffice manages quotation sellers"
ON public.quotation_sellers
AS PERMISSIVE
FOR ALL
TO authenticated
USING (((SELECT public.auth_user_has_permission('MANAGE_ALL_QUOTATIONS')) OR (SELECT public.auth_user_has_permission('MANAGE_USERS'))))
WITH CHECK (((SELECT public.auth_user_has_permission('MANAGE_ALL_QUOTATIONS')) OR (SELECT public.auth_user_has_permission('MANAGE_USERS'))));

DROP POLICY IF EXISTS "View orders" ON public.orders;
CREATE POLICY "View orders"
ON public.orders
AS PERMISSIVE
FOR SELECT
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_ALL_ORDERS'))));

DROP POLICY IF EXISTS "Create orders" ON public.orders;
CREATE POLICY "Create orders"
ON public.orders
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK (((auth.uid() = user_id) OR (SELECT public.auth_user_has_permission('MANAGE_ALL_ORDERS'))));

DROP POLICY IF EXISTS "Update orders" ON public.orders;
CREATE POLICY "Update orders"
ON public.orders
AS PERMISSIVE
FOR UPDATE
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_ALL_ORDERS'))))
WITH CHECK (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_ALL_ORDERS'))));

DROP POLICY IF EXISTS "Delete orders" ON public.orders;
CREATE POLICY "Delete orders"
ON public.orders
AS PERMISSIVE
FOR DELETE
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_ALL_ORDERS'))));

DROP POLICY IF EXISTS "View items" ON public.order_items;
CREATE POLICY "View items"
ON public.order_items
AS PERMISSIVE
FOR SELECT
TO public
USING ((EXISTS ( SELECT 1 FROM orders WHERE ((orders.id = order_items.order_id) AND ((orders.user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_ALL_ORDERS')))))));

DROP POLICY IF EXISTS "Order notification logs read owner or backoffice" ON public.order_notification_logs;
CREATE POLICY "Order notification logs read owner or backoffice"
ON public.order_notification_logs
AS PERMISSIVE
FOR SELECT
TO public
USING ((EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_notification_logs.order_id) AND ((o.user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('RESEND_ORDER_EMAIL')))))));

DROP POLICY IF EXISTS "View logs" ON public.call_logs;
CREATE POLICY "View logs"
ON public.call_logs
AS PERMISSIVE
FOR SELECT
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_ALL_CLIENTS'))));

DROP POLICY IF EXISTS "View email logs" ON public.email_logs;
CREATE POLICY "View email logs"
ON public.email_logs
AS PERMISSIVE
FOR SELECT
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_ALL_CLIENTS'))));

-- La politica ALL de cotizaciones ahora exige MANAGE_ALL_QUOTATIONS para tocar las de otros;
-- ver las de todo el equipo es un permiso aparte.
DROP POLICY IF EXISTS "Quotations read all team" ON public.quotations;
CREATE POLICY "Quotations read all team"
ON public.quotations
AS PERMISSIVE
FOR SELECT
TO public
USING ((SELECT public.auth_user_has_permission('VIEW_ALL_QUOTATIONS')));

CREATE OR REPLACE FUNCTION public.archive_abandoned_prospects()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_role text;
  archived_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE='28000';
  END IF;

  SELECT lower(coalesce(role,'')) INTO actor_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT public.auth_user_has_permission('ARCHIVE_CLIENTS') THEN
    RAISE EXCEPTION 'No tienes permiso para archivar leads.' USING ERRCODE='42501';
  END IF;

  UPDATE public.clients
  SET status = 'archived'
  WHERE (status LIKE 'prospect_%' OR status = 'prospect')
    AND coalesce(nullif(trim(phone),''), '') = ''
    AND coalesce(nullif(trim(email),''), '') = ''
    AND coalesce(last_visit_date, created_at) < now() - interval '60 days';

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cancel_order_and_reopen_quotation(p_order_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_order public.orders%rowtype;
    v_quote public.quotations%rowtype;
    v_reason text := nullif(trim(coalesce(p_reason, '')), '');
    v_has_stage boolean := false;
    v_reopen_status text := 'draft';
    v_reopen_stage text := null;
    v_cancelled_queue_items integer := 0;
    v_restock_lines integer := 0;
begin
    if p_order_id is null then
        raise exception 'p_order_id es obligatorio';
    end if;

    if v_actor_id is null then
        raise exception 'Usuario no autenticado';
    end if;

    select lower(coalesce(p.role, ''))
    into v_actor_role
    from public.profiles p
    where p.id = v_actor_id;

    select *
    into v_order
    from public.orders
    where id = p_order_id
    for update;

    if not found then
        raise exception 'Pedido no encontrado';
    end if;

    if v_order.user_id is distinct from v_actor_id
       and not public.auth_user_has_permission('CANCEL_ORDERS') then
        raise exception 'No tienes permisos para cancelar este pedido';
    end if;

    if lower(coalesce(v_order.status, '')) = 'cancelled' then
        return jsonb_build_object(
            'ok', true,
            'already_cancelled', true,
            'order_id', v_order.id,
            'order_folio', v_order.folio,
            'quotation_id', v_order.quotation_id
        );
    end if;

    if lower(coalesce(v_order.delivery_status, '')) in ('assigned', 'out_for_delivery', 'delivered') then
        raise exception 'El pedido ya esta asignado a despacho o entregado y no puede cancelarse desde Pedidos';
    end if;

    if exists (
        select 1
        from public.dispatch_queue_items q
        where q.order_id = v_order.id
          and lower(coalesce(q.status, '')) in ('routed', 'delivered')
    ) then
        raise exception 'El pedido ya entro a ruta de despacho y no puede reabrirse desde Pedidos';
    end if;

    if v_order.quotation_id is not null then
        select *
        into v_quote
        from public.quotations
        where id = v_order.quotation_id
        for update;
    end if;

    drop table if exists tmp_order_restock_base;
    create temp table tmp_order_restock_base on commit drop as
    select
        oi.id as order_item_id,
        oi.product_id as inventory_id,
        oi.quantity::integer as qty,
        coalesce(i.stock_qty, 0)::integer as stock_before,
        coalesce(oi.unit_price, i.price, 0) as unit_price_snapshot
    from public.order_items oi
    join public.inventory i
      on i.id = oi.product_id
    where oi.order_id = v_order.id
      and coalesce(i.is_service_item, false) = false
    order by oi.id;

    select count(*)
    into v_restock_lines
    from tmp_order_restock_base;

    if v_restock_lines > 0 then
        update public.inventory i
        set stock_qty = base.stock_before + movement.total_qty,
            last_stock_reviewed_at = now(),
            last_stock_reviewed_by = v_actor_id
        from (
            select inventory_id, sum(qty)::integer as total_qty
            from tmp_order_restock_base
            group by inventory_id
        ) movement
        join (
            select distinct inventory_id, stock_before
            from tmp_order_restock_base
        ) base
          on base.inventory_id = movement.inventory_id
        where i.id = movement.inventory_id;

        insert into public.inventory_movements (
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
        select
            t.inventory_id,
            'sale_cancellation_inbound',
            'in',
            t.qty,
            t.stock_before + coalesce(sum(t.qty) over (
                partition by t.inventory_id
                order by t.order_item_id
                rows between unbounded preceding and 1 preceding
            ), 0),
            t.stock_before + sum(t.qty) over (
                partition by t.inventory_id
                order by t.order_item_id
                rows between unbounded preceding and current row
            ),
            t.unit_price_snapshot,
            'sale_cancellation',
            case
                when v_reason is not null then format('Cancelacion de pedido #%s. Motivo: %s', coalesce(v_order.folio::text, v_order.id::text), v_reason)
                else format('Cancelacion de pedido #%s', coalesce(v_order.folio::text, v_order.id::text))
            end,
            'orders',
            v_order.id,
            v_order.id,
            t.order_item_id,
            v_actor_id
        from tmp_order_restock_base t
        order by t.inventory_id, t.order_item_id;
    end if;

    update public.dispatch_queue_items
    set status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        notes = case
            when v_reason is null then notes
            else trim(concat_ws(E'\n', nullif(notes, ''), format('Cancelado desde Pedidos: %s', v_reason)))
        end
    where order_id = v_order.id
      and lower(coalesce(status, '')) = 'queued';

    get diagnostics v_cancelled_queue_items = row_count;

    update public.orders
    set status = 'cancelled',
        delivery_status = 'cancelled',
        cancelled_at = coalesce(cancelled_at, now()),
        cancelled_by = v_actor_id,
        cancellation_reason = coalesce(v_reason, cancellation_reason),
        notes = case
            when v_reason is null then notes
            else trim(concat_ws(E'\n', nullif(notes, ''), format('Pedido cancelado: %s', v_reason)))
        end
    where id = v_order.id;

    if found and v_quote.id is not null then
        select exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'quotations'
              and column_name = 'stage'
        ) into v_has_stage;

        v_reopen_status := case
            when v_quote.sent_at is not null then 'sent'
            else 'draft'
        end;

        v_reopen_stage := case
            when v_quote.sent_at is not null then 'sent'
            else null
        end;

        if v_has_stage then
            execute 'update public.quotations set status = $2, stage = $3 where id = $1'
            using v_quote.id, v_reopen_status, v_reopen_stage;
        else
            update public.quotations
            set status = v_reopen_status
            where id = v_quote.id;
        end if;
    end if;

    return jsonb_build_object(
        'ok', true,
        'already_cancelled', false,
        'order_id', v_order.id,
        'order_folio', v_order.folio,
        'quotation_id', v_order.quotation_id,
        'quotation_reopened', v_quote.id is not null,
        'quotation_status', case when v_quote.id is not null then v_reopen_status else null end,
        'restocked_lines', v_restock_lines,
        'cancelled_queue_items', v_cancelled_queue_items
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.convert_quotation_to_order(p_quotation_id uuid, p_user_id uuid, p_payment_proof_path text DEFAULT NULL::text, p_payment_proof_name text DEFAULT NULL::text, p_payment_proof_mime_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_quote public.quotations%rowtype;
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
    v_client_requires_discount_approval boolean := true;
    v_payment_proof_path text := nullif(trim(coalesce(p_payment_proof_path, '')), '');
    v_payment_proof_name text := nullif(trim(coalesce(p_payment_proof_name, '')), '');
    v_payment_proof_mime_type text := nullif(trim(coalesce(p_payment_proof_mime_type, '')), '');
    v_is_service_item boolean := false;
    v_allow_sale_without_stock boolean := false;
    v_reserved_qty integer := 0;
    v_max_discount_pct numeric := 0;
    v_item_discount_pct numeric := 0;
    v_item_list_price numeric := 0;
    v_item_net_price numeric := 0;
    v_latest_discount_approval_status text;
    v_insufficient_items_message text := '';
begin
    if p_quotation_id is null then
        raise exception 'p_quotation_id es obligatorio';
    end if;

    if v_actor_id is null then
        raise exception 'Usuario no autenticado';
    end if;

    select lower(coalesce(p.role, ''))
    into v_actor_role
    from public.profiles p
    where p.id = v_actor_id;

    select * into v_quote
    from public.quotations
    where id = p_quotation_id
    for update;

    if not found then
        raise exception 'Cotizacion no encontrada';
    end if;

    if v_quote.seller_id is distinct from v_actor_id
       and not public.auth_user_has_permission('CONVERT_ANY_QUOTATION') then
        raise exception 'Solo el vendedor duenio o quien puede cerrar ventas de otros puede convertir la cotizacion a pedido';
    end if;

    select id, folio, payment_email_status
    into v_existing_order_id, v_existing_order_folio, v_existing_payment_email_status
    from public.orders
    where quotation_id = p_quotation_id
      and lower(coalesce(status, '')) <> 'cancelled'
    order by created_at desc nulls last, id desc
    limit 1;

    if v_existing_order_id is not null then
        update public.orders
        set notes = v_quote.comments
        where id = v_existing_order_id
          and notes is distinct from v_quote.comments;

        update public.quotations
        set status = 'approved'
        where id = v_quote.id;

        update public.clients
        set status = 'active'
        where id = v_quote.client_id
          and (
            status = 'prospect'
            or status like 'prospect\_%' escape '\'
          );

        return jsonb_build_object(
            'ok', true,
            'order_id', v_existing_order_id,
            'order_folio', v_existing_order_folio,
            'already_exists', true,
            'payment_email_status', coalesce(v_existing_payment_email_status, 'not_required')
        );
    end if;

    select
        coalesce(c.credit_days, 0),
        coalesce(c.requires_discount_approval, true)
    into
        v_client_credit_days,
        v_client_requires_discount_approval
    from public.clients c
    where c.id = v_quote.client_id;

    if coalesce(v_client_credit_days, 0) = 0
       and (v_payment_proof_path is null or v_payment_proof_name is null) then
        raise exception 'Debes adjuntar comprobante de pago para clientes sin credito';
    end if;

    v_target_user_id := v_quote.seller_id;
    if v_target_user_id is null then
        v_target_user_id := coalesce(p_user_id, v_actor_id);
    end if;

    if v_target_user_id is null then
        raise exception 'No se pudo determinar el vendedor de la venta';
    end if;

    if not exists (
        select 1 from public.profiles p where p.id = v_target_user_id
    ) then
        raise exception 'El vendedor asociado a la venta no existe';
    end if;

    if jsonb_typeof(v_quote.items) <> 'array' or jsonb_array_length(v_quote.items) = 0 then
        raise exception 'La cotizacion no tiene items validos para convertir';
    end if;

    for v_item in
        select value from jsonb_array_elements(v_quote.items)
    loop
        begin
            v_item_list_price := coalesce(
                nullif(trim(v_item->>'price'), '')::numeric,
                0
            );
        exception when others then
            v_item_list_price := 0;
        end;

        begin
            v_item_net_price := coalesce(
                nullif(trim(v_item->>'net_price'), '')::numeric,
                nullif(trim(v_item->>'netPrice'), '')::numeric,
                v_item_list_price
            );
        exception when others then
            v_item_net_price := v_item_list_price;
        end;

        begin
            v_item_discount_pct := greatest(
                coalesce(
                    nullif(trim(v_item->>'discount'), '')::numeric,
                    nullif(trim(v_item->>'discountPct'), '')::numeric,
                    case
                        when v_item_list_price > 0 then round(((v_item_list_price - v_item_net_price) / v_item_list_price) * 100, 2)
                        else 0
                    end
                ),
                0
            );
        exception when others then
            v_item_discount_pct := 0;
        end;

        v_max_discount_pct := greatest(v_max_discount_pct, coalesce(v_item_discount_pct, 0));
    end loop;

    if coalesce(v_client_requires_discount_approval, true)
       and v_max_discount_pct > 5 then
        select ar.status
        into v_latest_discount_approval_status
        from public.approval_requests ar
        where ar.entity_id = v_quote.id
          and ar.module = 'sales'
          and ar.approval_type = 'extra_discount'
        order by ar.requested_at desc nulls last, ar.id desc
        limit 1;

        if v_latest_discount_approval_status = 'approved' then
            null;
        elsif v_latest_discount_approval_status = 'pending' then
            raise exception 'La cotizacion tiene una aprobacion de descuento pendiente';
        elsif v_latest_discount_approval_status = 'rejected' then
            raise exception 'La cotizacion tiene una aprobacion de descuento rechazada';
        else
            raise exception 'La cotizacion requiere autorizacion de descuento antes de generar el pedido';
        end if;
    end if;

    drop table if exists tmp_validated_order_items;
    create temp table tmp_validated_order_items (
        line_no integer generated always as identity primary key,
        order_item_id uuid not null,
        product_id uuid not null,
        quantity integer not null,
        unit_price numeric not null,
        total_price numeric not null,
        is_service_item boolean not null default false
    ) on commit drop;

    drop table if exists tmp_insufficient_order_items;
    create temp table tmp_insufficient_order_items (
        line_no integer generated always as identity primary key,
        product_id uuid not null,
        sku text not null,
        product_name text not null,
        stock_qty integer not null,
        requested_qty integer not null
    ) on commit drop;

    for v_item in
        select value from jsonb_array_elements(v_quote.items)
    loop
        declare
            v_product_sku text := 'SIN-SKU';
            v_product_name text := 'Producto sin nombre';
        begin
            v_product_id := null;
            v_is_service_item := false;
            v_allow_sale_without_stock := false;
            v_reserved_qty := 0;

            v_item_product_id_raw := trim(coalesce(v_item->>'product_id', ''));
            v_item_code := trim(coalesce(v_item->>'code', ''));
            v_item_detail := trim(coalesce(v_item->>'detail', ''));

            if v_item_product_id_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
                select i.id
                into v_product_id
                from public.inventory i
                where i.id = v_item_product_id_raw::uuid
                limit 1;
            end if;

            if v_product_id is null and lower(v_item_code) <> '' then
                select i.id
                into v_product_id
                from public.inventory i
                where lower(coalesce(i.sku, '')) = lower(v_item_code)
                limit 1;
            end if;

            if v_product_id is null and lower(v_item_detail) <> '' then
                select i.id
                into v_product_id
                from public.inventory i
                where lower(coalesce(i.name, '')) = lower(v_item_detail)
                limit 1;
            end if;

            if v_product_id is null then
                raise exception 'Item sin producto valido en inventario (%). Edita la cotizacion y selecciona el producto.', coalesce(nullif(v_item_detail, ''), nullif(v_item_code, ''), 'sin referencia');
            end if;

            begin
                v_qty := greatest(coalesce(nullif(trim(v_item->>'qty'), '')::integer, 0), 0);
            exception when others then
                v_qty := 0;
            end;

            if v_qty <= 0 then
                raise exception 'Cantidad invalida para el producto %', coalesce(nullif(v_item_detail, ''), nullif(v_item_code, ''), v_product_id::text);
            end if;

            begin
                v_unit_price := greatest(
                    coalesce(
                        nullif(trim(v_item->>'net_price'), '')::numeric,
                        nullif(trim(v_item->>'netPrice'), '')::numeric,
                        nullif(trim(v_item->>'price'), '')::numeric,
                        0
                    ),
                    0
                );
            exception when others then
                v_unit_price := 0;
            end;

            select
                coalesce(i.stock_qty, 0)::integer,
                coalesce(i.is_service_item, false),
                coalesce(i.allow_sale_without_stock, false),
                coalesce(i.sku, 'SIN-SKU'),
                coalesce(i.name, 'Producto sin nombre')
            into
                v_stock,
                v_is_service_item,
                v_allow_sale_without_stock,
                v_product_sku,
                v_product_name
            from public.inventory i
            where i.id = v_product_id
            for update;

            if not found then
                raise exception 'El producto seleccionado ya no existe en inventario';
            end if;

            if not v_is_service_item then
                select coalesce(sum(oi.quantity), 0)::integer
                into v_reserved_qty
                from public.order_items oi
                join public.orders o on o.id = oi.order_id
                where oi.product_id = v_product_id
                  and lower(coalesce(o.status, '')) <> 'cancelled'
                  and o.id <> coalesce(v_existing_order_id, '00000000-0000-0000-0000-000000000000'::uuid);

                if not v_allow_sale_without_stock and coalesce(v_stock, 0) < v_qty then
                    insert into tmp_insufficient_order_items (
                        product_id,
                        sku,
                        product_name,
                        stock_qty,
                        requested_qty
                    )
                    values (
                        v_product_id,
                        v_product_sku,
                        v_product_name,
                        coalesce(v_stock, 0),
                        v_qty
                    );
                end if;
            end if;

            insert into tmp_validated_order_items (
                order_item_id,
                product_id,
                quantity,
                unit_price,
                total_price,
                is_service_item
            )
            values (
                gen_random_uuid(),
                v_product_id,
                v_qty,
                v_unit_price,
                round(v_unit_price * v_qty, 2),
                v_is_service_item
            );

            v_inserted_items := v_inserted_items + 1;
        end;
    end loop;

    if exists (select 1 from tmp_insufficient_order_items) then
        select string_agg(
            format('%s - %s (stock %s, solicitado %s)', sku, product_name, stock_qty, requested_qty),
            E'\n'
            order by line_no
        )
        into v_insufficient_items_message
        from tmp_insufficient_order_items;

        raise exception E'Stock insuficiente para generar el pedido:\n%s', coalesce(v_insufficient_items_message, 'Revisa inventario y vuelve a intentarlo.');
    end if;

    insert into public.orders (
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
    values (
        gen_random_uuid(),
        v_quote.client_id,
        v_target_user_id,
        v_quote.id,
        null,
        'completed',
        coalesce(v_quote.total_amount, 0),
        v_quote.comments,
        v_quote.interaction_type,
        v_payment_proof_path,
        v_payment_proof_name,
        v_payment_proof_mime_type,
        case when v_payment_proof_path is not null then now() else null end,
        'pending'
    )
    returning id, folio into v_order_id, v_order_folio;

    create temp table tmp_inventory_sale_base on commit drop as
    select
        t.product_id,
        coalesce(i.stock_qty, 0)::integer as stock_before,
        coalesce(i.price, 0) as unit_price_snapshot
    from (
        select distinct product_id
        from tmp_validated_order_items
        where is_service_item = false
    ) t
    join public.inventory i
      on i.id = t.product_id;

    insert into public.order_items (
        id,
        order_id,
        product_id,
        quantity,
        unit_price,
        total_price
    )
    select
        t.order_item_id,
        v_order_id,
        t.product_id,
        t.quantity,
        t.unit_price,
        t.total_price
    from tmp_validated_order_items t;

    update public.inventory i
    set stock_qty = sale_base.stock_before - movement.total_qty,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = v_actor_id
    from (
        select
            t.product_id,
            sum(t.quantity)::integer as total_qty
        from tmp_validated_order_items t
        where t.is_service_item = false
        group by t.product_id
    ) as movement
    join tmp_inventory_sale_base sale_base
      on sale_base.product_id = movement.product_id
    where i.id = movement.product_id;

    insert into public.inventory_movements (
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
    select
        t.product_id,
        'sale_outbound',
        'out',
        t.quantity,
        sale_base.stock_before - coalesce(sum(t.quantity) over (
            partition by t.product_id
            order by t.line_no
            rows between unbounded preceding and 1 preceding
        ), 0),
        sale_base.stock_before - sum(t.quantity) over (
            partition by t.product_id
            order by t.line_no
            rows between unbounded preceding and current row
        ),
        t.unit_price,
        'sale',
        format('Pedido generado desde cotización #%s', coalesce(v_quote.folio::text, '')),
        'order_items',
        t.order_item_id,
        v_order_id,
        t.order_item_id,
        v_actor_id
    from tmp_validated_order_items t
    join tmp_inventory_sale_base sale_base
      on sale_base.product_id = t.product_id
    where t.is_service_item = false
    order by t.product_id, t.line_no;

    update public.quotations
    set status = 'approved'
    where id = v_quote.id;

    update public.clients
    set status = 'active'
    where id = v_quote.client_id
      and (
        status = 'prospect'
        or status like 'prospect\_%' escape '\'
      );

    return jsonb_build_object(
        'ok', true,
        'order_id', v_order_id,
        'order_folio', v_order_folio,
        'already_exists', false,
        'items_count', v_inserted_items,
        'client_credit_days', v_client_credit_days,
        'payment_email_status', 'pending'
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_client_credit_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    actor_role text;
BEGIN
    IF auth.uid() IS NULL THEN
        NEW.credit_days := COALESCE(NEW.credit_days, 0);
        IF TG_OP = 'INSERT' THEN
            NEW.credit_days := 0;
        END IF;
        RETURN NEW;
    END IF;

    SELECT lower(coalesce(p.role, ''))
    INTO actor_role
    FROM public.profiles p
    WHERE p.id = auth.uid();

    NEW.credit_days := COALESCE(NEW.credit_days, 0);

    IF TG_OP = 'INSERT' THEN
        NEW.credit_days := 0;
        RETURN NEW;
    END IF;

    IF NEW.credit_days IS DISTINCT FROM OLD.credit_days
       AND NOT public.auth_user_has_permission('MANAGE_CLIENT_CREDIT') THEN
        RAISE EXCEPTION 'No tienes permiso para modificar los dias de credito.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_client_reassignment_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  actor_role text;
  can_manage_clients boolean := false;
BEGIN
  -- Service role / backend jobs can bypass this trigger.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    SELECT lower(COALESCE(p.role, '')) INTO actor_role
    FROM public.profiles p
    WHERE p.id = auth.uid();

    SELECT EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      JOIN public.profiles p
        ON p.role = rp.role
      WHERE p.id = auth.uid()
        AND rp.permission = 'MANAGE_CLIENTS'
    )
    INTO can_manage_clients;

    IF (
      NOT public.auth_user_has_permission('ASSIGN_CLIENTS')
    ) THEN
      RAISE EXCEPTION 'No tienes permiso para reasignar clientes.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.expire_stale_sent_quotations(p_days integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_config_days integer := 3;
  v_days integer;
  v_threshold timestamptz;
  v_is_privileged boolean := false;
  v_has_stage boolean := false;
  v_rows integer := 0;
  v_note text;
begin
  select coalesce(cfs.quotation_loss_days, 3)
  into v_config_days
  from public.client_followup_settings cfs
  where cfs.id = 'default';

  v_days := greatest(coalesce(p_days, v_config_days, 3), 1);
  v_threshold := now() - make_interval(days => v_days);
  v_note := format('(%s dias sin respuesta negociacion perdida)', v_days);

  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and public.auth_user_has_permission('VIEW_ALL_TEAM_STATS')
  ) into v_is_privileged;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotations'
      and column_name = 'stage'
  ) into v_has_stage;

  if v_has_stage then
    execute
      'update public.quotations q
       set status = ''rejected'',
           stage = ''lost'',
           comments = case
             when coalesce(q.comments, '''') ilike ''%sin respuesta negociacion perdida%''
               then q.comments
             else trim(concat_ws(E''\n'', nullif(q.comments, ''''), $2))
           end
       where q.status = ''sent''
         and coalesce(q.sent_at, q.created_at) <= $1
         and not exists (
           select 1
           from public.orders o
           where o.quotation_id = q.id
         )
         and ($3 or q.seller_id = auth.uid())'
    using v_threshold, v_note, v_is_privileged;
  else
    update public.quotations q
    set status = 'rejected',
        comments = case
          when coalesce(q.comments, '') ilike '%sin respuesta negociacion perdida%'
            then q.comments
          else trim(concat_ws(E'\n', nullif(q.comments, ''), v_note))
        end
    where q.status = 'sent'
      and coalesce(q.sent_at, q.created_at) <= v_threshold
      and not exists (
        select 1
        from public.orders o
        where o.quotation_id = q.id
      )
      and (v_is_privileged or q.seller_id = auth.uid());
  end if;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_client_duplicates(p_primary_client_id uuid, p_duplicate_client_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_primary public.clients%ROWTYPE;
  v_duplicate_ids uuid[];
  v_client_ids uuid[];
  v_name text;
  v_rut text;
  v_email text;
  v_phone text;
  v_address text;
  v_purchase_contact text;
  v_comuna text;
  v_office text;
  v_giro text;
  v_doctor_specialty text;
  v_zone text;
  v_notes text;
  v_status text;
  v_created_by uuid;
  v_pending_seller_email text;
  v_credit_days integer;
  v_lead_score integer;
  v_requires_discount_approval boolean;
  v_last_visit_date timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_table_name text;
  v_updated_tables text[] := ARRAY[]::text[];
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para fusionar clientes';
  END IF;

  SELECT lower(coalesce(role, '')) INTO v_actor_role
  FROM public.profiles
  WHERE id = v_actor_id;

  IF NOT public.auth_user_has_permission('MERGE_CLIENTS') THEN
    RAISE EXCEPTION 'No tienes permisos para fusionar clientes';
  END IF;

  v_duplicate_ids := ARRAY(
    SELECT DISTINCT duplicate_id
    FROM unnest(coalesce(p_duplicate_client_ids, ARRAY[]::uuid[])) AS duplicate_id
    WHERE duplicate_id IS NOT NULL
      AND duplicate_id <> p_primary_client_id
  );

  IF cardinality(v_duplicate_ids) = 0 THEN
    RAISE EXCEPTION 'Debes indicar al menos un cliente duplicado';
  END IF;

  SELECT *
  INTO v_primary
  FROM public.clients
  WHERE id = p_primary_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente principal no existe';
  END IF;

  v_client_ids := array_prepend(p_primary_client_id, v_duplicate_ids);

  SELECT candidate.name
  INTO v_name
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.name), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.name) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.rut
  INTO v_rut
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.rut), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.email
  INTO v_email
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.email), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.email) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.phone
  INTO v_phone
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.phone), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.phone) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.address
  INTO v_address
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.address), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.address) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.purchase_contact
  INTO v_purchase_contact
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.purchase_contact), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.purchase_contact) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.comuna
  INTO v_comuna
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.comuna), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.comuna) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.office
  INTO v_office
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.office), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.office) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.giro
  INTO v_giro
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.giro), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.giro) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.doctor_specialty
  INTO v_doctor_specialty
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.doctor_specialty), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.doctor_specialty) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.zone
  INTO v_zone
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.zone), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, length(candidate.zone) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT string_agg(DISTINCT nullif(btrim(candidate.notes), ''), ' | ')
  INTO v_notes
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT candidate.status
  INTO v_status
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
  ORDER BY CASE coalesce(candidate.status, '')
    WHEN 'active' THEN 6
    WHEN 'prospect_evaluating' THEN 5
    WHEN 'prospect_contacted' THEN 4
    WHEN 'prospect_new' THEN 3
    WHEN 'prospect' THEN 2
    WHEN 'lead' THEN 1
    ELSE 0
  END DESC, (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.created_by
  INTO v_created_by
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND candidate.created_by IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT candidate.pending_seller_email
  INTO v_pending_seller_email
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND nullif(btrim(candidate.pending_seller_email), '') IS NOT NULL
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  SELECT max(coalesce(candidate.credit_days, 0))
  INTO v_credit_days
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT max(candidate.lead_score)
  INTO v_lead_score
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT bool_or(coalesce(candidate.requires_discount_approval, false))
  INTO v_requires_discount_approval
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT max(candidate.last_visit_date)
  INTO v_last_visit_date
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids);

  SELECT candidate.lat, candidate.lng
  INTO v_lat, v_lng
  FROM public.clients candidate
  WHERE candidate.id = ANY(v_client_ids)
    AND candidate.lat IS NOT NULL
    AND candidate.lng IS NOT NULL
    AND abs(candidate.lat) > 0.0001
    AND abs(candidate.lng) > 0.0001
  ORDER BY (candidate.id = p_primary_client_id) DESC, candidate.created_at ASC
  LIMIT 1;

  UPDATE public.clients
  SET
    name = coalesce(v_name, name),
    rut = coalesce(v_rut, rut),
    email = coalesce(v_email, email),
    phone = coalesce(v_phone, phone),
    address = coalesce(v_address, address),
    purchase_contact = coalesce(v_purchase_contact, purchase_contact),
    comuna = coalesce(v_comuna, comuna),
    office = coalesce(v_office, office),
    giro = coalesce(v_giro, giro),
    doctor_specialty = coalesce(v_doctor_specialty, doctor_specialty),
    zone = coalesce(v_zone, zone),
    notes = coalesce(left(v_notes, 4000), notes),
    status = coalesce(v_status, status),
    created_by = coalesce(v_created_by, created_by),
    pending_seller_email = coalesce(v_pending_seller_email, pending_seller_email),
    credit_days = greatest(coalesce(v_credit_days, 0), coalesce(credit_days, 0)),
    lead_score = CASE
      WHEN v_lead_score IS NULL AND lead_score IS NULL THEN NULL
      ELSE least(3, greatest(1, greatest(coalesce(v_lead_score, 1), coalesce(lead_score, 1))))
    END,
    requires_discount_approval = coalesce(v_requires_discount_approval, requires_discount_approval),
    last_visit_date = coalesce(v_last_visit_date, last_visit_date),
    lat = coalesce(v_lat, lat),
    lng = coalesce(v_lng, lng),
    updated_at = now()
  WHERE id = p_primary_client_id;

  FOREACH v_table_name IN ARRAY ARRAY[
    'visits',
    'orders',
    'quotations',
    'tasks',
    'installed_base',
    'lead_message_logs',
    'kit_loan_requests',
    'size_change_requests',
    'dispatch_queue_items',
    'call_logs',
    'email_logs'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = v_table_name
        AND column_name = 'client_id'
    ) THEN
      EXECUTE format('UPDATE public.%I SET client_id = $1 WHERE client_id = ANY($2)', v_table_name)
      USING p_primary_client_id, v_duplicate_ids;
      v_updated_tables := array_append(v_updated_tables, v_table_name);
    END IF;
  END LOOP;

  DELETE FROM public.clients
  WHERE id = ANY(v_duplicate_ids);

  RETURN jsonb_build_object(
    'merged_into', p_primary_client_id,
    'duplicate_ids', v_duplicate_ids,
    'updated_tables', v_updated_tables
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_clients_readonly(p_search text)
 RETURNS TABLE(id uuid, name text, rut text, phone text, email text, address text, comuna text, office text, seller_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raw_search text := trim(coalesce(p_search, ''));
  v_rut_search text;
BEGIN
  -- A short minimum avoids using this endpoint as a portfolio browser.
  IF auth.uid() IS NULL OR char_length(v_raw_search) < 2 THEN
    RETURN;
  END IF;

  -- Busqueda de apoyo para quien ve clientes pero no toda la cartera; quien ve toda
  -- la cartera ya la obtiene por sus reglas de acceso normales.
  IF NOT public.auth_user_has_permission('VIEW_CLIENTS')
     OR public.auth_user_has_permission('VIEW_ALL_CLIENTS') THEN
    RETURN;
  END IF;

  v_rut_search := regexp_replace(lower(v_raw_search), '[^0-9k]', '', 'g');

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.rut,
    c.phone,
    c.email,
    c.address,
    c.comuna,
    c.office,
    coalesce(p.full_name, p.email, c.pending_seller_email, 'Sin vendedor asignado') AS seller_name
  FROM public.clients c
  LEFT JOIN public.profiles p ON p.id = c.created_by
  WHERE c.created_by IS DISTINCT FROM auth.uid()
    AND (
      strpos(lower(c.name), lower(v_raw_search)) > 0
      OR (
        v_rut_search <> ''
        AND strpos(regexp_replace(lower(coalesce(c.rut, '')), '[^0-9k]', '', 'g'), v_rut_search) > 0
      )
    )
  ORDER BY
    CASE
      WHEN regexp_replace(lower(coalesce(c.rut, '')), '[^0-9k]', '', 'g') = v_rut_search THEN 0
      ELSE 1
    END,
    c.name
  LIMIT 20;
END;
$function$
;

NOTIFY pgrst, 'reload schema';
