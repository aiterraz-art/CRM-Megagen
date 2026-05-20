INSERT INTO public.role_permissions (role, permission)
SELECT seed.role, seed.permission
FROM (
    VALUES
        ('admin', 'UPLOAD_EXCEL'),
        ('bodega', 'UPLOAD_EXCEL'),
        ('facturador', 'UPLOAD_EXCEL'),
        ('tesorero', 'UPLOAD_EXCEL')
) AS seed(role, permission)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = seed.role
      AND rp.permission = seed.permission
);
