import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import {
    Calendar as CalendarIcon,
    ClipboardList,
    ExternalLink,
    Filter,
    MapPin,
    RotateCcw,
    Search,
    Timer,
    User,
    Users
} from 'lucide-react';
import { differenceInMinutes, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Navigate, useSearchParams } from 'react-router-dom';
import { isProspectStatus } from '../utils/prospect';

type VisitStatusFilter = 'all' | 'in_progress' | 'completed' | 'cancelled';
type VisitTypeFilter = 'all' | 'cold_visit';

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
    doctor_name: string | null;
    sales_rep_name: string;
    sales_rep_id: string | null;
    sales_rep_email: string | null;
    visit_type: string | null;
    client_address: string | null;
    client_comuna: string | null;
    client_zone: string | null;
}

interface SellerOption {
    id: string;
    name: string;
    email: string | null;
}

interface VisitFilters {
    from: string;
    to: string;
    seller: string;
    type: VisitTypeFilter;
    status: VisitStatusFilter;
    q: string;
}

const normalizeVisitStatus = (status: string | null | undefined) => (status || '').toLowerCase();
const normalizeRole = (role: string | null | undefined) => (role || '').trim().toLowerCase();
const toInputDate = (value: Date) => format(value, 'yyyy-MM-dd');

const getDefaultFilters = (): VisitFilters => {
    const today = toInputDate(new Date());
    return {
        from: today,
        to: today,
        seller: 'all',
        type: 'cold_visit',
        status: 'all',
        q: ''
    };
};

const sanitizeTypeFilter = (value: string | null): VisitTypeFilter => {
    if (value === 'all' || value === 'cold_visit') return value;
    return 'cold_visit';
};

const sanitizeStatusFilter = (value: string | null): VisitStatusFilter => {
    if (value === 'all' || value === 'in_progress' || value === 'completed' || value === 'cancelled') {
        return value;
    }
    return 'all';
};

const parseFiltersFromSearchParams = (searchParams: URLSearchParams): VisitFilters => {
    const defaults = getDefaultFilters();
    return {
        from: searchParams.get('from') || defaults.from,
        to: searchParams.get('to') || defaults.to,
        seller: searchParams.get('seller') || defaults.seller,
        type: sanitizeTypeFilter(searchParams.get('type')),
        status: sanitizeStatusFilter(searchParams.get('status')),
        q: searchParams.get('q') || defaults.q
    };
};

const areFiltersEqual = (left: VisitFilters, right: VisitFilters) =>
    left.from === right.from
    && left.to === right.to
    && left.seller === right.seller
    && left.type === right.type
    && left.status === right.status
    && left.q === right.q;

const toRangeIso = (from: string, to: string) => {
    const safeFrom = from || toInputDate(new Date());
    const safeTo = to || safeFrom;
    const orderedFrom = safeFrom <= safeTo ? safeFrom : safeTo;
    const orderedTo = safeFrom <= safeTo ? safeTo : safeFrom;

    return {
        fromIso: new Date(`${orderedFrom}T00:00:00`).toISOString(),
        toIso: new Date(`${orderedTo}T23:59:59.999`).toISOString()
    };
};

const getRelatedRecord = <T,>(value: T | T[] | null | undefined): T | null => {
    if (Array.isArray(value)) return value[0] || null;
    return value || null;
};

const isSellerLikeRole = (role: string | null | undefined) => {
    const normalizedRole = normalizeRole(role);
    return normalizedRole === 'seller' || normalizedRole === 'vendedor' || normalizedRole === 'sales';
};

const getSellerDisplayName = (profile: { full_name?: string | null; email?: string | null } | null | undefined) =>
    profile?.full_name || profile?.email?.split('@')[0] || 'Vendedor';

const getVisitStatusLabel = (status: string | null | undefined) => {
    const normalized = normalizeVisitStatus(status);
    if (normalized === 'completed') return 'Finalizada';
    if (normalized === 'in_progress' || normalized === 'in-progress') return 'En Curso';
    if (normalized === 'cancelled') return 'Cancelada';
    if (normalized === 'scheduled' || normalized === 'pending') return 'Agendada';
    if (normalized === 'rescheduled') return 'Reagendada';
    return status || 'Sin estado';
};

