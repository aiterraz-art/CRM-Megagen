alter table public.clients enable row level security;

drop policy if exists "Sellers view clients from own quotations" on public.clients;

create policy "Sellers view clients from own quotations"
on public.clients
for select
to public
using (
  exists (
    select 1
    from public.quotations q
    where q.client_id = clients.id
      and q.seller_id = auth.uid()
  )
);
