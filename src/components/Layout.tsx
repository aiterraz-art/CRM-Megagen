import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, Map as MapIcon, Calendar, Users, Package, LogOut, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Truck, Menu, X, Stethoscope, ClipboardList, ActivitySquare, CircleDollarSign, Target, MessageSquare, Trophy, Megaphone, ShipWheel, ChevronDown, RefreshCw } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import GlobalVisitTimer from './GlobalVisitTimer';
import ApprovalRealtimeNotifier from './ApprovalRealtimeNotifier';
import PushSubscriptionManager from './PushSubscriptionManager';

interface LayoutProps {
    children?: React.ReactNode;
    title?: string;
}

type MenuGroupId = 'comercial' | 'prospection' | 'procurement' | 'logistics' | 'management';

type MenuContext = {
    effectiveRole: string | null | undefined;
    isSupervisor: boolean;
    canViewProcurement: boolean;
    canViewKitLoans: boolean;
    canViewSizeChanges: boolean;
};

type MenuEntry = {
    id: string;
    label: string;
    path: string;
    icon: React.ReactNode;
    group: MenuGroupId | null;
    isPinned?: boolean;
    visibleWhen: (context: MenuContext) => boolean;
};

type MenuGroup = {
    id: MenuGroupId;
    label: string;
};

const isBillingBackofficeRole = (role: string | null | undefined) =>
    role === 'facturador' || role === 'tesorero';

const menuGroups: MenuGroup[] = [
    { id: 'comercial', label: 'Comercial' },
    { id: 'prospection', label: 'Prospección' },
    { id: 'procurement', label: 'Abastecimiento' },
    { id: 'logistics', label: 'Logística' },
    { id: 'management', label: 'Gestión' },
];

