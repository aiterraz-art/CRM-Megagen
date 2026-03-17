import React, { useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { LayoutDashboard, Map as MapIcon, Calendar, Users, Package, LogOut, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Truck, Menu, X, Stethoscope, ClipboardList, ActivitySquare, CircleDollarSign, Target, MessageSquare, Trophy, Megaphone } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import GlobalVisitTimer from './GlobalVisitTimer';
import ApprovalRealtimeNotifier from './ApprovalRealtimeNotifier';
import PushSubscriptionManager from './PushSubscriptionManager';

interface LayoutProps {
    children?: React.ReactNode;
    title?: string;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const { profile, isSupervisor, effectiveRole, realRole, simulatedRole, setSimulatedRole } = useUser();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const menuItems = [
        { icon: <LayoutDashboard size={20} />, label: 'Dashboard', path: '/' },
    ];

    if (effectiveRole !== 'facturador') {
        menuItems.push({ icon: <Stethoscope size={20} />, label: 'Visita en Frío', path: '/cold-visit' });
        menuItems.push({ icon: <MapIcon size={20} />, label: 'Mapa', path: '/map' });
    }

    menuItems.push({ icon: <Users size={20} />, label: 'Clientes', path: '/clients' });
    menuItems.push({ icon: <ShoppingBag size={20} />, label: 'Cotizaciones', path: '/quotations' });
    menuItems.push({ icon: <ShoppingCart size={20} />, label: 'Pedidos', path: '/orders' });
    menuItems.push({ icon: <Trophy size={20} />, label: 'Conversiones', path: '/conversions' });

    if (effectiveRole !== 'facturador') {
        menuItems.push({ icon: <CircleDollarSign size={20} />, label: 'Cobranzas', path: '/collections' });
        menuItems.push({ icon: <LayoutDashboard size={20} className="rotate-90" />, label: 'Embudo', path: '/pipeline' });
        menuItems.push({ icon: <Target size={20} />, label: 'Leads', path: '/lead-pipeline' });
        if (effectiveRole === 'admin' || effectiveRole === 'seller') {
            menuItems.push({ icon: <Megaphone size={20} />, label: 'Meta Leads', path: '/meta-leads' });
        }
        menuItems.push({ icon: <MessageSquare size={20} />, label: 'Mensajes', path: '/lead-messages' });
    }

    menuItems.push({ icon: <Package size={20} />, label: 'Inventario', path: '/inventory' });
    menuItems.push({ icon: <Calendar size={20} />, label: 'Agenda', path: '/schedule' });

    if (effectiveRole !== 'seller' && effectiveRole !== 'facturador') {
        menuItems.push({ icon: <ClipboardList size={20} />, label: 'Historial', path: '/visits' });
    }

    if (effectiveRole === 'driver') {
        menuItems.length = 0;
        menuItems.push({ icon: <LayoutDashboard size={20} />, label: 'Mi Panel', path: '/' });
        menuItems.push({ icon: <ShoppingCart size={20} />, label: 'Pedidos', path: '/orders' });
        menuItems.push({ icon: <Truck size={20} />, label: 'Ruta', path: '/delivery' });
        menuItems.push({ icon: <Trophy size={20} />, label: 'Conversiones', path: '/conversions' });
    } else if (isSupervisor && effectiveRole !== 'seller' && effectiveRole !== 'facturador') {
        menuItems.push({ icon: <ShieldCheck size={20} />, label: 'Mi Equipo', path: '/team' });
        menuItems.push({ icon: <React.Fragment><MapIcon size={20} className="text-indigo-400" /></React.Fragment>, label: 'Rutas', path: '/routes' });
    }

    if (effectiveRole === 'seller') {
        menuItems.push({ icon: <Truck size={20} />, label: 'Estado Entregas', path: '/my-deliveries' });
    }

    if (effectiveRole === 'admin' || effectiveRole === 'facturador') {
        menuItems.push({ icon: <Truck size={20} />, label: 'Despacho', path: '/dispatch' });
    }

    if (effectiveRole === 'admin') {
        menuItems.push({ icon: <Settings size={20} />, label: 'Configuración', path: '/settings' });
    }
    if (effectiveRole === 'admin' || effectiveRole === 'jefe') {
        menuItems.push({ icon: <ActivitySquare size={20} />, label: 'Operaciones', path: '/operations' });
    }

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    const closeMenu = () => setIsMobileMenuOpen(false);

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

                    <nav className="space-y-2">
                        {menuItems.map((item) => (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={closeMenu}
                                className={`premium-sidebar-item ${location.pathname === item.path ? 'active' : ''}`}
                            >
                                <span className="relative z-10">{item.icon}</span>
                                <span className="font-bold relative z-10">{item.label}</span>
                                {location.pathname === item.path && (
                                    <div className="ml-auto w-1.5 h-6 bg-white rounded-full"></div>
                                )}
                            </Link>
                        ))}
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
