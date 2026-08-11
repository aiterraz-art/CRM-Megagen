alter table public.inbound_shipments
    add column if not exists tracking_number text;