const getVisitStatusClass = (status: string | null | undefined) => {
    const normalized = normalizeVisitStatus(status);
    if (normalized === 'completed') return 'bg-green-100 text-green-700';
    if (normalized === 'in_progress' || normalized === 'in-progress') return 'bg-blue-100 text-blue-700 animate-pulse';
    if (normalized === 'cancelled') return 'bg-gray-100 text-gray-500';
    if (normalized === 'scheduled' || normalized === 'pending') return 'bg-purple-100 text-purple-700';
    if (normalized === 'rescheduled') return 'bg-amber-100 text-amber-700';
    return 'bg-gray-100 text-gray-500';
};

const getVisitTypeLabel = (visit: VisitHistoryItem) => {
    if ((visit.visit_type || '').toLowerCase() === 'cold_visit') return 'Visita en Frio';
    const normalizedStatus = normalizeVisitStatus(visit.status);
    if (normalizedStatus === 'scheduled' || normalizedStatus === 'pending' || normalizedStatus === 'rescheduled') {
        return 'Agendada';
    }
    return 'Visita';
};

const buildLocationLabel = (visit: VisitHistoryItem) => {
    const address = String(visit.client_address || '').trim();
    const area = String(visit.client_comuna || visit.client_zone || '').trim();
    const hasGps = (typeof visit.lat === 'number' && typeof visit.lng === 'number')
        || (typeof visit.check_out_lat === 'number' && typeof visit.check_out_lng === 'number');

    if (address && area && !address.toLowerCase().includes(area.toLowerCase())) {
        return `${address}, ${area}`;
    }
    if (address) return address;
    if (area) return area;
    if (hasGps) return 'GPS registrado';
    return 'Sin ubicacion';
};

const formatHour = (value: string | null) => (value ? format(parseISO(value), 'HH:mm') : '--');

const LiveDuration = ({ start }: { start: string }) => {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(intervalId);
    }, []);

    const minutes = Math.max(0, Math.floor((now - parseISO(start).getTime()) / 60000));
    if (minutes < 60) return <span>En curso {minutes} min</span>;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return <span>En curso {hours}h {remainingMinutes}m</span>;
};

