drop policy if exists "Admins can update all profiles" on public.profiles;

create policy "Admins can update all profiles"
on public.profiles
for update
to authenticated
using (
  public.auth_user_has_permission('MANAGE_USERS')
)
with check (
  public.auth_user_has_permission('MANAGE_USERS')
);
