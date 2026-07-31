alter table public.orders
    add column if not exists shipment_method text not null default 'local_dispatch',
    add column if not exists courier_name text,
    add column if not exists tracking_number text,
    add column if not exists courier_marked_at timestamptz,
    add column if not exists courier_marked_by uuid references public.profiles(id) on delete set null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'orders_shipment_method_ck'
    ) then
        alter table public.orders
            add constraint orders_shipment_method_ck
            check (shipment_method in ('local_dispatch', 'courier'));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'orders_courier_name_ck'
    ) then
        alter table public.orders
            add constraint orders_courier_name_ck
            check (courier_name is null or courier_name in ('chileexpress', 'fedex'));
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'orders_courier_tracking_required_ck'
    ) then
        alter table public.orders
            add constraint orders_courier_tracking_required_ck
            check (
                shipment_method <> 'courier'
                or (
                    courier_name is not null
                    and nullif(btrim(coalesce(tracking_number, '')), '') is not null
                )
            );
    end if;
end $$;
