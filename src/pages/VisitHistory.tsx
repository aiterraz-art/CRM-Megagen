import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import {
    Calendar as CalendarIcon,
    ClipboardList,
    Download,
    ExternalLink,
    Filter,
    MapPin,
    RotateCcw,
    Search,
    ShoppingCart,
    Timer,
    User,
    Users
} from 'lucide-react';
import { differenceInMinutes, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { APIProvider } from '@vis.gl/react-google-maps';
import * as XLSX from 'xlsx';
import { isProspectStatus } from '../utils/prospect';
import { Database } from '../types/supabase';
import ClientFormModal from '../components/modals/ClientFormModal';
import { saveClientWithDeduplication } from '../utils/clientDuplicates';

type Client = Database['public']['Tables']['clients']['Row'];
type VisitStatusFilter = 'all' | 'in_progress' | 'completed' | 'cancelled';
type VisitTypeFilter = 'all' | 'cold_visit';
type VisitConversionFilter = 'all' | 'pending' | 'converted';

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
    client_id: string | null;
    client_name: string;
    client_status: string;
    client_address: string | null;
    client_comuna: string | null;
    client_zone: string | null;
    client_email: string | null;
    client_phone: string | null;
    client_rut: string | null;
    client_office: string | null;
    client_giro: string | null;
    client_notes: string | null;
    client_created_by: string | null;
    client_credit_days: number;
    client_requires_discount_approval: boolean;
    client_lat: number | null;
    client_lng: number | null;
    doctor_name: string | null;
    doctor_specialty: string | null;
    sales_rep_name: string;
    sales_rep_id: string | null;
    sales_rep_email: string | null;
    visit_type: string | null;
    linked_order_id: string | null;
    linked_order_folio: number | null;
    conversion_status: 'pending' | 'converted';
}

interface SellerOption {
    id: string;
    name: string;
    email: string | null;
}

interface SellerProfileRow {
    id: string;
    full_name: string | null;
    email: string | null;
    role?: string | null;
}

interface VisitFilters {
    from: string;
    to: string;
    seller: string;
    type: VisitTypeFilter;
    status: VisitStatusFilter;
    conversion: VisitConversionFilter;
    q: string;
}

const normalizeVisitStatus = (status: string | null | undefined) => (status || '').toLowerCase();
const normalizeRole = (role: string | null | undefined) => (role || '').trim().toLowerCase();
const toInputDate = (value: Date) => format(value, 'yyyy-MM-dd');

const normalizeText = (value: string | null | undefined) => String(value || '').trim();
const normalizeEmail = (value: string | null | undefined) => {
    const clean = String(value || '').trim().toLowerCase();
    return clean || null;
};
const normalizeNullableNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
};

