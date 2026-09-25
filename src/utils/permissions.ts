/**
 * Fuente única de verdad del modelo RBAC del CRM.
 *
 * Tanto el contexto de usuario como la matriz de configuración consumen este módulo,
 * de modo que el catálogo de permisos, la normalización de roles y los valores por
 * defecto no puedan divergir entre la pantalla que otorga los accesos y la que los aplica.
 */
import { supabase } from '../services/supabase';

export type PermissionModuleId =
    | 'clients'
    | 'quotations'
    | 'orders'
    | 'field'
    | 'leads'
    | 'collections'
    | 'inventory'
    | 'procurement'
    | 'logistics'
    | 'postsale'
    | 'management'
    | 'admin';

export type PermissionDefinition = {
    key: string;
    label: string;
    desc: string;
    module: PermissionModuleId;
};

/** Módulos en el orden en que se agrupan los permisos en pantalla. */
export const PERMISSION_MODULES: { id: PermissionModuleId; label: string }[] = [
    { id: 'clients', label: 'Clientes' },
    { id: 'quotations', label: 'Cotizaciones' },
    { id: 'orders', label: 'Pedidos' },
    { id: 'field', label: 'Terreno y Equipo' },
    { id: 'leads', label: 'Leads' },
    { id: 'collections', label: 'Cobranzas' },
    { id: 'inventory', label: 'Inventario' },
    { id: 'procurement', label: 'Compras y Proveedores' },
    { id: 'logistics', label: 'Despacho y Entregas' },
    { id: 'postsale', label: 'Kits y Cambios de Medida' },
    { id: 'management', label: 'Gestión y Operaciones' },
    { id: 'admin', label: 'Administración' }
];

export type RolePermissionRow = {
    role: string;
    permission: string;
};

export type PermissionOverrideEffect = 'grant' | 'deny';

/** Excepción individual: otorga o quita un permiso a una persona por encima de su rol. */
export type UserPermissionOverride = {
    permission: string;
    effect: PermissionOverrideEffect;
};

/** Origen efectivo del conjunto de permisos resuelto, para diagnóstico y trazabilidad. */
export type RolePermissionSource = 'database' | 'defaults';

export type ResolvedRolePermissions = {
    permissions: string[];
    source: RolePermissionSource;
};

