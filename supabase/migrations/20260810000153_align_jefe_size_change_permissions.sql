insert into public.role_permissions (role, permission)
select v.role, v.permission
from (
  values
    ('jefe', 'VIEW_SIZE_CHANGES'),
    ('jefe', 'CREATE_SIZE_CHANGES'),
    ('jefe', 'MANAGE_SIZE_CHANGES')
) as v(role, permission)
where not exists (
  select 1
  from public.role_permissions rp
  where lower(coalesce(rp.role, '')) = lower(v.role)
    and rp.permission = v.permission
);