const VisitHistory = () => {
    const { profile, isSupervisor, effectiveRole, hasPermission, permissions } = useUser();
    const [searchParams, setSearchParams] = useSearchParams();
    const [visits, setVisits] = useState<VisitHistoryItem[]>([]);
    const [sellerOptions, setSellerOptions] = useState<SellerOption[]>([]);
    const [sellerScopeIds, setSellerScopeIds] = useState<string[]>([]);
    const [sellerScopeReady, setSellerScopeReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<VisitFilters>(() => parseFiltersFromSearchParams(searchParams));

    const canViewAllTeamVisits = effectiveRole === 'admin' || hasPermission('VIEW_ALL_TEAM_STATS');
    const canViewVisitSummary = effectiveRole === 'admin'
        || effectiveRole === 'jefe'
        || isSupervisor
        || hasPermission('VIEW_TEAM_STATS')
        || canViewAllTeamVisits;

    useEffect(() => {
        const nextFilters = parseFiltersFromSearchParams(searchParams);
        setFilters((current) => (areFiltersEqual(current, nextFilters) ? current : nextFilters));
    }, [searchParams]);

    useEffect(() => {
        const nextSearchParams = new URLSearchParams();
        nextSearchParams.set('from', filters.from);
        nextSearchParams.set('to', filters.to);
        nextSearchParams.set('seller', filters.seller);
        nextSearchParams.set('type', filters.type);
        nextSearchParams.set('status', filters.status);
        nextSearchParams.set('q', filters.q);

        if (nextSearchParams.toString() !== searchParams.toString()) {
            setSearchParams(nextSearchParams, { replace: true });
        }
    }, [filters, searchParams, setSearchParams]);

    useEffect(() => {
        const fetchSellerOptions = async () => {
            if (!profile?.id || !canViewVisitSummary) {
                setSellerOptions([]);
                setSellerScopeIds([]);
                setSellerScopeReady(true);
                return;
            }

            setSellerScopeReady(false);

            try {
                const { fromIso, toIso } = toRangeIso(filters.from, filters.to);
                let scopedProfilesQuery = supabase
                    .from('profiles')
                    .select('id, full_name, email, role, supervisor_id');

                if (!canViewAllTeamVisits) {
                    scopedProfilesQuery = scopedProfilesQuery.eq('supervisor_id', profile.id);
                }

                const { data: scopedProfiles, error: scopedProfilesError } = await scopedProfilesQuery;
                if (scopedProfilesError) throw scopedProfilesError;

                const scopeIds = Array.from(
                    new Set((scopedProfiles || []).map((item: any) => item.id).filter(Boolean))
                );

                let visitProfilesQuery = supabase
                    .from('visits')
                    .select('sales_rep_id, profiles:sales_rep_id(id, full_name, email, role)')
                    .gte('check_in_time', fromIso)
                    .lte('check_in_time', toIso);

                if (!canViewAllTeamVisits) {
                    if (scopeIds.length === 0) {
                        setSellerOptions([]);
                        setSellerScopeIds([]);
                        setSellerScopeReady(true);
                        return;
                    }

                    visitProfilesQuery = visitProfilesQuery.in('sales_rep_id', scopeIds);
                }

                const { data: visitProfiles, error: visitProfilesError } = await visitProfilesQuery;
                if (visitProfilesError) throw visitProfilesError;

                const sellersById = new Map<string, SellerOption>();

                (scopedProfiles || []).forEach((item: any) => {
                    if (!item?.id || !isSellerLikeRole(item.role)) return;
                    sellersById.set(item.id, {
                        id: item.id,
                        name: getSellerDisplayName(item),
                        email: item.email || null
                    });
                });

                (visitProfiles || []).forEach((row: any) => {
                    const relatedProfile = getRelatedRecord<any>(row.profiles);
                    const sellerId = row.sales_rep_id || relatedProfile?.id;
                    if (!sellerId) return;
                    if (!canViewAllTeamVisits && !scopeIds.includes(sellerId)) return;

                    sellersById.set(sellerId, {
                        id: sellerId,
                        name: getSellerDisplayName(relatedProfile),
                        email: relatedProfile?.email || null
                    });
                });

                const nextOptions = Array.from(sellersById.values()).sort((left, right) =>
                    left.name.localeCompare(right.name, 'es', { sensitivity: 'base' })
                );
                const nextScopeIds = Array.from(new Set([
                    ...scopeIds,
                    ...nextOptions.map((item) => item.id)
                ]));

                setSellerOptions(nextOptions);
                setSellerScopeIds(nextScopeIds);

                if (filters.seller !== 'all' && !nextScopeIds.includes(filters.seller)) {
                    setFilters((current) => ({ ...current, seller: 'all' }));
                }
            } catch (error) {
                console.error('Error fetching sellers for visit history:', error);
                setSellerOptions([]);
                setSellerScopeIds([]);
            } finally {
                setSellerScopeReady(true);
            }
        };

        void fetchSellerOptions();
    }, [profile?.id, filters.from, filters.to, canViewAllTeamVisits, canViewVisitSummary, permissions]);

    useEffect(() => {
        const fetchVisits = async () => {
            if (!profile?.id || !canViewVisitSummary || !sellerScopeReady) return;
            setLoading(true);

            try {
                const { fromIso, toIso } = toRangeIso(filters.from, filters.to);

                if (!canViewAllTeamVisits && sellerScopeIds.length === 0) {
                    setVisits([]);
                    return;
                }

                let query = supabase
                    .from('visits')
                    .select(`
                        id,
                        check_in_time,
                        check_out_time,
                        notes,
                        status,
                        lat,
                        lng,
                        check_out_lat,
                        check_out_lng,
                        sales_rep_id,
                        type,
                        clients (name, status, purchase_contact, address, comuna, zone),
                        profiles:sales_rep_id (id, full_name, email)
                    `)
                    .gte('check_in_time', fromIso)
                    .lte('check_in_time', toIso)
                    .order('check_in_time', { ascending: false });

                if (filters.seller !== 'all') {
                    query = query.eq('sales_rep_id', filters.seller);
                } else if (!canViewAllTeamVisits) {
                    query = query.in('sales_rep_id', sellerScopeIds);
                }

                if (filters.type === 'cold_visit') {
                    query = query.eq('type', 'cold_visit');
                }

                if (filters.status === 'in_progress') {
                    query = query.in('status', ['in_progress', 'in-progress']);
                } else if (filters.status !== 'all') {
                    query = query.eq('status', filters.status);
                }

                const { data, error } = await query;
                if (error) throw error;

                const transformedData: VisitHistoryItem[] = (data || []).map((visit: any) => {
                    const client = getRelatedRecord<any>(visit.clients);
                    const salesRep = getRelatedRecord<any>(visit.profiles);

                    return {
                        id: visit.id,
                        check_in_time: visit.check_in_time,
                        check_out_time: visit.check_out_time,
                        notes: visit.notes,
                        status: visit.status || 'Sin estado',
                        lat: visit.lat,
                        lng: visit.lng,
                        check_out_lat: visit.check_out_lat,
                        check_out_lng: visit.check_out_lng,
                        client_name: client?.name || 'Cliente Desconocido',
                        client_status: client?.status || 'active',
                        doctor_name: client?.purchase_contact || null,
                        sales_rep_name: getSellerDisplayName(salesRep),
                        sales_rep_id: visit.sales_rep_id || salesRep?.id || null,
                        sales_rep_email: salesRep?.email || null,
                        visit_type: visit.type || null,
                        client_address: client?.address || null,
                        client_comuna: client?.comuna || null,
                        client_zone: client?.zone || null
                    };
                });

                setVisits(transformedData);
            } catch (error) {
                console.error('Error fetching visit history:', error);
                setVisits([]);
            } finally {
                setLoading(false);
            }
        };

        void fetchVisits();
    }, [
        profile?.id,
        filters.from,
        filters.to,
        filters.seller,
        filters.type,
        filters.status,
        sellerScopeIds,
        sellerScopeReady,
        canViewAllTeamVisits,
        canViewVisitSummary
    ]);

    const updateFilter = <K extends keyof VisitFilters>(key: K, value: VisitFilters[K]) => {
        setFilters((current) => ({ ...current, [key]: value }));
    };

    const resetFilters = () => {
        setFilters(getDefaultFilters());
    };

    const calculateDuration = (start: string, end: string | null, status: string) => {
        const normalized = normalizeVisitStatus(status);
        if (!end) {
            if (normalized === 'cancelled') return 'Cancelada';
            if (normalized === 'scheduled' || normalized === 'pending') return 'Agendada';
            if (normalized === 'rescheduled') return 'Reagendada';
            return 'En curso';
        }

        const minutes = differenceInMinutes(parseISO(end), parseISO(start));
        if (minutes < 60) return `${minutes} min`;

        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    };

    const filteredVisits = visits.filter((visit) => {
        const query = filters.q.trim().toLowerCase();
        if (!query) return true;

        return visit.client_name.toLowerCase().includes(query)
            || (visit.doctor_name || '').toLowerCase().includes(query)
            || visit.sales_rep_name.toLowerCase().includes(query)
            || (visit.sales_rep_email || '').toLowerCase().includes(query)
            || (visit.notes || '').toLowerCase().includes(query)
            || buildLocationLabel(visit).toLowerCase().includes(query);
    });

    if (!canViewVisitSummary) return <Navigate to="/" replace />;

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">Historial de Visitas</h1>
                    <p className="text-gray-500 font-medium">Seguimiento diario del equipo con foco en visitas en frio.</p>
                </div>
                <div className="text-xs font-black uppercase tracking-widest text-dental-600 bg-dental-50 px-4 py-3 rounded-2xl border border-dental-100">
                    {filteredVisits.length} registros
                </div>
            </div>

            <div className="bg-white rounded-[2.5rem] p-6 shadow-xl shadow-gray-200/50 border border-gray-50">
                <div className="flex items-center gap-2 mb-5">
                    <Filter size={18} className="text-gray-400" />
                    <p className="text-sm font-black text-gray-700 uppercase tracking-widest">Filtros</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                    <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Desde</span>
                        <div className="relative">
                            <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="date"
                                value={filters.from}
                                onChange={(event) => updateFilter('from', event.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 font-bold focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                            />
                        </div>
                    </label>
                    <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Hasta</span>
                        <div className="relative">
                            <CalendarIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="date"
                                value={filters.to}
                                onChange={(event) => updateFilter('to', event.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 font-bold focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                            />
                        </div>
                    </label>
                    <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Vendedor</span>
                        <div className="relative">
                            <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <select
                                value={filters.seller}
                                onChange={(event) => updateFilter('seller', event.target.value)}
                                className="w-full appearance-none pl-12 pr-4 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 font-bold focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                            >
                                <option value="all">Todos los vendedores</option>
                                {sellerOptions.map((seller) => (
                                    <option key={seller.id} value={seller.id}>
                                        {seller.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </label>
                    <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Tipo</span>
                        <select
                            value={filters.type}
                            onChange={(event) => updateFilter('type', sanitizeTypeFilter(event.target.value))}
                            className="w-full appearance-none px-4 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 font-bold focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                        >
                            <option value="cold_visit">Visita en Frio</option>
                            <option value="all">Todas las visitas</option>
                        </select>
                    </label>
                    <label className="space-y-2">
                        <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Estado</span>
                        <select
                            value={filters.status}
                            onChange={(event) => updateFilter('status', sanitizeStatusFilter(event.target.value))}
                            className="w-full appearance-none px-4 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 font-bold focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                        >
                            <option value="all">Todos</option>
                            <option value="in_progress">En curso</option>
                            <option value="completed">Finalizada</option>
                            <option value="cancelled">Cancelada</option>
                        </select>
                    </label>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="w-full px-4 py-4 bg-gray-50 text-gray-600 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-100 transition-all"
                        >
                            <RotateCcw size={18} />
                            Restablecer
                        </button>
                    </div>
                </div>
                <div className="mt-4">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por cliente, vendedor, ubicacion o notas..."
                            value={filters.q}
                            onChange={(event) => updateFilter('q', event.target.value)}
                            className="w-full pl-12 pr-6 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 placeholder:text-gray-400 focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                        />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-xl shadow-gray-200/50 border border-gray-50 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-gray-50/50 border-b border-gray-100">
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Fecha</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Inicio</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Termino</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Duracion</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Vendedor</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Cliente</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Ubicacion</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Estado</th>
                                <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Notas / Gestion</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, index) => (
                                    <tr key={index} className="animate-pulse">
                                        <td colSpan={9} className="px-8 py-8">
                                            <div className="h-8 bg-gray-100 rounded-xl w-full"></div>
                                        </td>
                                    </tr>
                                ))
                            ) : filteredVisits.length > 0 ? (
                                filteredVisits.map((visit) => (
                                    <tr key={visit.id} className="hover:bg-gray-50/80 transition-colors group">
                                        <td className="px-6 py-6 text-sm font-bold text-gray-900 whitespace-nowrap">
                                            {format(parseISO(visit.check_in_time), 'dd MMM yyyy', { locale: es })}
                                        </td>
                                        <td className="px-6 py-6 text-sm font-bold text-gray-900 whitespace-nowrap">
                                            {formatHour(visit.check_in_time)}
                                        </td>
                                        <td className="px-6 py-6 text-sm font-bold text-gray-500 whitespace-nowrap">
                                            {formatHour(visit.check_out_time)}
                                        </td>
                                        <td className="px-6 py-6">
                                            <div className="flex items-center text-xs font-black text-dental-600 bg-dental-50 w-fit px-3 py-2 rounded-xl uppercase tracking-widest">
                                                <Timer size={12} className="mr-1.5 shrink-0" />
                                                {normalizeVisitStatus(visit.status) === 'in_progress' || normalizeVisitStatus(visit.status) === 'in-progress' ? (
                                                    <LiveDuration start={visit.check_in_time} />
                                                ) : (
                                                    <span>{calculateDuration(visit.check_in_time, visit.check_out_time, visit.status)}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-6">
                                            <div className="flex items-center space-x-3">
                                                <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-indigo-50 text-indigo-600">
                                                    <Users size={18} />
                                                </div>
                                                <div>
                                                    <p className="font-black text-gray-900 leading-tight">{visit.sales_rep_name}</p>
                                                    {visit.sales_rep_email && (
                                                        <p className="text-xs font-medium text-gray-400">{visit.sales_rep_email}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-6">
                                            <div className="flex items-center space-x-4">
                                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isProspectStatus(visit.client_status) ? 'bg-amber-100 text-amber-600' : 'bg-dental-100 text-dental-600'}`}>
                                                    <User size={20} />
                                                </div>
                                                <div>
                                                    <p className="font-black text-gray-900 leading-tight">{visit.client_name}</p>
                                                    <div className="mt-1 flex flex-wrap gap-2">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${isProspectStatus(visit.client_status) ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                                            {getVisitTypeLabel(visit)}
                                                        </span>
                                                        {visit.doctor_name && (
                                                            <span className="text-[10px] font-black text-indigo-600">Dr(a). {visit.doctor_name}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-6 max-w-sm">
                                            <div className="space-y-2">
                                                <div className="flex items-start gap-2">
                                                    <MapPin size={16} className="text-gray-300 mt-1 shrink-0" />
                                                    <p className="text-sm font-medium text-gray-600 leading-relaxed">
                                                        {buildLocationLabel(visit)}
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {typeof visit.lat === 'number' && typeof visit.lng === 'number' && (
                                                        <a
                                                            href={`https://www.google.com/maps?q=${visit.lat},${visit.lng}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 px-3 py-2 bg-gray-50 text-gray-500 rounded-xl hover:bg-dental-50 hover:text-dental-600 transition-all border border-transparent hover:border-dental-100 text-xs font-black uppercase tracking-widest"
                                                            title="Ver ubicacion check-in"
                                                        >
                                                            <MapPin size={14} />
                                                            IN
                                                        </a>
                                                    )}
                                                    {typeof visit.check_out_lat === 'number' && typeof visit.check_out_lng === 'number' && (
                                                        <a
                                                            href={`https://www.google.com/maps?q=${visit.check_out_lat},${visit.check_out_lng}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 px-3 py-2 bg-gray-50 text-gray-500 rounded-xl hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-transparent hover:border-indigo-100 text-xs font-black uppercase tracking-widest"
                                                            title="Ver ubicacion check-out"
                                                        >
                                                            <ExternalLink size={14} />
                                                            OUT
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-6">
                                            <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest ${getVisitStatusClass(visit.status)}`}>
                                                {getVisitStatusLabel(visit.status)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-6 max-w-sm">
                                            <div className="flex items-start gap-2">
                                                <ClipboardList size={16} className="text-gray-300 mt-1 shrink-0" />
                                                <p className="text-sm font-medium text-gray-600 line-clamp-4 leading-relaxed">
                                                    {visit.notes || <span className="italic text-gray-400">Sin notas registradas</span>}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={9} className="px-8 py-20 text-center">
                                        <div className="max-w-xs mx-auto space-y-4">
                                            <div className="w-16 h-16 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto text-gray-200">
                                                <Search size={32} />
                                            </div>
                                            <p className="text-gray-400 font-bold">No se encontraron visitas para los filtros seleccionados.</p>
                                            <button
                                                onClick={resetFilters}
                                                className="text-dental-600 text-sm font-black uppercase tracking-widest border-b-2 border-dental-600/20 hover:border-dental-600 transition-all"
                                            >
                                                Restablecer filtros
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
