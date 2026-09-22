-- Siembra de la matriz de permisos.
--
-- Contexto: el cliente dejo de fusionar sus valores por defecto con lo almacenado en
-- esta tabla, porque esa fusion impedia revocar cualquier permiso incluido en la semilla.
-- A partir de ahora role_permissions es la fuente de verdad y los valores por defecto del
-- cliente solo actuan como respaldo cuando la consulta falla o cuando la tabla nunca fue
-- inicializada.
--
-- Esta migracion es deliberadamente conservadora: solo siembra si la tabla esta
-- completamente vacia. Si ya existe una configuracion, no se toca ninguna fila, de modo
-- que ninguna revocacion previa se revierta al desplegar.

DO $$
BEGIN
    IF to_regclass('public.role_permissions') IS NULL THEN
        RAISE NOTICE 'role_permissions no existe en esta instancia, se omite la siembra';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM public.role_permissions) THEN
        RAISE NOTICE 'role_permissions ya tiene configuracion, no se modifica';
        RETURN;
    END IF;

    INSERT INTO public.role_permissions (role, permission)
    VALUES
            ('admin', 'UPLOAD_EXCEL'),
            ('admin', 'MANAGE_INVENTORY'),
            ('admin', 'MANAGE_PRICING'),
            ('admin', 'VIEW_METAS'),
            ('admin', 'MANAGE_METAS'),
            ('admin', 'MANAGE_DISPATCH'),
            ('admin', 'EXECUTE_DELIVERY'),
            ('admin', 'MANAGE_USERS'),
            ('admin', 'MANAGE_PERMISSIONS'),
            ('admin', 'VIEW_ALL_CLIENTS'),
            ('admin', 'MANAGE_CLIENTS'),
            ('admin', 'IMPORT_CLIENTS'),
            ('admin', 'VIEW_TEAM_STATS'),
            ('admin', 'VIEW_ALL_TEAM_STATS'),
            ('admin', 'VIEW_OPERATIONS'),
            ('admin', 'MANAGE_AUTOMATIONS'),
            ('admin', 'MANAGE_SLA'),
            ('admin', 'MANAGE_APPROVALS'),
            ('admin', 'MANAGE_POSTSALE'),
            ('admin', 'MANAGE_COLLECTIONS'),
            ('admin', 'VIEW_TEAM_CALENDARS'),
            ('admin', 'VIEW_PROCUREMENT'),
            ('admin', 'REQUEST_PRODUCTS'),
            ('admin', 'MANAGE_PROCUREMENT'),
            ('admin', 'VIEW_PURCHASE_ORDERS'),
            ('admin', 'MANAGE_PURCHASE_ORDERS'),
            ('admin', 'VIEW_SUPPLIER_PAYABLES'),
            ('admin', 'MANAGE_SUPPLIER_PAYABLES'),
            ('admin', 'VIEW_KIT_LOANS'),
            ('admin', 'REQUEST_KIT_LOANS'),
            ('admin', 'MANAGE_KIT_LOANS'),
            ('admin', 'VIEW_SIZE_CHANGES'),
            ('admin', 'CREATE_SIZE_CHANGES'),
            ('admin', 'MANAGE_SIZE_CHANGES'),
            ('jefe', 'MANAGE_INVENTORY'),
            ('jefe', 'VIEW_METAS'),
            ('jefe', 'MANAGE_METAS'),
            ('jefe', 'MANAGE_DISPATCH'),
            ('jefe', 'VIEW_ALL_CLIENTS'),
            ('jefe', 'MANAGE_CLIENTS'),
            ('jefe', 'IMPORT_CLIENTS'),
            ('jefe', 'VIEW_TEAM_STATS'),
            ('jefe', 'VIEW_OPERATIONS'),
            ('jefe', 'MANAGE_SLA'),
            ('jefe', 'MANAGE_APPROVALS'),
            ('jefe', 'VIEW_TEAM_CALENDARS'),
            ('jefe', 'VIEW_PROCUREMENT'),
            ('jefe', 'REQUEST_PRODUCTS'),
            ('jefe', 'MANAGE_PROCUREMENT'),
            ('jefe', 'VIEW_KIT_LOANS'),
            ('jefe', 'REQUEST_KIT_LOANS'),
            ('jefe', 'VIEW_SIZE_CHANGES'),
            ('jefe', 'CREATE_SIZE_CHANGES'),
            ('jefe', 'MANAGE_SIZE_CHANGES'),
            ('jefe', 'VIEW_SUPPLIER_PAYABLES'),
            ('jefe', 'MANAGE_SUPPLIER_PAYABLES'),
            ('bodega', 'UPLOAD_EXCEL'),
            ('bodega', 'MANAGE_INVENTORY'),
            ('bodega', 'MANAGE_PRICING'),
            ('bodega', 'VIEW_PROCUREMENT'),
            ('bodega', 'REQUEST_PRODUCTS'),
            ('bodega', 'MANAGE_PROCUREMENT'),
            ('bodega', 'VIEW_PURCHASE_ORDERS'),
            ('bodega', 'MANAGE_PURCHASE_ORDERS'),
            ('facturador', 'UPLOAD_EXCEL'),
            ('facturador', 'MANAGE_INVENTORY'),
            ('facturador', 'MANAGE_PRICING'),
            ('facturador', 'MANAGE_DISPATCH'),
            ('facturador', 'VIEW_ALL_CLIENTS'),
            ('facturador', 'VIEW_OPERATIONS'),
            ('facturador', 'MANAGE_COLLECTIONS'),
            ('facturador', 'VIEW_KIT_LOANS'),
            ('facturador', 'MANAGE_KIT_LOANS'),
            ('facturador', 'VIEW_SIZE_CHANGES'),
            ('facturador', 'MANAGE_SIZE_CHANGES'),
            ('facturador', 'VIEW_PURCHASE_ORDERS'),
            ('facturador', 'MANAGE_PURCHASE_ORDERS'),
            ('tesorero', 'UPLOAD_EXCEL'),
            ('tesorero', 'MANAGE_INVENTORY'),
            ('tesorero', 'MANAGE_PRICING'),
            ('tesorero', 'MANAGE_DISPATCH'),
            ('tesorero', 'VIEW_ALL_CLIENTS'),
            ('tesorero', 'MANAGE_CLIENTS'),
            ('tesorero', 'VIEW_OPERATIONS'),
            ('tesorero', 'MANAGE_COLLECTIONS'),
            ('tesorero', 'VIEW_KIT_LOANS'),
            ('tesorero', 'MANAGE_KIT_LOANS'),
            ('tesorero', 'VIEW_SIZE_CHANGES'),
            ('tesorero', 'MANAGE_SIZE_CHANGES'),
            ('seller', 'VIEW_METAS'),
            ('seller', 'VIEW_PROCUREMENT'),
            ('seller', 'REQUEST_PRODUCTS'),
            ('seller', 'VIEW_KIT_LOANS'),
            ('seller', 'REQUEST_KIT_LOANS'),
            ('seller', 'VIEW_SIZE_CHANGES'),
            ('seller', 'CREATE_SIZE_CHANGES'),
            ('driver', 'EXECUTE_DELIVERY')
    ON CONFLICT (role, permission) DO NOTHING;

    RAISE NOTICE 'role_permissions sembrada con la matriz base';
END $$;
