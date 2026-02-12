import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import {
    Clock,
    MapPin,
    Calendar as CalendarIcon,
    User,
    Search,
    Filter,
    ChevronRight,
    ExternalLink,
    Timer,
    ClipboardList,
    Download
} from 'lucide-react';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

interface VisitHistoryItem {
    id: string;
    check_in_time: string;
    check_out_time: string | null;
    notes: string | null;
    status: string;
    lat: number | null;
    lng: number | null;
    check_out_lat: number | null;
    check_out_lng: number | null;
    client_name: string;
    client_status: string;
    sales_rep_name: string;
}

const VisitHistory = () => {
    const { profile, isSupervisor } = useUser();
    const [visits, setVisits] = useState<VisitHistoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFilter, setDateFilter] = useState(format(new Date(), 'yyyy-MM-dd'));

    useEffect(() => {
        fetchVisits();
    }, [dateFilter, profile]);

    const fetchVisits = async () => {
        if (!profile?.id) return;
        setLoading(true);

        try {
            let query = supabase
                .from('visits')
                .select(`
                    *,
                    clients (name, status),
                    profiles:sales_rep_id (email)
                `)
                .order('check_in_time', { ascending: false });

            // If not supervisor, only show own visits
            if (!isSupervisor) {
                query = query.eq('sales_rep_id', profile.id);
            }

            // Date filter (simple for now)
            if (dateFilter) {
                const startOfDay = `${dateFilter}T00:00:00Z`;
                const endOfDay = `${dateFilter}T23:59:59Z`;
                query = query.gte('check_in_time', startOfDay).lte('check_in_time', endOfDay);
            }

            const { data, error } = await query;

            if (error) throw error;

            const transformedData: VisitHistoryItem[] = (data || []).map((v: any) => ({
                id: v.id,
                check_in_time: v.check_in_time,
                check_out_time: v.check_out_time,
                notes: v.notes,
                status: v.status,
                lat: v.lat,
                lng: v.lng,
                check_out_lat: v.check_out_lat,
                check_out_lng: v.check_out_lng,
                client_name: v.clients?.name || 'Cliente Desconocido',
                client_status: v.clients?.status || 'active',
                sales_rep_name: v.profiles?.email?.split('@')[0] || 'Vendedor'
            }));

            setVisits(transformedData);
        } catch (err) {
            console.error("Error fetching visit history:", err);
        } finally {
            setLoading(false);
        }
    };

    const calculateDuration = (start: string, end: string | null) => {
        if (!end) return 'En curso...';
        const minutes = differenceInMinutes(parseISO(end), parseISO(start));
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    };

    const filteredVisits = visits.filter(v =>
        v.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.sales_rep_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.notes && v.notes.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">Historial de Visitas</h1>
                    <p className="text-gray-500 font-medium">Resumen de gestiones y auditoría de campo</p>
                </div>
                <div className="flex items-center space-x-3">
                    <button
                        onClick={() => {/* Export logic if needed */ }}
                        className="p-4 bg-white border border-gray-100 rounded-2xl text-gray-600 hover:bg-gray-50 transition-all shadow-sm"
                    >
                        <Download size={20} />
                    </button>
                    <div className="relative">
                        <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                            type="date"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="pl-12 pr-6 py-4 bg-white border border-gray-100 rounded-2xl text-gray-900 font-bold focus:ring-2 focus:ring-dental-500/20 outline-none shadow-sm transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="bg-white rounded-[2.5rem] p-6 shadow-xl shadow-gray-200/50 border border-gray-50">
                <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por cliente, vendedor o gestión..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-6 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 placeholder:text-gray-400 focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                        />
                    </div>
                    <button className="px-6 py-4 bg-gray-50 text-gray-600 rounded-2xl font-bold flex items-center space-x-2 hover:bg-gray-100 transition-all">
                        <Filter size={18} />
                        <span>Filtros Avanzados</span>
                    </button>
                </div>
            </div>

            {/* Main Content: Table */}
            <div className="bg-white rounded-[2.5rem] shadow-xl shadow-gray-200/50 border border-gray-50 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-gray-50/50 border-b border-gray-100">
                                <th className="px-8 py-6 text-xs font-black text-gray-400 uppercase tracking-widest">Cliente / Vendedor</th>
                                <th className="px-8 py-6 text-xs font-black text-gray-400 uppercase tracking-widest">Horario y Duración</th>
                                <th className="px-8 py-6 text-xs font-black text-gray-400 uppercase tracking-widest">Gestión Realizada</th>
                                <th className="px-8 py-6 text-xs font-black text-gray-400 uppercase tracking-widest">Ubicación GPS</th>
                                <th className="px-8 py-6 text-xs font-black text-gray-400 uppercase tracking-widest">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="px-8 py-8"><div className="h-8 bg-gray-100 rounded-xl w-full"></div></td>
                                    </tr>
                                ))
                            ) : filteredVisits.length > 0 ? (
                                filteredVisits.map((visit) => (
                                    <tr key={visit.id} className="hover:bg-gray-50/80 transition-colors group">
                                        <td className="px-8 py-8">
                                            <div className="flex items-center space-x-4">
                                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${visit.client_status === 'prospect' ? 'bg-amber-100 text-amber-600' : 'bg-dental-100 text-dental-600'}`}>
                                                    <User size={20} />
                                                </div>
                                                <div>
                                                    <p className="font-black text-gray-900 leading-tight">{visit.client_name}</p>
                                                    <p className="text-xs font-bold text-gray-400 mt-0.5 flex items-center">
                                                        <span className="uppercase tracking-tighter mr-2">{visit.sales_rep_name}</span>
                                                        {visit.client_status === 'prospect' && (
                                                            <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest">Visita en Frío</span>
                                                        )}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-8">
                                            <div className="flex flex-col space-y-1">
                                                <div className="flex items-center text-sm font-bold text-gray-700">
                                                    <Clock size={14} className="mr-2 text-gray-400" />
                                                    <span>{format(parseISO(visit.check_in_time), 'HH:mm')} - {visit.check_out_time ? format(parseISO(visit.check_out_time), 'HH:mm') : '??'}</span>
                                                </div>
                                                <div className="flex items-center text-xs font-black text-dental-600 bg-dental-50 w-fit px-2 py-1 rounded-lg uppercase tracking-widest">
                                                    <Timer size={12} className="mr-1.5" />
                                                    <span>{calculateDuration(visit.check_in_time, visit.check_out_time)}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-8 max-w-xs">
                                            <div className="flex items-start space-x-2">
                                                <ClipboardList size={16} className="text-gray-300 mt-1 shrink-0" />
                                                <p className="text-sm font-medium text-gray-600 line-clamp-3 leading-relaxed">
                                                    {visit.notes || <span className="italic text-gray-400">Sin notas registradas</span>}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-8 py-8">
                                            <div className="flex items-center space-x-2">
                                                <a
                                                    href={`https://www.google.com/maps?q=${visit.lat},${visit.lng}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-3 bg-gray-50 text-gray-400 rounded-xl hover:bg-dental-50 hover:text-dental-600 transition-all border border-transparent hover:border-dental-100 group/link"
                                                    title="Ver Ubicación Check-in"
                                                >
                                                    <MapPin size={18} />
                                                </a>
                                                {visit.check_out_lat && (
                                                    <a
                                                        href={`https://www.google.com/maps?q=${visit.check_out_lat},${visit.check_out_lng}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-3 bg-gray-50 text-gray-400 rounded-xl hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-transparent hover:border-indigo-100 group/link"
                                                        title="Ver Ubicación Check-out"
                                                    >
                                                        <ExternalLink size={18} />
                                                    </a>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-8 py-8 text-right">
                                            <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${visit.status === 'completed'
                                                    ? 'bg-green-100 text-green-700'
                                                    : visit.status === 'in_progress'
                                                        ? 'bg-blue-100 text-blue-700 animate-pulse'
                                                        : 'bg-gray-100 text-gray-500'
                                                }`}>
                                                {visit.status === 'completed' ? 'Finalizada' : visit.status === 'in_progress' ? 'En Curso' : visit.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className="px-8 py-20 text-center">
                                        <div className="max-w-xs mx-auto space-y-4">
                                            <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto text-gray-200">
                                                <Search size={32} />
                                            </div>
                                            <p className="text-gray-400 font-bold">No se encontraron visitas para este día.</p>
                                            <button
                                                onClick={() => setDateFilter('')}
                                                className="text-dental-600 text-sm font-black uppercase tracking-widest border-b-2 border-dental-600/20 hover:border-dental-600 transition-all"
                                            >
                                                Ver Todo el Historial
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default VisitHistory;