export const PERMISSION_CATALOG: PermissionDefinition[] = [
    // Clientes
    { key: 'VIEW_CLIENTS', module: 'clients', label: 'Ver Clientes', desc: 'Acceso al módulo de clientes.' },
    { key: 'VIEW_ALL_CLIENTS', module: 'clients', label: 'Ver Todos Clientes', desc: 'Acceso a la cartera total de clientes (vs solo propios).' },
    { key: 'MANAGE_CLIENTS', module: 'clients', label: 'Gestionar Clientes', desc: 'Editar, eliminar y crear fichas de clientes.' },
    { key: 'ASSIGN_CLIENTS', module: 'clients', label: 'Asignar Clientes', desc: 'Asignar o reasignar el vendedor dueño de clientes y leads del pool.' },
    { key: 'MANAGE_CLIENT_CREDIT', module: 'clients', label: 'Gestionar Crédito', desc: 'Editar los días de crédito de los clientes.' },
    { key: 'MANAGE_DISCOUNT_POLICY', module: 'clients', label: 'Política de Descuento', desc: 'Marcar clientes cuyos descuentos requieren aprobación.' },
    { key: 'MERGE_CLIENTS', module: 'clients', label: 'Fusionar Duplicados', desc: 'Fusionar fichas de clientes duplicadas.' },
    { key: 'IMPORT_CLIENTS', module: 'clients', label: 'Importar Clientes', desc: 'Subida masiva de clientes vía CSV y leads de Meta.' },
    { key: 'ARCHIVE_CLIENTS', module: 'clients', label: 'Archivar Clientes', desc: 'Archivar clientes sin valor y reasignar la cartera de vendedores dados de baja.' },
    // Cotizaciones
    { key: 'VIEW_QUOTATIONS', module: 'quotations', label: 'Ver Cotizaciones', desc: 'Acceso al módulo de cotizaciones.' },
    { key: 'VIEW_ALL_QUOTATIONS', module: 'quotations', label: 'Ver Todas las Cotizaciones', desc: 'Ver las cotizaciones de todo el equipo (vs solo propias).' },
    { key: 'ASSIGN_QUOTATION_SELLER', module: 'quotations', label: 'Cotizar a Nombre de Otro', desc: 'Elegir el vendedor asignado al crear o editar una cotización.' },
    { key: 'MANAGE_ALL_QUOTATIONS', module: 'quotations', label: 'Editar Cotizaciones de Otros', desc: 'Crear, editar y eliminar cotizaciones de otros vendedores.' },
    { key: 'CONVERT_ANY_QUOTATION', module: 'quotations', label: 'Cerrar Ventas de Otros', desc: 'Editar y convertir en pedido cotizaciones de otros vendedores.' },
    { key: 'EDIT_QUOTE_PRICES', module: 'quotations', label: 'Editar Precio en Cotización', desc: 'Modificar manualmente el precio unitario o neto de una línea.' },
    { key: 'BYPASS_DISCOUNT_LIMIT', module: 'quotations', label: 'Sin Tope de Descuento', desc: 'No se aplica el tope de descuento definido para vendedores.' },
    { key: 'SIMULATE_LOCATION', module: 'quotations', label: 'Simular Ubicación', desc: 'Fijar manualmente la ubicación al cotizar.' },
    { key: 'VIEW_AUDIT_TRACE', module: 'quotations', label: 'Ver Trazabilidad', desc: 'Ver la traza técnica de conversión de cotización a pedido.' },
    // Pedidos
    { key: 'VIEW_ALL_ORDERS', module: 'orders', label: 'Ver Todos los Pedidos', desc: 'Ver los pedidos de todo el equipo (vs solo propios).' },
    { key: 'MANAGE_ALL_ORDERS', module: 'orders', label: 'Editar Pedidos de Otros', desc: 'Crear, editar y eliminar pedidos de otros vendedores.' },
    { key: 'RESEND_ORDER_EMAIL', module: 'orders', label: 'Reenviar Correo de Pedido', desc: 'Reenviar la notificación de pedidos ajenos (el propio siempre se puede).' },
    { key: 'CANCEL_ORDERS', module: 'orders', label: 'Anular Pedidos', desc: 'Anular pedidos de cualquier vendedor y reabrir la cotización.' },
    { key: 'MANAGE_COURIER_SHIPMENTS', module: 'orders', label: 'Gestionar Envíos Courier', desc: 'Registrar despacho por courier y número de seguimiento en pedidos.' },
    // Terreno y equipo
    { key: 'VIEW_SCHEDULE', module: 'field', label: 'Ver Agenda', desc: 'Acceso a la agenda de actividades.' },
    { key: 'VIEW_VISITS', module: 'field', label: 'Ver Visitas', desc: 'Visita en frío e historial de visitas.' },
    { key: 'CONVERT_COLD_VISITS', module: 'field', label: 'Convertir Visitas en Frío', desc: 'Crear cliente y venta a partir de una visita en frío.' },
    { key: 'VIEW_MAP', module: 'field', label: 'Ver Mapa', desc: 'Mapa de clientes.' },
    { key: 'VIEW_PIPELINE', module: 'field', label: 'Ver Embudo', desc: 'Embudo de ventas.' },
    { key: 'VIEW_TEAM_STATS', module: 'field', label: 'Panel Equipo', desc: 'Acceso a estadísticas, rutas y supervisión de representantes.' },
    { key: 'VIEW_ALL_TEAM_STATS', module: 'field', label: 'Ver Todo el Equipo', desc: 'Supervisión global (vs solo subordinados directos).' },
    { key: 'VIEW_TEAM_CALENDARS', module: 'field', label: 'Calendarios del Equipo', desc: 'Permite ver Google Calendar de otros vendedores compartidos por Workspace.' },
    { key: 'SEND_TEAM_PUSH', module: 'field', label: 'Enviar Avisos al Equipo', desc: 'Enviar notificaciones push de reuniones al equipo.' },
    { key: 'VIEW_METAS', module: 'field', label: 'Ver Metas', desc: 'Visualizar indicadores de venta y facturación.' },
    { key: 'MANAGE_METAS', module: 'field', label: 'Configurar Metas', desc: 'Asignar objetivos comerciales a vendedores.' },
    // Leads
    { key: 'VIEW_LEADS', module: 'leads', label: 'Ver Leads', desc: 'Acceso al embudo de leads y a los mensajes.' },
    { key: 'VIEW_ALL_LEADS', module: 'leads', label: 'Ver Todos los Leads', desc: 'Ver los leads de todo el equipo y los no asignados.' },
    { key: 'MANAGE_LEAD_TEMPLATES', module: 'leads', label: 'Gestionar Plantillas', desc: 'Crear y editar plantillas y adjuntos de mensajes a leads.' },
    { key: 'VIEW_META_LEADS', module: 'leads', label: 'Ver Meta Leads', desc: 'Acceso al módulo de leads recibidos desde Meta.' },
    { key: 'VIEW_REACTIVATION', module: 'leads', label: 'Ver Reactivación', desc: 'Acceso al módulo y a los casos de reactivación asignados a uno mismo.' },
    { key: 'MANAGE_REACTIVATION', module: 'leads', label: 'Gestionar Reactivación', desc: 'Repartir casos entre vendedores, reasignarlos y cerrarlos por descarte.' },
    { key: 'VIEW_ALL_REACTIVATION', module: 'leads', label: 'Ver Toda la Reactivación', desc: 'Ver los casos de todo el equipo, no solo los propios.' },
    // Cobranzas
    { key: 'VIEW_COLLECTIONS', module: 'collections', label: 'Ver Cobranzas', desc: 'Acceso al módulo de cobranzas.' },
    { key: 'VIEW_ALL_COLLECTIONS', module: 'collections', label: 'Ver Toda la Cobranza', desc: 'Ver la cobranza de todos los vendedores (vs solo propia).' },
    { key: 'COMMENT_COLLECTIONS', module: 'collections', label: 'Comentar Cobranzas', desc: 'Agregar comentarios y comprobantes de pago.' },
    { key: 'MANAGE_COLLECTIONS', module: 'collections', label: 'Gestionar Cobranzas', desc: 'Subir y administrar información de cobranzas.' },
    // Inventario
    { key: 'VIEW_INVENTORY', module: 'inventory', label: 'Ver Inventario', desc: 'Acceso al módulo de inventario.' },
    { key: 'VIEW_INVENTORY_VALUE', module: 'inventory', label: 'Ver Valorización', desc: 'Ver precios y valor total del stock.' },
    { key: 'VIEW_INVENTORY_ANALYTICS', module: 'inventory', label: 'Ver Análisis de Stock', desc: 'Rotación, movimientos, mínimos y análisis de stock.' },
    { key: 'MANAGE_INVENTORY', module: 'inventory', label: 'Gestión Inventario', desc: 'Crear, editar y eliminar productos.' },
    { key: 'MANAGE_PRICING', module: 'inventory', label: 'Modificar Precios', desc: 'Cambiar precios de venta.' },
    { key: 'MANAGE_STOCKLESS_SALES', module: 'inventory', label: 'Venta sin Stock', desc: 'Configurar qué productos se pueden vender sin stock.' },
    { key: 'DOWNLOAD_CATALOG', module: 'inventory', label: 'Descargar Catálogo', desc: 'Exportar el catálogo de productos.' },
    { key: 'UPLOAD_EXCEL', module: 'inventory', label: 'Cargar Excel', desc: 'Permite subir archivos de inventario, precios y despacho.' },
    { key: 'MANAGE_WEB_STORE', module: 'inventory', label: 'Gestionar Tienda Web', desc: 'Conexión y sincronización de stock con la tienda web.' },
    // Compras y proveedores
    { key: 'VIEW_PROCUREMENT', module: 'procurement', label: 'Ver Compras', desc: 'Acceso al módulo de solicitudes de productos e importaciones en tránsito.' },
    { key: 'REQUEST_PRODUCTS', module: 'procurement', label: 'Solicitar Productos', desc: 'Permite crear solicitudes de compra o reposición.' },
    { key: 'MANAGE_PROCUREMENT', module: 'procurement', label: 'Gestionar Compras', desc: 'Permite administrar solicitudes, importaciones y vínculos con embarques.' },
    { key: 'RECEIVE_IMPORTS', module: 'procurement', label: 'Recepcionar Importaciones', desc: 'Marcar importaciones como recibidas.' },
    { key: 'VIEW_PURCHASE_ORDERS', module: 'procurement', label: 'Ver Órdenes de Compra', desc: 'Acceso al módulo logístico de órdenes de compra y proveedores.' },
    { key: 'MANAGE_PURCHASE_ORDERS', module: 'procurement', label: 'Gestionar Órdenes de Compra', desc: 'Permite crear, editar y cancelar órdenes de compra.' },
    { key: 'SEND_PURCHASE_ORDER_EMAIL', module: 'procurement', label: 'Enviar OC al Proveedor', desc: 'Enviar y reenviar por correo las órdenes de compra.' },
    { key: 'VIEW_SUPPLIER_PAYABLES', module: 'procurement', label: 'Ver Cuentas por Pagar', desc: 'Acceso al módulo de deudas pendientes con proveedores.' },
    { key: 'MANAGE_SUPPLIER_PAYABLES', module: 'procurement', label: 'Gestionar Cuentas por Pagar', desc: 'Permite registrar, editar y cerrar deudas con proveedores.' },
    // Despacho y entregas
    { key: 'MANAGE_DISPATCH', module: 'logistics', label: 'Gestionar Despacho', desc: 'Importar facturas, crear y asignar rutas de transporte.' },
    { key: 'EXECUTE_DELIVERY', module: 'logistics', label: 'Realizar Entregas', desc: 'Módulo de repartidor para completar pedidos.' },
    { key: 'VIEW_DELIVERY_STATUS', module: 'logistics', label: 'Ver Estado de Entregas', desc: 'Seguimiento de la entrega de los pedidos.' },
    // Kits y cambios de medida
    { key: 'VIEW_KIT_LOANS', module: 'postsale', label: 'Ver Kits', desc: 'Acceso al módulo de préstamo y seguimiento de kits clínicos.' },
    { key: 'REQUEST_KIT_LOANS', module: 'postsale', label: 'Solicitar Kits', desc: 'Permite crear solicitudes de préstamo de kits para clientes.' },
    { key: 'MANAGE_KIT_LOANS', module: 'postsale', label: 'Gestionar Kits', desc: 'Permite registrar kits, despachar préstamos y cerrar devoluciones.' },
    { key: 'VIEW_SIZE_CHANGES', module: 'postsale', label: 'Ver Cambios de Medida', desc: 'Acceso al módulo comercial de solicitudes de cambio de medida.' },
    { key: 'CREATE_SIZE_CHANGES', module: 'postsale', label: 'Crear Cambios de Medida', desc: 'Permite crear solicitudes de cambio para clientes.' },
    { key: 'MANAGE_SIZE_CHANGES', module: 'postsale', label: 'Gestionar Cambios de Medida', desc: 'Permite editar, enviar, cerrar y cancelar cambios de medida.' },
    { key: 'MANAGE_POSTSALE', module: 'postsale', label: 'Gestionar Postventa', desc: 'Administrar flujos y seguimiento de postventa.' },
    // Gestión y operaciones
    { key: 'VIEW_OPERATIONS', module: 'management', label: 'Ver Operaciones', desc: 'Acceso al centro de operaciones y monitoreo operativo.' },
    { key: 'MANAGE_APPROVALS', module: 'management', label: 'Gestionar Aprobaciones', desc: 'Recibir y resolver solicitudes de autorización y descuentos.' },
    { key: 'MANAGE_SLA', module: 'management', label: 'Gestionar SLA', desc: 'Administrar compromisos y tiempos de servicio.' },
    { key: 'MANAGE_AUTOMATIONS', module: 'management', label: 'Gestionar Automatizaciones', desc: 'Configurar reglas automáticas del sistema.' },
    { key: 'MANAGE_SALES_FLOW', module: 'management', label: 'Configurar Flujo de Venta', desc: 'Plazos de pérdida de cotizaciones y alertas de clientes sin gestión.' },
    // Administración
    { key: 'MANAGE_USERS', module: 'admin', label: 'Gestionar Usuarios', desc: 'Invitar usuarios y editar roles y estados de perfiles.' },
    { key: 'MANAGE_PERMISSIONS', module: 'admin', label: 'Matriz Permisos', desc: 'Configurar los accesos de cada rol y las excepciones por persona.' },
    { key: 'MANAGE_INTEGRATIONS', module: 'admin', label: 'Gestionar Integraciones', desc: 'Configurar Google, correos de notificación e integraciones.' }
];

