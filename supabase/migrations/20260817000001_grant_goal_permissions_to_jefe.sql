insert into public.role_permissions (role, permission)
values
    ('jefe', 'VIEW_METAS'),
    ('jefe', 'MANAGE_METAS')
on conflict (role, permission) do nothing;

notify pgrst, 'reload schema';
