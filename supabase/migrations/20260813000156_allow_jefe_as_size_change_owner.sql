drop policy if exists "Size change requests read" on public.size_change_requests;
create policy "Size change requests read"
on public.size_change_requests
for select
to authenticated
using (
    exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and (
              lower(coalesce(p.role, '')) in ('admin', 'facturador', 'jefe')
              or (
                  lower(coalesce(p.role, '')) = 'seller'
                  and seller_id = auth.uid()
              )
          )
    )
);

drop policy if exists "Size change request items read" on public.size_change_request_items;
create policy "Size change request items read"
on public.size_change_request_items
for select
to authenticated
using (
    exists (
        select 1
        from public.size_change_requests r
        join public.profiles p
          on p.id = auth.uid()
        where r.id = size_change_request_items.request_id
          and (
              lower(coalesce(p.role, '')) in ('admin', 'facturador', 'jefe')
              or (
                  lower(coalesce(p.role, '')) = 'seller'
                  and r.seller_id = auth.uid()
              )
          )
    )
);

create or replace function public.create_size_change_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
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

    if v_actor_role not in ('seller', 'admin', 'jefe') then
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

    if v_actor_role = 'seller' and v_seller_id <> auth.uid() then
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
$function$;

create or replace function public.update_size_change_request(p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

    if v_actor_role not in ('seller', 'admin', 'jefe') then
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

    if v_actor_role = 'seller' and v_request.seller_id <> auth.uid() then
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

    if v_actor_role = 'seller' and v_seller_id <> auth.uid() then
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
$$;