export const PERMISSION_KEYS: string[] = PERMISSION_CATALOG.map((permission) => permission.key);

/** Roles asignables desde la matriz de permisos, en el orden en que se muestran. */
export const ASSIGNABLE_ROLES = ['admin', 'jefe', 'bodega', 'facturador', 'tesorero', 'seller', 'driver'] as const;

export const normalizeRole = (role: string | null | undefined): string => {
    const baseRole = (role || '').trim().toLowerCase();
    if (baseRole === 'manager') return 'admin';
    if (baseRole === 'administrativo') return 'facturador';
    if (baseRole === 'supervisor') return 'jefe';
    return baseRole;
};

export const isBillingBackofficeRole = (role: string | null | undefined): boolean => {
    const normalizedRole = normalizeRole(role);
    return normalizedRole === 'facturador' || normalizedRole === 'tesorero';
};

/**
 * Semilla de permisos por rol. Solo se aplica cuando la base de datos no puede
 * consultarse o cuando la tabla nunca fue inicializada; nunca se fusiona con una
 * configuración existente, porque eso impediría revocar accesos.
 *
 * Refleja la matriz vigente en producción (20260924000027): cada rol recibe
 * exactamente los accesos que tenía cuando se decidían por nombre de rol.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: PERMISSION_KEYS,
    jefe: [
        'VIEW_CLIENTS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'ASSIGN_CLIENTS', 'MANAGE_CLIENT_CREDIT', 'MERGE_CLIENTS', 'IMPORT_CLIENTS', 'ARCHIVE_CLIENTS',
        'VIEW_QUOTATIONS', 'VIEW_ALL_QUOTATIONS', 'MANAGE_ALL_QUOTATIONS', 'EDIT_QUOTE_PRICES', 'BYPASS_DISCOUNT_LIMIT',
        'VIEW_ALL_ORDERS', 'MANAGE_ALL_ORDERS', 'CANCEL_ORDERS', 'MANAGE_COURIER_SHIPMENTS',
        'VIEW_SCHEDULE', 'VIEW_VISITS', 'CONVERT_COLD_VISITS', 'VIEW_MAP', 'VIEW_PIPELINE', 'VIEW_TEAM_STATS', 'VIEW_ALL_TEAM_STATS', 'VIEW_TEAM_CALENDARS', 'SEND_TEAM_PUSH', 'VIEW_METAS', 'MANAGE_METAS',
        'VIEW_LEADS', 'VIEW_ALL_LEADS', 'MANAGE_LEAD_TEMPLATES', 'VIEW_REACTIVATION', 'MANAGE_REACTIVATION', 'VIEW_ALL_REACTIVATION',
        'VIEW_COLLECTIONS', 'VIEW_ALL_COLLECTIONS',
        'VIEW_INVENTORY', 'VIEW_INVENTORY_VALUE', 'VIEW_INVENTORY_ANALYTICS', 'MANAGE_INVENTORY', 'DOWNLOAD_CATALOG',
        'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'MANAGE_PROCUREMENT', 'VIEW_SUPPLIER_PAYABLES', 'MANAGE_SUPPLIER_PAYABLES',
        'VIEW_DELIVERY_STATUS',
        'VIEW_KIT_LOANS', 'REQUEST_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'CREATE_SIZE_CHANGES', 'MANAGE_SIZE_CHANGES',
        'VIEW_OPERATIONS', 'MANAGE_APPROVALS', 'MANAGE_SLA'
    ],
    bodega: [
        'VIEW_CLIENTS', 'VIEW_QUOTATIONS', 'EDIT_QUOTE_PRICES', 'BYPASS_DISCOUNT_LIMIT',
        'VIEW_SCHEDULE', 'VIEW_VISITS', 'VIEW_MAP', 'VIEW_PIPELINE',
        'VIEW_COLLECTIONS', 'VIEW_ALL_COLLECTIONS',
        'VIEW_INVENTORY', 'VIEW_INVENTORY_VALUE', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_STOCKLESS_SALES', 'UPLOAD_EXCEL',
        'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'MANAGE_PROCUREMENT', 'VIEW_PURCHASE_ORDERS', 'MANAGE_PURCHASE_ORDERS', 'SEND_PURCHASE_ORDER_EMAIL'
    ],
    facturador: [
        'VIEW_CLIENTS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENT_CREDIT', 'MERGE_CLIENTS',
        'VIEW_QUOTATIONS', 'VIEW_ALL_QUOTATIONS', 'MANAGE_ALL_QUOTATIONS', 'ASSIGN_QUOTATION_SELLER', 'CONVERT_ANY_QUOTATION', 'EDIT_QUOTE_PRICES', 'BYPASS_DISCOUNT_LIMIT',
        'VIEW_ALL_ORDERS', 'MANAGE_ALL_ORDERS', 'RESEND_ORDER_EMAIL', 'CANCEL_ORDERS', 'MANAGE_COURIER_SHIPMENTS',
        'VIEW_SCHEDULE', 'CONVERT_COLD_VISITS',
        'VIEW_COLLECTIONS', 'VIEW_ALL_COLLECTIONS', 'COMMENT_COLLECTIONS', 'MANAGE_COLLECTIONS',
        'VIEW_INVENTORY', 'VIEW_INVENTORY_VALUE', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'UPLOAD_EXCEL',
        'VIEW_PURCHASE_ORDERS', 'MANAGE_PURCHASE_ORDERS',
        'MANAGE_DISPATCH',
        'VIEW_KIT_LOANS', 'MANAGE_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'MANAGE_SIZE_CHANGES',
        'MANAGE_INTEGRATIONS'
    ],
    tesorero: [
        'VIEW_CLIENTS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'ASSIGN_CLIENTS', 'MERGE_CLIENTS',
        'VIEW_QUOTATIONS', 'VIEW_ALL_QUOTATIONS', 'MANAGE_ALL_QUOTATIONS', 'ASSIGN_QUOTATION_SELLER', 'EDIT_QUOTE_PRICES', 'BYPASS_DISCOUNT_LIMIT',
        'VIEW_ALL_ORDERS', 'MANAGE_ALL_ORDERS', 'RESEND_ORDER_EMAIL', 'CANCEL_ORDERS', 'MANAGE_COURIER_SHIPMENTS',
        'VIEW_SCHEDULE', 'CONVERT_COLD_VISITS',
        'VIEW_COLLECTIONS', 'VIEW_ALL_COLLECTIONS', 'COMMENT_COLLECTIONS', 'MANAGE_COLLECTIONS',
        'VIEW_INVENTORY', 'VIEW_INVENTORY_VALUE', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'UPLOAD_EXCEL',
        'MANAGE_DISPATCH',
        'VIEW_KIT_LOANS', 'MANAGE_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'MANAGE_SIZE_CHANGES',
        'MANAGE_INTEGRATIONS'
    ],
    seller: [
        'VIEW_CLIENTS', 'VIEW_QUOTATIONS',
        'VIEW_SCHEDULE', 'VIEW_VISITS', 'CONVERT_COLD_VISITS', 'VIEW_MAP', 'VIEW_PIPELINE', 'VIEW_METAS',
        'VIEW_LEADS', 'VIEW_META_LEADS', 'VIEW_REACTIVATION',
        'VIEW_COLLECTIONS', 'COMMENT_COLLECTIONS',
        'VIEW_INVENTORY',
        'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS',
        'VIEW_DELIVERY_STATUS',
        'VIEW_KIT_LOANS', 'REQUEST_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'CREATE_SIZE_CHANGES'
    ],
    driver: ['EXECUTE_DELIVERY']
};

export const getDefaultPermissions = (role: string | null | undefined): string[] =>
    DEFAULT_ROLE_PERMISSIONS[normalizeRole(role)] || [];

const unique = (values: string[]): string[] => Array.from(new Set(values));

/**
 * Lee la matriz completa de permisos.
 *
 * Devuelve `null` cuando la consulta falla, para distinguir ese caso de una tabla
 * legítimamente vacía. Esa distinción es la que permite revocar permisos sin
 * renunciar a la tolerancia a fallos de red.
 */
