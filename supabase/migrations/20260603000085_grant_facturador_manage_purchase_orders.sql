INSERT INTO public.role_permissions (role, permission)
SELECT 'facturador', 'MANAGE_PURCHASE_ORDERS'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role = 'facturador'
      AND permission = 'MANAGE_PURCHASE_ORDERS'
);
