alter table if exists public.goals enable row level security;

drop policy if exists "View goals" on public.goals;
drop policy if exists "Manage goals" on public.goals;

create policy "View goals"
on public.goals
for select
to public
using (
  uid() = user_id
  or public.auth_user_has_permission('VIEW_METAS')
  or public.auth_user_has_permission('MANAGE_METAS')
);

create policy "Manage goals"
on public.goals
for all
to public
using (
  public.auth_user_has_permission('MANAGE_METAS')
)
with check (
  public.auth_user_has_permission('MANAGE_METAS')
);