export const fetchRolePermissionRows = async (): Promise<RolePermissionRow[] | null> => {
    try {
        const { data, error } = await supabase.from('role_permissions').select('role, permission');

        if (error) {
            console.error('No se pudo leer role_permissions, se aplicarán los permisos por defecto:', error);
            return null;
        }

        return (data || [])
            .map((row: any) => ({
                role: String(row?.role || '').trim(),
                permission: String(row?.permission || '').trim()
            }))
            .filter((row: RolePermissionRow) => row.role !== '' && row.permission !== '');
    } catch (err) {
        console.error('Error inesperado al leer role_permissions, se aplicarán los permisos por defecto:', err);
        return null;
    }
};

/**
 * Resuelve los permisos efectivos de un rol.
 *
 * @param rows `null` si la consulta falló; arreglo vacío si la tabla no tiene filas.
 */
export const resolveRolePermissions = (
    role: string | null | undefined,
    rows: RolePermissionRow[] | null
): ResolvedRolePermissions => {
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole) return { permissions: [], source: 'defaults' };

    // Consulta fallida o matriz nunca inicializada: se preserva el acceso con la semilla local.
    if (rows === null || rows.length === 0) {
        return { permissions: getDefaultPermissions(normalizedRole), source: 'defaults' };
    }

    const granted = rows
        .filter((row) => normalizeRole(row.role) === normalizedRole)
        .map((row) => row.permission);

    // El rol admin se blinda de forma explícita: perder MANAGE_PERMISSIONS dejaría
    // la matriz inaccesible de forma permanente para toda la organización.
    if (normalizedRole === 'admin') {
        return { permissions: unique([...PERMISSION_KEYS, ...granted]), source: 'database' };
    }

    return { permissions: unique(granted), source: 'database' };
};

