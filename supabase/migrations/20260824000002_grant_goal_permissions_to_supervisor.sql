insert into public.role_permissions (role, permission)
values
    ('supervisor', 'VIEW_METAS'),
    ('supervisor', 'MANAGE_METAS')
on conflict (role, permission) do nothing;

notify pgrst, 'reload schema';