const allMenuEntries: MenuEntry[] = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        path: '/',
        icon: <LayoutDashboard size={20} />,
        group: null,
        isPinned: true,
        visibleWhen: () => true,
    },
    {
        id: 'schedule',
        label: 'Agenda',
        path: '/schedule',
        icon: <Calendar size={20} />,
        group: null,
        isPinned: true,
        visibleWhen: ({ effectiveRole }) => effectiveRole !== 'driver',
    },
    {
        id: 'clients',
        label: 'Clientes',
        path: '/clients',
        icon: <Users size={20} />,
        group: 'comercial',
        visibleWhen: ({ effectiveRole }) => effectiveRole !== 'driver',
    },
    {
        id: 'quotations',
        label: 'Cotizaciones',
        path: '/quotations',
        icon: <ShoppingBag size={20} />,
        group: 'comercial',
        visibleWhen: ({ effectiveRole }) => effectiveRole !== 'driver',
    },
    {
        id: 'size-changes',
        label: 'Cambios de Medida',
        path: '/size-changes',
        icon: <RefreshCw size={20} />,
        group: 'comercial',
        visibleWhen: ({ effectiveRole, canViewSizeChanges }) => effectiveRole !== 'driver' && canViewSizeChanges,
    },
    {
        id: 'orders',
        label: 'Pedidos',
        path: '/orders',
        icon: <ShoppingCart size={20} />,
        group: 'comercial',
        visibleWhen: () => true,
    },
    {
        id: 'conversions',
        label: 'Conversiones',
        path: '/conversions',
        icon: <Trophy size={20} />,
        group: 'comercial',
        visibleWhen: () => true,
    },
    {
        id: 'collections',
        label: 'Cobranzas',
        path: '/collections',
        icon: <CircleDollarSign size={20} />,
        group: 'comercial',
        visibleWhen: ({ effectiveRole }) => effectiveRole !== 'driver',
    },
    {
        id: 'cold-visit',
        label: 'Visita en Frío',
        path: '/cold-visit',
        icon: <Stethoscope size={20} />,
        group: 'prospection',
        visibleWhen: ({ effectiveRole }) => !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'map',
        label: 'Mapa',
        path: '/map',
        icon: <MapIcon size={20} />,
        group: 'prospection',
        visibleWhen: ({ effectiveRole }) => !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'visits',
        label: 'Historial',
        path: '/visits',
        icon: <ClipboardList size={20} />,
        group: 'prospection',
        visibleWhen: ({ effectiveRole }) => effectiveRole !== 'seller' && !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'pipeline',
        label: 'Embudo',
        path: '/pipeline',
        icon: <LayoutDashboard size={20} className="rotate-90" />,
        group: 'prospection',
        visibleWhen: ({ effectiveRole }) => !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'lead-pipeline',
        label: 'Leads',
        path: '/lead-pipeline',
        icon: <Target size={20} />,
        group: 'prospection',
        visibleWhen: ({ effectiveRole }) => !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'meta-leads',
        label: 'Meta Leads',
        path: '/meta-leads',
        icon: <Megaphone size={20} />,
        group: 'prospection',
        visibleWhen: ({ effectiveRole }) => effectiveRole === 'admin' || effectiveRole === 'seller',
    },
    {
        id: 'lead-messages',
        label: 'Mensajes',
        path: '/lead-messages',
        icon: <MessageSquare size={20} />,
        group: 'prospection',
        visibleWhen: ({ effectiveRole }) => !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'inventory',
        label: 'Inventario',
        path: '/inventory',
        icon: <Package size={20} />,
        group: 'procurement',
        visibleWhen: ({ effectiveRole }) => effectiveRole !== 'driver',
    },
    {
        id: 'procurement',
        label: 'Compras',
        path: '/procurement',
        icon: <ShipWheel size={20} />,
        group: 'procurement',
        visibleWhen: ({ effectiveRole, canViewProcurement }) => effectiveRole !== 'driver' && canViewProcurement,
    },
    {
        id: 'dispatch',
        label: 'Despacho',
        path: '/dispatch',
        icon: <Truck size={20} />,
        group: 'logistics',
        visibleWhen: ({ effectiveRole }) => effectiveRole === 'admin' || isBillingBackofficeRole(effectiveRole),
    },
    {
        id: 'kit-loans',
        label: 'Kits',
        path: '/kit-loans',
        icon: <Package size={20} />,
        group: 'logistics',
        visibleWhen: ({ effectiveRole, canViewKitLoans }) => effectiveRole !== 'driver' && canViewKitLoans,
    },
    {
        id: 'delivery',
        label: 'Ruta',
        path: '/delivery',
        icon: <Truck size={20} />,
        group: 'logistics',
        visibleWhen: ({ effectiveRole }) => effectiveRole === 'driver',
    },
    {
        id: 'routes',
        label: 'Rutas',
        path: '/routes',
        icon: <MapIcon size={20} className="text-indigo-400" />,
        group: 'logistics',
        visibleWhen: ({ effectiveRole, isSupervisor }) => isSupervisor && effectiveRole !== 'seller' && !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'my-deliveries',
        label: 'Estado Entregas',
        path: '/my-deliveries',
        icon: <Truck size={20} />,
        group: 'logistics',
        visibleWhen: ({ effectiveRole }) => effectiveRole === 'seller',
    },
    {
        id: 'operations',
        label: 'Operaciones',
        path: '/operations',
        icon: <ActivitySquare size={20} />,
        group: 'management',
        visibleWhen: ({ effectiveRole }) => effectiveRole === 'admin' || effectiveRole === 'jefe',
    },
    {
        id: 'team',
        label: 'Mi Equipo',
        path: '/team',
        icon: <ShieldCheck size={20} />,
        group: 'management',
        visibleWhen: ({ effectiveRole, isSupervisor }) => isSupervisor && effectiveRole !== 'seller' && !isBillingBackofficeRole(effectiveRole) && effectiveRole !== 'driver',
    },
    {
        id: 'settings',
        label: 'Configuración',
        path: '/settings',
        icon: <Settings size={20} />,
        group: 'management',
        visibleWhen: ({ effectiveRole }) => effectiveRole === 'admin',
    },
];

