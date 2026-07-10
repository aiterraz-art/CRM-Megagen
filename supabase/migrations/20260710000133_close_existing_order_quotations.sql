alter table public.orders
add column if not exists cancelled_at timestamptz;

alter table public.orders
add column if not exists cancelled_by uuid references public.profiles(id) on delete set null;

alter table public.orders
add column if not exists cancellation_reason text;

create or replace function public.convert_quotation_to_order(
    p_quotation_id uuid,
    p_user_id uuid,
    p_payment_proof_path text default null,
    p_payment_proof_name text default null,
    p_payment_proof_mime_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    v_quote_seller_role text;
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
       and coalesce(v_actor_role, '') not in ('admin', 'facturador', 'administrativo') then
        raise exception 'Solo el vendedor duenio, admin o facturacion pueden convertir la cotizacion a pedido';
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

    select lower(coalesce(p.role, ''))
    into v_quote_seller_role
    from public.profiles p
    where p.id = v_quote.seller_id;

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

    if coalesce(v_quote_seller_role, '') = 'seller'
       and coalesce(v_client_requires_discount_approval, true)
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
$$;

create or replace function public.cancel_order_and_reopen_quotation(
    p_order_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
       and coalesce(v_actor_role, '') not in ('admin', 'manager', 'jefe', 'facturador', 'tesorero', 'administrativo') then
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
$$;

grant execute on function public.convert_quotation_to_order(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.cancel_order_and_reopen_quotation(uuid, text) to authenticated;

update public.quotations q
set status = 'approved'
where coalesce(q.status, '') <> 'approved'
  and exists (
    select 1
    from public.orders o
    where o.quotation_id = q.id
      and lower(coalesce(o.status, '')) <> 'cancelled'
  );

notify pgrst, 'reload schema';
