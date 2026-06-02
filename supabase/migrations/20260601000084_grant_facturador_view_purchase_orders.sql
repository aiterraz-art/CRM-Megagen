INSERT INTO public.role_permissions (role, permission)
SELECT 'facturador', 'VIEW_PURCHASE_ORDERS'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role = 'facturador'
      AND permission = 'VIEW_PURCHASE_ORDERS'
);