export const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { profile, isSupervisor, effectiveRole, realRole, simulatedRole, setSimulatedRole, hasPermission } = useUser();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [openGroupId, setOpenGroupId] = useState<MenuGroupId | null>(null);
    const canViewProcurement = hasPermission('VIEW_PROCUREMENT');
    const canViewKitLoans = hasPermission('VIEW_KIT_LOANS');
    const canViewSizeChanges = hasPermission('VIEW_SIZE_CHANGES');

    const menuContext = useMemo(
        () => ({
            effectiveRole,
            isSupervisor,
            canViewProcurement,
            canViewKitLoans,
            canViewSizeChanges,
        }),
        [effectiveRole, isSupervisor, canViewProcurement, canViewKitLoans, canViewSizeChanges]
    );

    const visibleMenuEntries = useMemo(
        () => allMenuEntries.filter((entry) => entry.visibleWhen(menuContext)),
        [menuContext]
    );

    const pinnedItems = useMemo(
        () => visibleMenuEntries.filter((entry) => entry.isPinned),
        [visibleMenuEntries]
    );

    const groupedItems = useMemo(
        () => visibleMenuEntries.filter((entry) => !entry.isPinned && entry.group),
        [visibleMenuEntries]
    );

    const visibleGroups = useMemo(
        () =>
            menuGroups
                .map((group) => ({
                    ...group,
                    items: groupedItems.filter((entry) => entry.group === group.id),
                }))
                .filter((group) => group.items.length > 0),
        [groupedItems]
    );

    const activeMenuEntry = useMemo(
        () => visibleMenuEntries.find((entry) => entry.path === location.pathname) || null,
        [visibleMenuEntries, location.pathname]
    );

    const defaultOpenGroupId = activeMenuEntry?.group ?? visibleGroups[0]?.id ?? null;

    useEffect(() => {
        setOpenGroupId(defaultOpenGroupId);
    }, [defaultOpenGroupId]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    const closeMenu = () => setIsMobileMenuOpen(false);

    const toggleGroup = (groupId: MenuGroupId) => {
        setOpenGroupId((current) => (current === groupId ? null : groupId));
    };

    const renderMenuItem = (item: MenuEntry, nested = false) => {
        const isActive = location.pathname === item.path;

        return (
            <Link
                key={item.path}
                to={item.path}
                onClick={closeMenu}
                className={`premium-sidebar-item ${isActive ? 'active' : ''} ${nested ? 'ml-4 py-2.5 pr-3 pl-4 text-sm rounded-xl' : ''}`}
            >
                <span className="relative z-10 shrink-0">{item.icon}</span>
                <span className="font-bold relative z-10 truncate">{item.label}</span>
                {isActive && (
                    <div className="ml-auto w-1.5 h-6 bg-white rounded-full shrink-0"></div>
                )}
            </Link>
        );
    };

    return (
        <div className="flex h-full max-w-full bg-premium-bg overflow-hidden font-outfit">
            {/* Backdrop for mobile */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-all"
                    onClick={closeMenu}
                />
            )}

            {/* Sidebar */}
            <aside className={`
                fixed inset-y-0 left-0 z-50 w-80 bg-side-gradient flex flex-col transition-transform duration-300 transform
                lg:translate-x-0 lg:static lg:flex
                ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <div className="p-8 flex-1 overflow-y-auto">
                    <div className="flex items-center justify-between mb-12">
                        <div className="flex items-center space-x-4">
                            <div className="w-10 h-10 bg-white rounded-2xl p-2 flex items-center justify-center border border-white/30 shadow-2xl">
                                <img src={import.meta.env.VITE_COMPANY_LOGO || "/logo_megagen.png"} alt={import.meta.env.VITE_COMPANY_NAME || "Megagen"} className="w-full h-auto object-contain" />
                            </div>
                            <h1 className="text-white text-xl font-black tracking-tight">{import.meta.env.VITE_APP_TITLE || "Megagen CRM"}</h1>
                        </div>
                        <button onClick={closeMenu} className="lg:hidden p-2 text-white/60 hover:text-white">
                            <X size={24} />
                        </button>
                    </div>

                    <nav className="space-y-3">
                        <div className="space-y-2">
                            {pinnedItems.map((item) => renderMenuItem(item))}
                        </div>

                        {visibleGroups.length > 0 && (
                            <div className="pt-4 border-t border-white/10 space-y-2">
                                {visibleGroups.map((group) => {
                                    const isOpen = openGroupId === group.id;
                                    const isGroupActive = group.items.some((item) => item.path === location.pathname);

                                    return (
                                        <div key={group.id} className="rounded-[1.4rem] bg-white/5 border border-white/10 overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => toggleGroup(group.id)}
                                                className={`w-full flex items-center justify-between px-4 py-3 text-left transition-all ${isGroupActive ? 'text-white bg-white/10' : 'text-white/80 hover:text-white hover:bg-white/5'}`}
                                            >
                                                <span className="font-black uppercase tracking-[0.18em] text-[11px]">{group.label}</span>
                                                <ChevronDown
                                                    size={16}
                                                    className={`transition-transform ${isOpen ? 'rotate-180 text-white' : 'text-white/60'}`}
                                                />
                                            </button>
                                            {isOpen && (
                                                <div className="px-2 pb-2 space-y-1">
                                                    {group.items.map((item) => renderMenuItem(item, true))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </nav>


                </div>

                <div className="p-6 shrink-0">
                    <div className="bg-white/10 backdrop-blur-lg rounded-[2rem] p-5 border border-white/20">
                        <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-premium-accent rounded-full border border-white/50 overflow-hidden">
                                <img src={`https://ui-avatars.com/api/?name=${profile?.email || 'User'}&background=0D8ABC&color=fff`} alt="Avatar" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-white font-bold truncate text-xs">{profile?.email?.split('@')[0] || 'Ventas'}</p>
                                <p className="text-white/60 text-[8px] font-black uppercase tracking-widest">{effectiveRole || profile?.role || 'Vendedor'}</p>
                            </div>
                        </div>
                        {realRole === 'admin' && (
                            <div className="mt-4 space-y-2">
                                <p className="text-[9px] text-white/70 font-black uppercase tracking-wider">Modo Prueba</p>
                                <select
                                    value={simulatedRole || ''}
                                    onChange={(e) => setSimulatedRole(e.target.value || null)}
                                    className="w-full py-2 px-3 rounded-xl bg-white/15 border border-white/20 text-white text-[11px] font-bold"
                                >
                                    <option value="" className="text-gray-800">Ver como Admin</option>
                                    <option value="seller" className="text-gray-800">Ver como Vendedor</option>
                                    <option value="jefe" className="text-gray-800">Ver como Jefe</option>
                                    <option value="facturador" className="text-gray-800">Ver como Facturador</option>
                                    <option value="tesorero" className="text-gray-800">Ver como Tesorero</option>
                                    <option value="driver" className="text-gray-800">Ver como Repartidor</option>
                                </select>
                                {simulatedRole && (
                                    <button
                                        onClick={() => setSimulatedRole(null)}
                                        className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-wider"
                                    >
                                        Salir de Modo Prueba
                                    </button>
                                )}
                            </div>
                        )}
                        <button
                            onClick={handleLogout}
                            className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center justify-center space-x-2 transition-all border border-white/10 group text-[10px] font-bold uppercase tracking-widest"
                        >
                            <LogOut size={14} className="group-hover:translate-x-1 transition-transform" />
                            <span>Cerrar Sesión</span>
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col h-full max-w-full overflow-hidden relative">
                {realRole === 'admin' && simulatedRole && (
                    <div className="h-12 bg-amber-500 text-white flex items-center justify-center gap-3 px-4 shrink-0 border-b border-amber-400">
                        <span className="text-[11px] font-black uppercase tracking-wider">
                            Modo Prueba Activo: {simulatedRole.toUpperCase()}
                        </span>
                        <button
                            onClick={() => setSimulatedRole(null)}
                            className="text-[10px] font-black uppercase tracking-wider bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg transition-all"
                        >
                            Salir
                        </button>
                    </div>
                )}
                {/* Mobile Header */}
                <header className="lg:hidden h-20 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0 relative z-30">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-side-gradient rounded-xl flex items-center justify-center shadow-lg">
                            <img src={import.meta.env.VITE_COMPANY_LOGO || "/logo_megagen.png"} alt={import.meta.env.VITE_COMPANY_NAME || "Megagen"} className="w-6 h-6 object-contain brightness-0 invert" />
                        </div>
                        <h1 className="text-gray-900 text-lg font-black tracking-tighter">{import.meta.env.VITE_APP_TITLE || "Megagen CRM"}</h1>
                    </div>
                    <button
                        onClick={() => setIsMobileMenuOpen(true)}
                        className="p-3 bg-gray-50 text-gray-900 rounded-xl hover:bg-gray-100 transition-colors"
                    >
                        <Menu size={24} />
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 lg:p-12">
                    {children || <Outlet />}

                    <div className="mt-12 py-6 border-t border-gray-100/50 text-center">
                        <p className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">
                            © {new Date().getFullYear()} {import.meta.env.VITE_COMPANY_NAME || "Megagen"} - Gestión Profesional
                        </p>
                    </div>
                </div>
            </main>
            <ApprovalRealtimeNotifier />
            <PushSubscriptionManager />
            <GlobalVisitTimer />
        </div>
    );
};
