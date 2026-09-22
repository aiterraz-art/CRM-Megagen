/**
 * Fuente única de verdad del modelo RBAC del CRM.
 *
 * Tanto el contexto de usuario como la matriz de configuración consumen este módulo,
 * de modo que el catálogo de permisos, la normalización de roles y los valores por
 * defecto no puedan divergir entre la pantalla que otorga los accesos y la que los aplica.
 */
import { supabase } from '../services/supabase';

export type PermissionDefinition = {
    key: string;
    label: string;
    desc: string;
};

export type RolePermissionRow = {
    role: string;
    permission: string;
};

/** Origen efectivo del conjunto de permisos resuelto, para diagnóstico y trazabilidad. */
export type RolePermissionSource = 'database' | 'defaults';

export type ResolvedRolePermissions = {
    permissions: string[];
    source: RolePermissionSource;
};

export const PERMISSION_CATALOG: PermissionDefinition[] = [
    { key: 'UPLOAD_EXCEL', label: 'Cargar Excel', desc: 'Permite subir archivos de inventario, precios y despacho.' },
    { key: 'MANAGE_INVENTORY', label: 'Gestión Inventario', desc: 'Crear, editar y eliminar productos.' },
    { key: 'MANAGE_PRICING', label: 'Modificar Precios', desc: 'Cambiar precios de venta.' },
    { key: 'VIEW_METAS', label: 'Ver Metas', desc: 'Visualizar indicadores de venta y facturación.' },
    { key: 'MANAGE_METAS', label: 'Configurar Metas', desc: 'Asignar objetivos comerciales a vendedores.' },
    { key: 'MANAGE_DISPATCH', label: 'Gestionar Despacho', desc: 'Crear y asignar rutas de transporte.' },
    { key: 'EXECUTE_DELIVERY', label: 'Realizar Entregas', desc: 'Módulo de repartidor para completar pedidos.' },
    { key: 'MANAGE_USERS', label: 'Gestionar Usuarios', desc: 'Editar roles y estados de perfiles.' },
    { key: 'MANAGE_PERMISSIONS', label: 'Matriz Permisos', desc: 'Configurar los accesos de cada rol.' },
    { key: 'VIEW_ALL_CLIENTS', label: 'Ver Todos Clientes', desc: 'Acceso a la cartera total de clientes (vs solo propios).' },
    { key: 'MANAGE_CLIENTS', label: 'Gestionar Clientes', desc: 'Editar, eliminar y crear fichas de clientes.' },
    { key: 'IMPORT_CLIENTS', label: 'Importar Clientes', desc: 'Subida masiva de clientes vía CSV.' },
    { key: 'VIEW_TEAM_STATS', label: 'Panel Equipo', desc: 'Acceso a estadísticas y supervisión de representantes.' },
    { key: 'VIEW_ALL_TEAM_STATS', label: 'Ver Todo el Equipo', desc: 'Supervisión global (vs solo subordinados directos).' },
    { key: 'VIEW_OPERATIONS', label: 'Ver Operaciones', desc: 'Acceso al centro de operaciones y monitoreo operativo.' },
    { key: 'MANAGE_AUTOMATIONS', label: 'Gestionar Automatizaciones', desc: 'Configurar reglas automáticas del sistema.' },
    { key: 'MANAGE_SLA', label: 'Gestionar SLA', desc: 'Administrar compromisos y tiempos de servicio.' },
    { key: 'MANAGE_APPROVALS', label: 'Gestionar Aprobaciones', desc: 'Resolver solicitudes de autorización y descuentos.' },
    { key: 'MANAGE_POSTSALE', label: 'Gestionar Postventa', desc: 'Administrar flujos y seguimiento de postventa.' },
    { key: 'MANAGE_COLLECTIONS', label: 'Gestionar Cobranzas', desc: 'Subir y administrar información de cobranzas.' },
    { key: 'VIEW_TEAM_CALENDARS', label: 'Calendarios del Equipo', desc: 'Permite ver Google Calendar de otros vendedores compartidos por Workspace.' },
    { key: 'VIEW_PROCUREMENT', label: 'Ver Compras', desc: 'Acceso al módulo de solicitudes de productos e importaciones en tránsito.' },
    { key: 'REQUEST_PRODUCTS', label: 'Solicitar Productos', desc: 'Permite crear solicitudes de compra o reposición.' },
    { key: 'MANAGE_PROCUREMENT', label: 'Gestionar Compras', desc: 'Permite administrar solicitudes, importaciones y vínculos con embarques.' },
    { key: 'VIEW_PURCHASE_ORDERS', label: 'Ver Órdenes de Compra', desc: 'Acceso al módulo logístico de órdenes de compra y proveedores.' },
    { key: 'MANAGE_PURCHASE_ORDERS', label: 'Gestionar Órdenes de Compra', desc: 'Permite crear, enviar, reenviar y cancelar órdenes de compra.' },
    { key: 'VIEW_SUPPLIER_PAYABLES', label: 'Ver Cuentas por Pagar', desc: 'Acceso al módulo de deudas pendientes con proveedores.' },
    { key: 'MANAGE_SUPPLIER_PAYABLES', label: 'Gestionar Cuentas por Pagar', desc: 'Permite registrar, editar y cerrar deudas con proveedores.' },
    { key: 'VIEW_KIT_LOANS', label: 'Ver Kits', desc: 'Acceso al módulo de préstamo y seguimiento de kits clínicos.' },
    { key: 'REQUEST_KIT_LOANS', label: 'Solicitar Kits', desc: 'Permite crear solicitudes de préstamo de kits para clientes.' },
    { key: 'MANAGE_KIT_LOANS', label: 'Gestionar Kits', desc: 'Permite registrar kits, despachar préstamos y cerrar devoluciones.' },
    { key: 'VIEW_SIZE_CHANGES', label: 'Ver Cambios de Medida', desc: 'Acceso al módulo comercial de solicitudes de cambio de medida.' },
    { key: 'CREATE_SIZE_CHANGES', label: 'Crear Cambios de Medida', desc: 'Permite crear solicitudes de cambio para clientes.' },
    { key: 'MANAGE_SIZE_CHANGES', label: 'Gestionar Cambios de Medida', desc: 'Permite enviar, cerrar y cancelar cambios de medida.' }
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

const CHIEF_PERMISSIONS = ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'IMPORT_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_OPERATIONS', 'MANAGE_SLA', 'MANAGE_APPROVALS', 'VIEW_TEAM_CALENDARS', 'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'MANAGE_PROCUREMENT', 'VIEW_KIT_LOANS', 'REQUEST_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'CREATE_SIZE_CHANGES', 'MANAGE_SIZE_CHANGES', 'VIEW_SUPPLIER_PAYABLES', 'MANAGE_SUPPLIER_PAYABLES'];

/**
 * Semilla de permisos por rol. Solo se aplica cuando la base de datos no puede
 * consultarse o cuando la tabla nunca fue inicializada; nunca se fusiona con una
 * configuración existente, porque eso impediría revocar accesos.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: PERMISSION_KEYS,
    jefe: CHIEF_PERMISSIONS,
    bodega: ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'MANAGE_PROCUREMENT', 'VIEW_PURCHASE_ORDERS', 'MANAGE_PURCHASE_ORDERS'],
    facturador: ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_OPERATIONS', 'MANAGE_COLLECTIONS', 'VIEW_KIT_LOANS', 'MANAGE_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'MANAGE_SIZE_CHANGES', 'VIEW_PURCHASE_ORDERS', 'MANAGE_PURCHASE_ORDERS'],
    tesorero: ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'VIEW_OPERATIONS', 'MANAGE_COLLECTIONS', 'VIEW_KIT_LOANS', 'MANAGE_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'MANAGE_SIZE_CHANGES'],
    seller: ['VIEW_METAS', 'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'VIEW_KIT_LOANS', 'REQUEST_KIT_LOANS', 'VIEW_SIZE_CHANGES', 'CREATE_SIZE_CHANGES'],
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