/** Construye la matriz rol -> permisos que consume la pantalla de configuración. */
export const buildRolePermissionMatrix = (rows: RolePermissionRow[] | null): Record<string, string[]> => {
    const matrix: Record<string, string[]> = {};
    ASSIGNABLE_ROLES.forEach((role) => {
        matrix[role] = resolveRolePermissions(role, rows).permissions;
    });
    return matrix;
};

/**
 * Lee las excepciones individuales de un usuario.
 *
 * Ante un error devuelve una lista vacía: el usuario conserva los permisos de su rol,
 * que es el mismo criterio que aplica la base de datos cuando no hay excepciones.
 */
export const fetchUserPermissionOverrides = async (userId: string): Promise<UserPermissionOverride[]> => {
    try {
        const { data, error } = await (supabase.from('user_permission_overrides') as any)
            .select('permission, effect')
            .eq('user_id', userId);

        if (error) {
            console.error('No se pudieron leer las excepciones de permisos del usuario:', error);
            return [];
        }

        return (data || [])
            .map((row: any) => ({
                permission: String(row?.permission || '').trim(),
                effect: row?.effect === 'deny' ? 'deny' : 'grant'
            }) as UserPermissionOverride)
            .filter((row: UserPermissionOverride) => row.permission !== '');
    } catch (err) {
        console.error('Error inesperado al leer las excepciones de permisos:', err);
        return [];
    }
};

/**
 * Aplica las excepciones individuales sobre los permisos del rol, con la misma
 * precedencia que public.user_has_permission: el admin conserva todo, luego
 * 'deny' quita y 'grant' agrega.
 */
export const applyPermissionOverrides = (
    role: string | null | undefined,
    rolePermissions: string[],
    overrides: UserPermissionOverride[]
): string[] => {
    if (normalizeRole(role) === 'admin') return rolePermissions;

    const effective = new Set(rolePermissions);
    overrides.forEach((override) => {
        if (override.effect === 'deny') effective.delete(override.permission);
        else effective.add(override.permission);
    });
    return Array.from(effective);
};
