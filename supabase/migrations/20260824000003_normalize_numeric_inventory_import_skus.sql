create or replace function public.normalize_inventory_sku(p_sku text)
returns text
language sql
immutable
as $$
  select upper(trim(regexp_replace(coalesce(p_sku, ''), '^''+', '')));
$$;

create or replace function public.replace_inventory_stock_import(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_processed_count integer := 0;
    v_deleted_count integer := 0;
    v_preserved_count integer := 0;
    v_changed_count integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Usuario no autenticado';
    end if;

    if not public.auth_user_has_permission('UPLOAD_EXCEL') then
        raise exception 'No tienes permisos para importar inventario';
    end if;

    if jsonb_typeof(p_items) <> 'array' then
        raise exception 'p_items debe ser un arreglo JSON';
    end if;

    create temp table tmp_stock_import (
        sku text primary key,
        name text not null,
        stock_qty integer not null
    ) on commit drop;

    insert into tmp_stock_import (sku, name, stock_qty)
    select distinct on (sku)
        sku,
        name,
        stock_qty
    from (
        select
            public.normalize_inventory_sku(value->>'sku') as sku,
            trim(coalesce(value->>'name', '')) as name,
            case
                when jsonb_typeof(value->'stock_qty') = 'number' then greatest(floor((value->>'stock_qty')::numeric)::integer, 0)
                else
                    case
                        when regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g') ~ '^-?[0-9]+$'
                            then greatest((regexp_replace(trim(coalesce(value->>'stock_qty', '')), '[^0-9-]', '', 'g'))::integer, 0)
                        else 0
                    end
            end as stock_qty
        from jsonb_array_elements(p_items) as value
    ) src
    where sku <> ''
      and name <> ''
    order by sku;

    select count(*) into v_processed_count from tmp_stock_import;

    if v_processed_count = 0 then
        raise exception 'No se encontraron datos válidos para importar stock';
    end if;

    create temp table tmp_stock_existing on commit drop as
    select
        t.sku,
        t.name,
        t.stock_qty,
        coalesce(i.id, gen_random_uuid()) as inventory_id,
        i.id as existing_id,
        coalesce(i.stock_qty, 0)::integer as stock_before,
        coalesce(pc.price, i.price, 0) as price,
        coalesce(i.category, 'General') as category,
        coalesce(i.min_stock_alert, 5)::integer as min_stock_alert,
        coalesce(i.target_coverage_days, 30)::integer as target_coverage_days,
        coalesce(nullif(trim(coalesce(i.sku, '')), ''), t.sku) as target_sku,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), t.name) as target_name
    from tmp_stock_import t
    left join lateral (
        select i.*
        from public.inventory i
        where public.normalize_inventory_sku(i.sku) = t.sku
        order by
            case when i.sku like '''%' then 0 else 1 end,
            case when i.supplier_id is not null then 0 else 1 end,
            case when coalesce(i.price, 0) > 0 then 0 else 1 end,
            i.created_at asc,
            i.id asc
        limit 1
    ) i on true
    left join lateral (
        select pc.*
        from public.inventory_price_catalog pc
        where public.normalize_inventory_sku(pc.sku) = t.sku
        order by
            case when pc.sku like '''%' then 0 else 1 end,
            case when coalesce(pc.price, 0) > 0 then 0 else 1 end,
            pc.updated_at desc,
            pc.created_at asc,
            pc.sku asc
        limit 1
    ) pc on true;

    insert into public.inventory (
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
    select
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
    from tmp_stock_existing
    on conflict (id) do update
    set sku = excluded.sku,
        name = excluded.name,
        stock_qty = excluded.stock_qty,
        price = excluded.price,
        category = excluded.category,
        min_stock_alert = excluded.min_stock_alert,
        target_coverage_days = excluded.target_coverage_days,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid();

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
        performed_by
    )
    select
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
    from tmp_stock_existing tse
    where tse.existing_id is not null
      and tse.stock_before <> tse.stock_qty;

    get diagnostics v_changed_count = row_count;

    update public.inventory i
    set stock_qty = 0,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid()
    where not exists (
        select 1
        from tmp_stock_import t
        where public.normalize_inventory_sku(i.sku) = t.sku
    )
      and coalesce(i.stock_qty, 0) <> 0
      and coalesce(i.is_service_item, false) = false
      and exists (
        select 1
        from public.inventory_movements im
        where im.inventory_id = i.id
          and im.direction = 'out'
          and im.source_table = 'order_items'
    );

    get diagnostics v_deleted_count = row_count;

    update public.inventory i
    set stock_qty = 0,
        last_stock_reviewed_at = now(),
        last_stock_reviewed_by = auth.uid()
    where not exists (
        select 1
        from tmp_stock_import t
        where public.normalize_inventory_sku(i.sku) = t.sku
    )
      and coalesce(i.stock_qty, 0) <> 0
      and coalesce(i.is_service_item, false) = false
      and not exists (
        select 1
        from public.inventory_movements im
        where im.inventory_id = i.id
          and im.direction = 'out'
          and im.source_table = 'order_items'
    );

    get diagnostics v_preserved_count = row_count;

    return jsonb_build_object(
        'processed_count', v_processed_count,
        'deleted_count', v_deleted_count,
        'preserved_historical_count', v_preserved_count,
        'changed_count', v_changed_count
    );
