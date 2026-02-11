import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Truck, Package, Clock, MapPin, CheckCircle2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

const DriverDashboard: React.FC = () => {
    const { profile } = useUser();
    const [stats, setStats] = useState({
        pending: 0,
        delivered: 0,
        total: 0
    });

    useEffect(() => {
        const fetchStats = async () => {
            if (!profile?.id) return;

            // 1. Get active routes for this driver (Use profile.id for impersonation)
            const { data: routes } = await supabase
                .from('delivery_routes')
                .select('id')
                .eq('driver_id', profile.id)
                .eq('status', 'in_progress');

            const routeIds = routes?.map(r => r.id) || [];

            if (routeIds.length === 0) {
                setStats({ pending: 0, delivered: 0, total: 0 });
                return;
            }

            // 2. Count items in those routes
            const { data: items } = await supabase
                .from('route_items')
                .select('status')
                .in('route_id', routeIds);

            if (items) {
                const pending = items.filter(i => i.status === 'pending').length;
                const delivered = items.filter(i => i.status === 'delivered').length;
                setStats({
                    pending,
                    delivered,
                    total: pending + delivered
                });
            }
        };

        fetchStats();
    }, [profile?.id]);

    return (
        <div className="space-y-8 max-w-lg mx-auto pb-20">
            <header className="flex items-center space-x-4 mb-8">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl flex items-center justify-center shadow-2xl text-white">
                    <Truck size={32} />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-gray-900 leading-tight">Hola, {profile?.email?.split('@')[0] || 'Conductor'}</h1>
                    <p className="text-gray-400 font-medium">Panel de Reparto</p>
                </div>
            </header>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 flex flex-col items-center justify-center text-center">
                    <Package size={24} className="text-amber-500 mb-2" />
                    <span className="text-3xl font-black text-amber-600">{stats.pending}</span>
                    <span className="text-[10px] font-bold uppercase text-amber-400 tracking-wider">Pendientes</span>
                </div>
                <div className="bg-green-50 p-6 rounded-3xl border border-green-100 flex flex-col items-center justify-center text-center">
                    <CheckCircle2 size={24} className="text-green-500 mb-2" />
                    <span className="text-3xl font-black text-green-600">{stats.delivered}</span>
                    <span className="text-[10px] font-bold uppercase text-green-400 tracking-wider">Entregadas</span>
                </div>
            </div>

            {/* Main Action */}
            <Link to="/delivery" className="block w-full">
                <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl hover:bg-slate-800 transition-all active:scale-95 border border-slate-700 relative overflow-hidden group">
                    <div className="absolute right-0 top-0 opacity-10 transform translate-x-10 -translate-y-10">
                        <MapPin size={150} />
                    </div>
                    <div className="relative z-10 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold mb-1">Ruta Actual</h2>
                            <p className="text-slate-400 text-sm">Ver mapa y entregas</p>
                        </div>
                        <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center group-hover:bg-white/20 transition-colors">
                            <Clock size={24} />
                        </div>
                    </div>
                </div>
            </Link>

            {/* Map Preview (Static Image Placeholder or Mini Map) */}
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 opacity-50 grayscale hover:grayscale-0 transition-all">
                <div className="aspect-video bg-gray-100 rounded-2xl flex items-center justify-center border border-gray-200">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <MapPin size={14} />
                        Vista Previa Mapa
                    </span>
                </div>
            </div>
        </div>
    );
};

export default DriverDashboard;
