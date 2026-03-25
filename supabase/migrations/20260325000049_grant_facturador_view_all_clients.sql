INSERT INTO public.role_permissions (role, permission)
SELECT 'facturador', 'VIEW_ALL_CLIENTS'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE lower(coalesce(role, '')) = 'facturador'
      AND permission = 'VIEW_ALL_CLIENTS'
);
