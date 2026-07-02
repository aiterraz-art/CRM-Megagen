update public.clients
set requires_discount_approval = true
where coalesce(requires_discount_approval, false) = false;

alter table public.clients
alter column requires_discount_approval set default true;