end;
$$;

create or replace function public.replace_inventory_pricing_import(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_stored_count integer := 0;
    v_synced_count integer := 0;
    v_catalog_only_count integer := 0;
begin
    if auth.uid() is null then
        raise exception 'Usuario no autenticado';
    end if;

    if not public.auth_user_has_permission('UPLOAD_EXCEL') then
        raise exception 'No tienes permisos para importar precios';
    end if;

    if jsonb_typeof(p_items) <> 'array' then
        raise exception 'p_items debe ser un arreglo JSON';
    end if;

    create temp table tmp_pricing_import (
        sku text primary key,
        price numeric not null
    ) on commit drop;

    insert into tmp_pricing_import (sku, price)
    select distinct on (sku)
        sku,
        price
    from (
        select
            public.normalize_inventory_sku(value->>'sku') as sku,
            public.parse_inventory_import_price(value->>'price') as price
        from jsonb_array_elements(p_items) as value
    ) src
    where sku <> ''
      and price is not null
    order by sku;

    if not exists (select 1 from tmp_pricing_import) then
        raise exception 'No se encontraron datos válidos para importar precios';
    end if;

    create temp table tmp_pricing_apply on commit drop as
    select
        coalesce(c.sku, p.sku) as catalog_sku,
        p.sku as normalized_sku,
        p.price,
        i.id as inventory_id,
        coalesce(nullif(trim(coalesce(i.name, '')), ''), c.product_name) as product_name
    from tmp_pricing_import p
    left join lateral (
        select i.*
        from public.inventory i
        where public.normalize_inventory_sku(i.sku) = p.sku
        order by
            case when i.sku like '''%' then 0 else 1 end,
            case when i.supplier_id is not null then 0 else 1 end,
            case when coalesce(i.price, 0) > 0 then 0 else 1 end,
            i.created_at asc,
            i.id asc
        limit 1
    ) i on true
    left join lateral (
        select c.*
        from public.inventory_price_catalog c
        where public.normalize_inventory_sku(c.sku) = p.sku
        order by
            case when c.sku like '''%' then 0 else 1 end,
            case when coalesce(c.price, 0) > 0 then 0 else 1 end,
            c.updated_at desc,
            c.created_at asc,
            c.sku asc
        limit 1
    ) c on true;

    insert into public.inventory_price_catalog (
        sku,
        product_name,
        price,
        created_at,
        updated_at
    )
    select
        catalog_sku,
        product_name,
        price,
        timezone('utc', now()),
        timezone('utc', now())
    from tmp_pricing_apply
    on conflict (sku) do update
    set product_name = coalesce(excluded.product_name, public.inventory_price_catalog.product_name),
        price = excluded.price,
        updated_at = timezone('utc', now());
    get diagnostics v_stored_count = row_count;

    update public.inventory i
    set price = a.price
    from tmp_pricing_apply a
    where i.id = a.inventory_id;
    get diagnostics v_synced_count = row_count;

    select count(*)
    into v_catalog_only_count
    from tmp_pricing_apply
    where inventory_id is null;

    return jsonb_build_object(
        'stored_count', v_stored_count,
        'synced_inventory_count', v_synced_count,
        'catalog_only_count', v_catalog_only_count
    );
end;
$$;

drop table if exists tmp_inventory_catalog_merge;
create temp table tmp_inventory_catalog_merge as
with ranked as (
    select
        sku,
        public.normalize_inventory_sku(sku) as normalized_sku,
        product_name,
        price,
        created_at,
        updated_at,
        row_number() over (
            partition by public.normalize_inventory_sku(sku)
            order by
                case when sku like '''%' then 0 else 1 end,
                case when coalesce(price, 0) > 0 then 0 else 1 end,
                updated_at desc,
                created_at asc,
                sku asc
        ) as rn
    from public.inventory_price_catalog
    where sku is not null
      and public.normalize_inventory_sku(sku) ~ '^[0-9]+$'
)
select
    d.sku as duplicate_sku,
    c.sku as canonical_sku,
    d.normalized_sku
from ranked d
join ranked c
  on c.normalized_sku = d.normalized_sku
 and c.rn = 1
where d.rn > 1;

update public.inventory_price_catalog c
set product_name = coalesce(
        nullif(trim(c.product_name), ''),
        agg.best_product_name,
        c.product_name
    ),
    price = coalesce(
        nullif(c.price, 0),
        agg.best_price,
        c.price
    ),
    updated_at = timezone('utc', now())
from (
    select
        rows.canonical_sku,
        max(nullif(trim(pc.product_name), '')) as best_product_name,
        max(pc.price) filter (where coalesce(pc.price, 0) > 0) as best_price
    from (
        select canonical_sku, canonical_sku as sku
        from tmp_inventory_catalog_merge
        union
        select canonical_sku, duplicate_sku as sku
        from tmp_inventory_catalog_merge
    ) rows
    join public.inventory_price_catalog pc
      on pc.sku = rows.sku
    group by rows.canonical_sku
) agg
where c.sku = agg.canonical_sku;

delete from public.inventory_price_catalog pc
using tmp_inventory_catalog_merge m
where pc.sku = m.duplicate_sku;

drop table if exists tmp_inventory_sku_merge;
create temp table tmp_inventory_sku_merge as
with ranked as (
    select
        id,
        public.normalize_inventory_sku(sku) as normalized_sku,
        sku,
        name,
        price,
        stock_qty,
        supplier_id,
        category,
        min_stock_alert,
        target_coverage_days,
        created_at,
        row_number() over (
            partition by public.normalize_inventory_sku(sku)
            order by
                case when supplier_id is not null then 0 else 1 end,
                case when coalesce(price, 0) > 0 then 0 else 1 end,
                case when sku like '''%' then 0 else 1 end,
                created_at asc,
                id asc
        ) as rn
    from public.inventory
    where sku is not null
      and public.normalize_inventory_sku(sku) ~ '^[0-9]+$'
)
select
    d.id as duplicate_id,
    c.id as canonical_id,
    d.normalized_sku
from ranked d
join ranked c
  on c.normalized_sku = d.normalized_sku
 and c.rn = 1
where d.rn > 1;

update public.inventory canonical
set stock_qty = agg.merged_stock_qty,
    price = coalesce(
        nullif(canonical.price, 0),
        agg.best_price,
        canonical.price
    ),
    supplier_id = coalesce(canonical.supplier_id, agg.best_supplier_id),
    name = coalesce(
        nullif(trim(canonical.name), ''),
        agg.best_name,
        canonical.name
    ),
    category = coalesce(
        nullif(trim(canonical.category), ''),
        agg.best_category,
        canonical.category
    )
from (
    select
        rows.canonical_id,
        sum(coalesce(i.stock_qty, 0))::integer as merged_stock_qty,
        max(i.price) filter (where coalesce(i.price, 0) > 0) as best_price,
        (
            array_agg(i.supplier_id order by i.created_at asc, i.id asc)
            filter (where i.supplier_id is not null)
        )[1] as best_supplier_id,
        max(nullif(trim(i.name), '')) as best_name,
        max(nullif(trim(i.category), '')) as best_category
    from (
        select canonical_id, canonical_id as row_id
        from tmp_inventory_sku_merge
        union
        select canonical_id, duplicate_id as row_id
        from tmp_inventory_sku_merge
    ) rows
    join public.inventory i
      on i.id = rows.row_id
    group by rows.canonical_id
) agg
where canonical.id = agg.canonical_id;

update public.order_items oi
set product_id = m.canonical_id
from tmp_inventory_sku_merge m
where oi.product_id = m.duplicate_id;

update public.inventory_movements im
set inventory_id = m.canonical_id
from tmp_inventory_sku_merge m
where im.inventory_id = m.duplicate_id;

update public.product_requests pr
set product_id = m.canonical_id
from tmp_inventory_sku_merge m
where pr.product_id = m.duplicate_id;

update public.purchase_order_items poi
set inventory_id = m.canonical_id
from tmp_inventory_sku_merge m
where poi.inventory_id = m.duplicate_id;

update public.inbound_shipment_items isi
set product_id = m.canonical_id
from tmp_inventory_sku_merge m
where isi.product_id = m.duplicate_id;

update public.size_change_request_items sci
set product_id = m.canonical_id
from tmp_inventory_sku_merge m
where sci.product_id = m.duplicate_id;

delete from public.inventory i
using tmp_inventory_sku_merge m
where i.id = m.duplicate_id;

notify pgrst, 'reload schema';
