alter table public.clients
add column if not exists requires_discount_approval boolean not null default false;