const getDefaultFilters = (): VisitFilters => {
    const today = toInputDate(new Date());
    return {
        from: today,
        to: today,
        seller: 'all',
        type: 'cold_visit',
        status: 'all',
        conversion: 'pending',
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

const sanitizeConversionFilter = (value: string | null): VisitConversionFilter => {
    if (value === 'all' || value === 'pending' || value === 'converted') return value;
    return 'pending';
};

const parseFiltersFromSearchParams = (searchParams: URLSearchParams): VisitFilters => {
    const defaults = getDefaultFilters();
    return {
        from: searchParams.get('from') || defaults.from,
        to: searchParams.get('to') || defaults.to,
        seller: searchParams.get('seller') || defaults.seller,
        type: sanitizeTypeFilter(searchParams.get('type')),
        status: sanitizeStatusFilter(searchParams.get('status')),
        conversion: sanitizeConversionFilter(searchParams.get('conversion')),
        q: searchParams.get('q') || defaults.q
    };
};

const areFiltersEqual = (left: VisitFilters, right: VisitFilters) =>
    left.from === right.from
    && left.to === right.to
    && left.seller === right.seller
    && left.type === right.type
    && left.status === right.status
    && left.conversion === right.conversion
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

const mapProfileToSellerOption = (profile: SellerProfileRow | null | undefined): SellerOption | null => {
    if (!profile?.id) return null;
    return {
        id: profile.id,
        name: getSellerDisplayName(profile),
        email: profile.email || null
    };
};

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

const getConversionLabel = (visit: VisitHistoryItem) => {
    if ((visit.visit_type || '').toLowerCase() !== 'cold_visit') return 'N/A';
    return visit.conversion_status === 'converted'
        ? `Pedido${visit.linked_order_folio ? ` #${visit.linked_order_folio}` : ''}`
        : 'Sin convertir';
};

const getConversionClass = (visit: VisitHistoryItem) => {
    if ((visit.visit_type || '').toLowerCase() !== 'cold_visit') return 'bg-slate-100 text-slate-500';
    return visit.conversion_status === 'converted'
        ? 'bg-emerald-100 text-emerald-700'
        : 'bg-amber-100 text-amber-700';
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
    const navigate = useNavigate();
    const { profile, isSupervisor, effectiveRole, hasPermission } = useUser();
    const [searchParams, setSearchParams] = useSearchParams();
    const [visits, setVisits] = useState<VisitHistoryItem[]>([]);
    const [sellerOptions, setSellerOptions] = useState<SellerOption[]>([]);
    const [sellerScopeIds, setSellerScopeIds] = useState<string[]>([]);
    const [sellerScopeReady, setSellerScopeReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<VisitFilters>(() => parseFiltersFromSearchParams(searchParams));
    const [selectedVisit, setSelectedVisit] = useState<VisitHistoryItem | null>(null);

    const isSellerSelfView = effectiveRole === 'seller';
    const canViewAllTeamVisits = effectiveRole === 'admin'
        || effectiveRole === 'jefe'
        || hasPermission('VIEW_ALL_TEAM_STATS');
    const canViewVisitSummary = effectiveRole === 'admin'
        || effectiveRole === 'jefe'
        || effectiveRole === 'seller'
        || isSupervisor
        || hasPermission('VIEW_TEAM_STATS')
        || canViewAllTeamVisits;
    const canConvertColdVisitToSale = effectiveRole === 'seller'
        || effectiveRole === 'admin'
        || effectiveRole === 'jefe'
        || hasPermission('MANAGE_CLIENTS')
        || hasPermission('VIEW_ALL_CLIENTS');

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
        nextSearchParams.set('conversion', filters.conversion);
        nextSearchParams.set('q', filters.q);

        if (nextSearchParams.toString() !== searchParams.toString()) {
            setSearchParams(nextSearchParams, { replace: true });
        }
    }, [filters, searchParams, setSearchParams]);

    useEffect(() => {
        if (!profile?.id || !isSellerSelfView) return;
        setFilters((current) => (current.seller === profile.id ? current : { ...current, seller: profile.id }));
    }, [profile?.id, isSellerSelfView]);

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
                if (isSellerSelfView) {
                    const selfOption = mapProfileToSellerOption({
                        id: profile.id,
                        full_name: profile.full_name || null,
                        email: profile.email || null,
                        role: effectiveRole || 'seller'
                    });

                    setSellerOptions(selfOption ? [selfOption] : []);
                    setSellerScopeIds([profile.id]);
                    if (filters.seller !== profile.id) {
                        setFilters((current) => ({ ...current, seller: profile.id }));
                    }
                    return;
                }

                let scopedProfilesQuery = supabase
                    .from('profiles')
                    .select('id, full_name, email, role');

                if (!canViewAllTeamVisits) {
                    scopedProfilesQuery = scopedProfilesQuery.eq('supervisor_id', profile.id);
                }

                const { data: scopedProfiles, error: scopedProfilesError } = await scopedProfilesQuery;
                if (scopedProfilesError) throw scopedProfilesError;

                const scopeIds = Array.from(
                    new Set((scopedProfiles || []).map((item: any) => item.id).filter(Boolean))
                );

                let visitSellerIdsQuery = supabase
                    .from('visits')
                    .select('sales_rep_id')
                    .not('sales_rep_id', 'is', null)
                    .order('check_in_time', { ascending: false })
                    .limit(5000);

                if (!canViewAllTeamVisits && scopeIds.length > 0) {
                    visitSellerIdsQuery = visitSellerIdsQuery.in('sales_rep_id', scopeIds);
                }

                const { data: visitSellerRows, error: visitSellerRowsError } = await visitSellerIdsQuery;
                if (visitSellerRowsError) throw visitSellerRowsError;

                const visitSellerIds = Array.from(
                    new Set((visitSellerRows || []).map((row: any) => row.sales_rep_id).filter(Boolean))
                );

                let visitProfiles: SellerProfileRow[] = [];
                if (visitSellerIds.length > 0) {
                    const { data: visitProfilesData, error: visitProfilesError } = await supabase
                        .from('profiles')
                        .select('id, full_name, email, role')
                        .in('id', visitSellerIds);

                    if (visitProfilesError) throw visitProfilesError;
                    visitProfiles = (visitProfilesData || []) as SellerProfileRow[];
                }

                let fallbackProfiles: SellerProfileRow[] = [];
                if (!canViewAllTeamVisits && scopeIds.length === 0) {
                    const { data: fallbackProfilesData, error: fallbackProfilesError } = await supabase
                        .from('profiles')
                        .select('id, full_name, email, role');

                    if (fallbackProfilesError) throw fallbackProfilesError;
                    fallbackProfiles = (fallbackProfilesData || []) as SellerProfileRow[];
                }

                const sellersById = new Map<string, SellerOption>();

                (scopedProfiles || []).forEach((item: any) => {
                    if (!item?.id || !isSellerLikeRole(item.role)) return;
                    const sellerOption = mapProfileToSellerOption(item);
                    if (!sellerOption) return;
                    sellersById.set(sellerOption.id, sellerOption);
                });

                visitProfiles.forEach((profileRow) => {
                    if (!profileRow?.id) return;
                    if (!canViewAllTeamVisits && scopeIds.length > 0 && !scopeIds.includes(profileRow.id)) return;
                    const sellerOption = mapProfileToSellerOption(profileRow);
                    if (!sellerOption) return;
                    sellersById.set(sellerOption.id, sellerOption);
                });

                fallbackProfiles.forEach((profileRow) => {
                    if (!profileRow?.id || !isSellerLikeRole(profileRow.role)) return;
                    const sellerOption = mapProfileToSellerOption(profileRow);
                    if (!sellerOption) return;
                    sellersById.set(sellerOption.id, sellerOption);
                });

                const nextOptions = Array.from(sellersById.values()).sort((left, right) =>
                    left.name.localeCompare(right.name, 'es', { sensitivity: 'base' })
                );
                const nextScopeIds = Array.from(new Set([
                    ...scopeIds,
                    ...visitSellerIds,
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
    }, [profile?.id, profile?.full_name, profile?.email, filters.seller, canViewAllTeamVisits, canViewVisitSummary, isSellerSelfView, effectiveRole, hasPermission]);

    useEffect(() => {
        const fetchVisits = async () => {
            if (!profile?.id || !canViewVisitSummary || !sellerScopeReady) return;
            setLoading(true);

            try {
                const { fromIso, toIso } = toRangeIso(filters.from, filters.to);
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
                        cold_visit_clinic_name,
                        cold_visit_address,
                        cold_visit_doctor_name,
                        cold_visit_doctor_specialty,
                        cold_visit_client_email,
                        cold_visit_client_rut,
                        clients (
                            id,
                            name,
                            status,
                            purchase_contact,
                            address,
                            comuna,
                            zone,
                            email,
                            phone,
                            rut,
                            office,
                            giro,
                            notes,
                            created_by,
                            credit_days,
                            requires_discount_approval,
                            doctor_specialty,
                            lat,
                            lng
                        ),
                        profiles:sales_rep_id (id, full_name, email)
                    `)
                    .gte('check_in_time', fromIso)
                    .lte('check_in_time', toIso)
                    .order('check_in_time', { ascending: false });

                if (isSellerSelfView) {
                    query = query.eq('sales_rep_id', profile.id);
                } else if (filters.seller !== 'all') {
                    query = query.eq('sales_rep_id', filters.seller);
                } else if (!canViewAllTeamVisits && sellerScopeIds.length > 0) {
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

                const rawVisits = (data || []) as any[];
                const visitIds = rawVisits.map((visit) => visit.id).filter(Boolean);
                const ordersByVisitId = new Map<string, { id: string; folio: number | null }>();

                if (visitIds.length > 0) {
                    const { data: orders, error: ordersError } = await supabase
                        .from('orders')
                        .select('id, folio, visit_id')
                        .in('visit_id', visitIds);

                    if (ordersError) throw ordersError;

                    (orders || []).forEach((order: any) => {
                        if (order?.visit_id && !ordersByVisitId.has(order.visit_id)) {
                            ordersByVisitId.set(order.visit_id, {
                                id: order.id,
                                folio: order.folio ?? null
                            });
                        }
                    });
                }

                const transformedData: VisitHistoryItem[] = rawVisits.map((visit: any) => {
                    const client = getRelatedRecord<any>(visit.clients);
                    const salesRep = getRelatedRecord<any>(visit.profiles);
                    const linkedOrder = ordersByVisitId.get(visit.id);

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
                        client_id: visit.client_id || client?.id || null,
                        client_name: client?.name || visit.cold_visit_clinic_name || 'Visita en frío sin ficha',
                        client_status: client?.status || (visit.cold_visit_clinic_name ? 'cold_visit_transient' : 'active'),
                        client_address: client?.address || visit.cold_visit_address || null,
                        client_comuna: client?.comuna || null,
                        client_zone: client?.zone || null,
                        client_email: client?.email || visit.cold_visit_client_email || null,
                        client_phone: client?.phone || null,
                        client_rut: client?.rut || visit.cold_visit_client_rut || null,
                        client_office: client?.office || null,
                        client_giro: client?.giro || null,
                        client_notes: client?.notes || null,
                        client_created_by: client?.created_by || null,
                        client_credit_days: Number(client?.credit_days || 0),
                        client_requires_discount_approval: Boolean(client?.requires_discount_approval),
                        client_lat: client?.lat ?? null,
                        client_lng: client?.lng ?? null,
                        doctor_name: client?.purchase_contact || visit.cold_visit_doctor_name || null,
                        doctor_specialty: client?.doctor_specialty || visit.cold_visit_doctor_specialty || null,
                        sales_rep_name: getSellerDisplayName(salesRep),
                        sales_rep_id: visit.sales_rep_id || salesRep?.id || null,
                        sales_rep_email: salesRep?.email || null,
                        visit_type: visit.type || null,
                        linked_order_id: linkedOrder?.id || null,
                        linked_order_folio: linkedOrder?.folio || null,
                        conversion_status: linkedOrder ? 'converted' : 'pending'
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
        canViewVisitSummary,
        isSellerSelfView
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

    const filteredVisits = useMemo(() => visits.filter((visit) => {
        const query = filters.q.trim().toLowerCase();
        if (query) {
            const matchesQuery = visit.client_name.toLowerCase().includes(query)
                || (visit.doctor_name || '').toLowerCase().includes(query)
                || visit.sales_rep_name.toLowerCase().includes(query)
                || (visit.sales_rep_email || '').toLowerCase().includes(query)
                || (visit.notes || '').toLowerCase().includes(query)
                || buildLocationLabel(visit).toLowerCase().includes(query);

            if (!matchesQuery) return false;
        }

        const isColdVisit = (visit.visit_type || '').toLowerCase() === 'cold_visit';
        if (filters.conversion !== 'all') {
            if (!isColdVisit) return false;
            if (filters.conversion !== visit.conversion_status) return false;
        }

        return true;
    }), [visits, filters.q, filters.conversion]);

    const pendingColdVisitsCount = useMemo(
        () => filteredVisits.filter((visit) => (visit.visit_type || '').toLowerCase() === 'cold_visit' && visit.conversion_status === 'pending').length,
        [filteredVisits]
    );

    const buildClientFormInitialData = (visit: VisitHistoryItem): Partial<Client> => ({
        id: visit.client_id || undefined,
        name: visit.client_name || '',
        purchase_contact: visit.doctor_name || '',
        doctor_specialty: visit.doctor_specialty || '',
        rut: visit.client_rut || '',
        phone: visit.client_phone || '',
        email: visit.client_email || '',
        address: visit.client_address || '',
        office: visit.client_office || '',
        lat: visit.client_lat ?? visit.lat ?? 0,
        lng: visit.client_lng ?? visit.lng ?? 0,
        notes: visit.client_notes || visit.notes || '',
        giro: visit.client_giro || '',
        comuna: visit.client_comuna || ''
    });

    const handleSellColdVisit = (visit: VisitHistoryItem) => {
        if (visit.conversion_status === 'converted') {
            alert(`Esta visita ya fue convertida${visit.linked_order_folio ? ` en el pedido #${visit.linked_order_folio}` : ' en una venta'}.`);
            return;
        }
        if (normalizeVisitStatus(visit.status) === 'cancelled') {
            alert('No se puede vender una visita cancelada.');
            return;
        }
        setSelectedVisit(visit);
    };

    const handleSaveSaleClient = async (formData: Partial<Client>) => {
        if (!selectedVisit || !profile?.id) {
            throw new Error('No se pudo identificar la visita a convertir.');
        }

        const payload = {
            name: normalizeText(formData.name || selectedVisit.client_name),
            purchase_contact: normalizeText(formData.purchase_contact || selectedVisit.doctor_name) || null,
            doctor_specialty: normalizeText(formData.doctor_specialty || selectedVisit.doctor_specialty) || null,
            rut: normalizeText(formData.rut) || null,
            phone: normalizeText(formData.phone || selectedVisit.client_phone) || null,
            email: normalizeEmail(formData.email || selectedVisit.client_email),
            address: normalizeText(formData.address || selectedVisit.client_address) || null,
            office: normalizeText(formData.office || selectedVisit.client_office) || null,
            lat: normalizeNullableNumber(formData.lat ?? selectedVisit.client_lat ?? selectedVisit.lat),
            lng: normalizeNullableNumber(formData.lng ?? selectedVisit.client_lng ?? selectedVisit.lng),
            notes: normalizeText(formData.notes || selectedVisit.client_notes || selectedVisit.notes) || null,
            giro: normalizeText(formData.giro || selectedVisit.client_giro) || null,
            comuna: normalizeText(formData.comuna || selectedVisit.client_comuna) || null,
            status: 'active',
            created_by: selectedVisit.client_created_by || selectedVisit.sales_rep_id || profile.id,
            zone: selectedVisit.client_zone || profile.zone || 'Sin Zona',
            credit_days: selectedVisit.client_credit_days || 0,
            requires_discount_approval: selectedVisit.client_requires_discount_approval
        };

        if (!payload.name) {
            throw new Error('Debes ingresar el nombre del cliente.');
        }
        if (!payload.rut) {
            throw new Error('Debes ingresar el RUT para convertir esta visita en cliente.');
        }
        if (!payload.email) {
            throw new Error('Debes ingresar un correo para continuar con la venta.');
        }
        if (!payload.phone) {
            throw new Error('Debes ingresar un teléfono para continuar con la venta.');
        }

        let savedClient: Client | null = null;

        if (selectedVisit.client_id) {
            const { data, error } = await supabase
                .from('clients')
                .update(payload)
                .eq('id', selectedVisit.client_id)
                .select('*')
                .single();

            if (error) throw error;
            savedClient = data as Client;
        } else {
            const result = await saveClientWithDeduplication(payload as Database['public']['Tables']['clients']['Insert'] & { created_by?: string | null }, {
                onDuplicate: 'merge'
            });
            savedClient = result.client;
        }

        if (!savedClient?.id) {
            throw new Error('No se pudo guardar el cliente para la venta.');
        }

        const { error: visitUpdateError } = await supabase
            .from('visits')
            .update({ client_id: savedClient.id })
            .eq('id', selectedVisit.id);

        if (visitUpdateError) throw visitUpdateError;

        setVisits((current) => current.map((visit) => (
            visit.id !== selectedVisit.id
                ? visit
                : {
                    ...visit,
                    client_id: savedClient.id,
                    client_name: savedClient.name,
                    client_status: savedClient.status || 'active',
                    client_address: savedClient.address,
                    client_comuna: savedClient.comuna,
                    client_zone: savedClient.zone,
                    client_email: savedClient.email,
                    client_phone: savedClient.phone,
                    client_rut: savedClient.rut,
                    client_office: savedClient.office,
                    client_giro: savedClient.giro,
                    client_notes: savedClient.notes,
                    client_created_by: savedClient.created_by,
                    client_credit_days: savedClient.credit_days || 0,
                    client_requires_discount_approval: Boolean(savedClient.requires_discount_approval),
                    client_lat: savedClient.lat,
                    client_lng: savedClient.lng,
                    doctor_name: savedClient.purchase_contact,
                    doctor_specialty: savedClient.doctor_specialty
                }
        )));

        const sourceVisitId = selectedVisit.id;
        setSelectedVisit(null);
        navigate('/quotations', {
            state: {
                client: savedClient,
                sourceVisitId
            }
        });
    };

    const handleExportExcel = () => {
        if (filteredVisits.length === 0) {
            alert('No hay visitas para exportar con los filtros actuales.');
            return;
        }

        const rows = filteredVisits.map((visit) => ({
            fecha: format(parseISO(visit.check_in_time), 'yyyy-MM-dd'),
            hora_inicio: formatHour(visit.check_in_time),
            hora_termino: formatHour(visit.check_out_time),
            duracion: calculateDuration(visit.check_in_time, visit.check_out_time, visit.status),
            vendedor: visit.sales_rep_name,
            email_vendedor: visit.sales_rep_email || '',
            tipo_visita: getVisitTypeLabel(visit),
            cliente: visit.client_name,
            doctor: visit.doctor_name || '',
            ubicacion: buildLocationLabel(visit),
            estado: getVisitStatusLabel(visit.status),
            conversion: getConversionLabel(visit),
            pedido_folio: visit.linked_order_folio || '',
            notas: visit.notes || '',
            lat_checkin: visit.lat ?? '',
            lng_checkin: visit.lng ?? '',
            lat_checkout: visit.check_out_lat ?? '',
            lng_checkout: visit.check_out_lng ?? ''
        }));

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Visitas');

        const scopeLabel = filters.type === 'cold_visit' ? 'visitas_frio' : 'visitas';
        XLSX.writeFile(workbook, `${scopeLabel}_${filters.from}_${filters.to}.xlsx`);
    };

    if (!canViewVisitSummary) return <Navigate to="/" replace />;

    return (
        <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY} libraries={['places']}>
            <div className="space-y-8 animate-in fade-in duration-700">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">Visitas en Frío</h1>
                        <p className="text-gray-500 font-medium">Cada vendedor ve sus visitas y puede convertirlas en venta desde el botón Vender.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={handleExportExcel}
                            disabled={loading || filteredVisits.length === 0}
                            className="px-4 py-3 bg-white border border-gray-100 rounded-2xl text-gray-700 font-black text-xs uppercase tracking-widest shadow-sm hover:bg-gray-50 transition-all inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Download size={16} />
                            Excel
                        </button>
                        <div className="text-xs font-black uppercase tracking-widest text-dental-600 bg-dental-50 px-4 py-3 rounded-2xl border border-dental-100">
                            {filteredVisits.length} registros
                        </div>
                        <div className="text-xs font-black uppercase tracking-widest text-amber-700 bg-amber-50 px-4 py-3 rounded-2xl border border-amber-100">
                            {pendingColdVisitsCount} sin convertir
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-[2.5rem] p-6 shadow-xl shadow-gray-200/50 border border-gray-50">
                    <div className="flex items-center gap-2 mb-5">
                        <Filter size={18} className="text-gray-400" />
                        <p className="text-sm font-black text-gray-700 uppercase tracking-widest">Filtros</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-4">
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
                        <label className="space-y-2">
                            <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Conversión</span>
                            <select
                                value={filters.conversion}
                                onChange={(event) => updateFilter('conversion', sanitizeConversionFilter(event.target.value))}
                                className="w-full appearance-none px-4 py-4 bg-gray-50/50 border border-transparent rounded-2xl text-gray-900 font-bold focus:bg-white focus:border-dental-500/30 outline-none transition-all"
                            >
                                <option value="pending">Sin convertir</option>
                                <option value="converted">Convertidas</option>
                                <option value="all">Todas</option>
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
                        <table className="w-full text-left min-w-[1500px]">
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
                                    <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Conversión</th>
                                    <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest">Notas / Gestion</th>
                                    <th className="px-6 py-5 text-xs font-black text-gray-400 uppercase tracking-widest text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {loading ? (
                                    Array.from({ length: 5 }).map((_, index) => (
                                        <tr key={index} className="animate-pulse">
                                            <td colSpan={11} className="px-8 py-8">
                                                <div className="h-8 bg-gray-100 rounded-xl w-full"></div>
                                            </td>
                                        </tr>
                                    ))
                                ) : filteredVisits.length > 0 ? (
                                    filteredVisits.map((visit) => {
                                        const isColdVisit = (visit.visit_type || '').toLowerCase() === 'cold_visit';
                                        const canSellThisVisit = canConvertColdVisitToSale
                                            && isColdVisit
                                            && visit.conversion_status === 'pending'
                                            && normalizeVisitStatus(visit.status) !== 'cancelled';

                                        return (
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
                                                                {visit.client_rut && (
                                                                    <span className="text-[10px] font-black text-slate-500">RUT {visit.client_rut}</span>
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
                                                <td className="px-6 py-6">
                                                    <span className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap ${getConversionClass(visit)}`}>
                                                        {getConversionLabel(visit)}
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
                                                <td className="px-6 py-6 text-right">
                                                    {canSellThisVisit ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSellColdVisit(visit)}
                                                            className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-dental-600 text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-dental-200 hover:bg-dental-700 transition-all"
                                                        >
                                                            <ShoppingCart size={16} />
                                                            Vender
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs font-black uppercase tracking-widest text-gray-300">
                                                            {visit.conversion_status === 'converted' ? 'Vendida' : 'Sin acción'}
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={11} className="px-8 py-20 text-center">
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

                {selectedVisit && (
                    <ClientFormModal
                        isOpen={Boolean(selectedVisit)}
                        onClose={() => setSelectedVisit(null)}
                        onSave={handleSaveSaleClient}
                        initialData={buildClientFormInitialData(selectedVisit)}
                        title={`Vender visita: ${selectedVisit.client_name}`}
                        persistenceKey={`cold_visit_sale_${selectedVisit.id}`}
                    />
                )}
            </div>
        </APIProvider>
    );
};

export default VisitHistory;
