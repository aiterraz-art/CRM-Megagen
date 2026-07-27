import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkGPSConnection } from '../utils/gps';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { useVisit } from '../contexts/VisitContext';
import { queueVisitCheckinLocation } from '../services/locationQueue';
import { MapPin, Building2, ChevronRight, ClipboardList, ShoppingCart, Stethoscope, Users } from 'lucide-react';
import { saveClientWithDeduplication } from '../utils/clientDuplicates';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

const formatGpsAddress = (lat: number, lng: number) => `Ubicación GPS (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
const COLD_VISIT_DRAFT_KEY = 'cold_visit_draft';

type PendingColdVisitItem = {
    id: string;
    check_in_time: string;
    status: string | null;
    sales_rep_id: string | null;
    sales_rep_name: string;
    client_name: string;
    address: string | null;
    doctor_name: string | null;
};

const normalizeRole = (role: string | null | undefined) => (role || '').trim().toLowerCase();
const isSellerLikeRole = (role: string | null | undefined) => {
    const normalizedRole = normalizeRole(role);
    return normalizedRole === 'seller' || normalizedRole === 'vendedor' || normalizedRole === 'sales';
};
const getSellerDisplayName = (profile: { full_name?: string | null; email?: string | null } | null | undefined) =>
    profile?.full_name || profile?.email?.split('@')[0] || 'Vendedor';
const getVisitStatusLabel = (status: string | null | undefined) => {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'completed') return 'Finalizada';
    if (normalized === 'in_progress' || normalized === 'in-progress') return 'En curso';
    if (normalized === 'cancelled') return 'Cancelada';
    return status || 'Sin estado';
};

const loadColdVisitDraft = () => {
    if (typeof window === 'undefined') return { clinicName: '', address: '' };

    try {
        const savedDraft = localStorage.getItem(COLD_VISIT_DRAFT_KEY);
        if (!savedDraft) return { clinicName: '', address: '' };

        const parsed = JSON.parse(savedDraft);
        return {
            clinicName: String(parsed?.clinicName || ''),
            address: String(parsed?.address || '')
        };
    } catch {
        return { clinicName: '', address: '' };
    }
};

const reverseGeocodeAddress = async (lat: number, lng: number): Promise<string | null> => {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&accept-language=es`;
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const label = typeof payload?.display_name === 'string' ? payload.display_name.trim() : '';
        return label || null;
    } catch {
        return null;
    }
};

const ColdVisit = () => {
    const navigate = useNavigate();
    const { profile, effectiveRole, hasPermission, isSupervisor } = useUser();
    const { startVisit, activeVisit } = useVisit();
    const initialDraft = loadColdVisitDraft();

    // Form State
    const [clinicName, setClinicName] = useState(initialDraft.clinicName);
    const [address, setAddress] = useState(initialDraft.address);
    const [loading, setLoading] = useState(false);
    const [location, setLocation] = useState<{ lat: number, lng: number, accuracy: number } | null>(null);
    const [gpsReady, setGpsReady] = useState(false);
    const [pendingVisits, setPendingVisits] = useState<PendingColdVisitItem[]>([]);
    const [pendingLoading, setPendingLoading] = useState(true);

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

    // Get location on mount
    useEffect(() => {
        let mounted = true;
        const loadLocation = async () => {
            try {
                const pos = await checkGPSConnection({ showAlert: false, timeoutMs: 15000, retries: 2, minAccuracyMeters: 200 });
                if (!mounted) return;
                setLocation({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
                setGpsReady(true);
            } catch (error) {
                console.warn('ColdVisit GPS unavailable:', error);
                if (mounted) setGpsReady(false);
            }
        };
        loadLocation();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        localStorage.setItem(COLD_VISIT_DRAFT_KEY, JSON.stringify({
            clinicName,
            address
        }));
    }, [clinicName, address]);

    useEffect(() => {
        const fetchPendingColdVisits = async () => {
            if (!profile?.id || !canViewVisitSummary) {
                setPendingVisits([]);
                setPendingLoading(false);
                return;
            }

            setPendingLoading(true);
            try {
                let scopedSellerIds: string[] | null = null;
                if (isSellerSelfView) {
                    scopedSellerIds = [profile.id];
                } else if (!canViewAllTeamVisits) {
                    const { data: scopedProfiles, error: scopedProfilesError } = await supabase
                        .from('profiles')
                        .select('id, role')
                        .eq('supervisor_id', profile.id);

                    if (scopedProfilesError) throw scopedProfilesError;

                    scopedSellerIds = Array.from(new Set([
                        profile.id,
                        ...(scopedProfiles || [])
                            .filter((item: any) => isSellerLikeRole(item?.role))
                            .map((item: any) => item.id)
                            .filter(Boolean)
                    ]));
                }

                let query = supabase
                    .from('visits')
                    .select(`
                        id,
                        check_in_time,
                        status,
                        sales_rep_id,
                        cold_visit_clinic_name,
                        cold_visit_address,
                        cold_visit_doctor_name,
                        clients (
                            name,
                            address,
                            purchase_contact
                        ),
                        profiles:sales_rep_id (full_name, email)
                    `)
                    .eq('type', 'cold_visit')
                    .neq('status', 'cancelled')
                    .order('check_in_time', { ascending: false })
                    .limit(12);

                if (scopedSellerIds && scopedSellerIds.length > 0) {
                    query = query.in('sales_rep_id', scopedSellerIds);
                }

                const { data: rawVisits, error: visitsError } = await query;
                if (visitsError) throw visitsError;

                const visitIds = (rawVisits || []).map((visit: any) => visit.id).filter(Boolean);
                const convertedVisitIds = new Set<string>();

                if (visitIds.length > 0) {
                    const { data: orders, error: ordersError } = await supabase
                        .from('orders')
                        .select('visit_id')
                        .in('visit_id', visitIds);

                    if (ordersError) throw ordersError;
                    (orders || []).forEach((order: any) => {
                        if (order?.visit_id) convertedVisitIds.add(order.visit_id);
                    });
                }

                const nextVisits = (rawVisits || [])
                    .filter((visit: any) => !convertedVisitIds.has(visit.id))
                    .map((visit: any) => {
                        const client = Array.isArray(visit.clients) ? visit.clients[0] : visit.clients;
                        const salesRep = Array.isArray(visit.profiles) ? visit.profiles[0] : visit.profiles;

                        return {
                            id: visit.id,
                            check_in_time: visit.check_in_time,
                            status: visit.status || null,
                            sales_rep_id: visit.sales_rep_id || null,
                            sales_rep_name: getSellerDisplayName(salesRep),
                            client_name: client?.name || visit.cold_visit_clinic_name || 'Visita en frío sin ficha',
                            address: client?.address || visit.cold_visit_address || null,
                            doctor_name: client?.purchase_contact || visit.cold_visit_doctor_name || null
                        } satisfies PendingColdVisitItem;
                    });

                setPendingVisits(nextVisits);
            } catch (error) {
                console.error('Error loading pending cold visits:', error);
                setPendingVisits([]);
            } finally {
                setPendingLoading(false);
            }
        };

        void fetchPendingColdVisits();
    }, [profile?.id, effectiveRole, hasPermission, isSupervisor, canViewAllTeamVisits, canViewVisitSummary, isSellerSelfView]);

    const openColdVisitList = (visit?: PendingColdVisitItem) => {
        const params = new URLSearchParams();
        const fromDate = format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd');
        const toDate = format(new Date(), 'yyyy-MM-dd');
        params.set('from', fromDate);
        params.set('to', toDate);
        params.set('type', 'cold_visit');
        params.set('status', 'all');
        params.set('conversion', 'pending');
        params.set('seller', visit?.sales_rep_id || (isSellerSelfView && profile?.id ? profile.id : 'all'));
        params.set('q', visit?.client_name || '');
        navigate(`/visits?${params.toString()}`);
    };

    const handleStartColdVisit = async (e: React.FormEvent) => {
        e.preventDefault();
        const clinicNameClean = clinicName.trim();
        const addressClean = address.trim();

        if (!clinicNameClean) {
            alert('Por favor completa el nombre de la clínica.');
            return;
        }
        if (clinicNameClean.length < 3) {
            alert('El nombre de la clínica debe tener al menos 3 caracteres.');
            return;
        }

        if (!profile) return;
        if (activeVisit) {
            alert('Ya tienes una visita en curso. Debes finalizarla antes de iniciar una nueva.');
            if (activeVisit.client_id) {
                navigate(`/visit/${activeVisit.client_id}`);
            }
            return;
        }
        setLoading(true);

        try {
            let currentLocation = location;
            if (!currentLocation) {
                try {
                    const gpsPosition = await checkGPSConnection({
                        showAlert: false,
                        timeoutMs: 15000,
                        retries: 2,
                        minAccuracyMeters: 200
                    });
                    currentLocation = {
                        lat: gpsPosition.coords.latitude,
                        lng: gpsPosition.coords.longitude,
                        accuracy: gpsPosition.coords.accuracy
                    };
                    setLocation(currentLocation);
                    setGpsReady(true);
                } catch {
                    currentLocation = null;
                }
            }

            if (!currentLocation) {
                alert('No fue posible obtener GPS confiable para registrar la visita en frío. Activa la ubicación y vuelve a intentar.');
                return;
            }

            let resolvedAddress = addressClean;
            if (!resolvedAddress) {
                resolvedAddress = (await reverseGeocodeAddress(currentLocation.lat, currentLocation.lng)) || formatGpsAddress(currentLocation.lat, currentLocation.lng);
            }

            // 1. Create "Prospect" Client
            const newClient = {
                name: clinicNameClean,
                purchase_contact: null,
                doctor_specialty: null,
                address: resolvedAddress,
                lat: currentLocation?.lat ?? null,
                lng: currentLocation?.lng ?? null,
                status: 'prospect_new',
                created_by: profile.id,
                zone: profile.zone || 'Sin Zona',
                notes: `Visita en Frío iniciada el ${new Date().toLocaleDateString()} (con GPS ±${Math.round(currentLocation.accuracy)}m)`
            };

            const dedupeResult = await saveClientWithDeduplication(newClient, { onDuplicate: 'merge' });
            const createdClient = dedupeResult.client;
            if (!createdClient?.id) throw new Error('No se pudo crear o recuperar el prospecto.');

            // 2. Start Visit immediately
            const visit = await startVisit(createdClient.id, { type: 'cold_visit' });

            if (visit) {
                localStorage.removeItem(COLD_VISIT_DRAFT_KEY);
                await queueVisitCheckinLocation({
                    visit_id: visit.id,
                    seller_id: profile.id,
                    lat: currentLocation.lat,
                    lng: currentLocation.lng
                });
                // 3. Redirect to Visit Log
                navigate(`/visit/${createdClient.id}`);
            } else {
                throw new Error("No se pudo iniciar la visita después de crear el cliente.");
            }

        } catch (error: any) {
            console.error("Error in Cold Visit:", error);
            alert(`Error al iniciar: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
            <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-xl shadow-blue-50">
                    <Stethoscope size={32} />
                </div>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">Visita en Frío</h1>
                <p className="text-gray-400 font-medium mt-2">Registra un nuevo prospecto y comienza la visita de inmediato.</p>
            </div>

            <div className="max-w-xl mx-auto">
                <form onSubmit={handleStartColdVisit} className="premium-card p-8 space-y-6">

                    {/* Clinic Name */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Nombre Clínica / Lugar</label>
                        <div className="relative group">
                            <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-blue-500 transition-colors" size={20} />
                            <input
                                type="text"
                                value={clinicName}
                                onChange={(e) => setClinicName(e.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-transparent rounded-2xl font-bold text-gray-900 focus:bg-white focus:ring-4 focus:ring-blue-50 focus:border-blue-100 outline-none transition-all placeholder:text-gray-300 placeholder:font-medium"
                                placeholder="Ej. Clínica Dental Centro"
                                required
                            />
                        </div>
                    </div>

                    {/* Address (Optional) */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Dirección (Opcional)</label>
                        <div className="relative group">
                            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-blue-500 transition-colors" size={20} />
                            <input
                                type="text"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-transparent rounded-2xl font-bold text-gray-900 focus:bg-white focus:ring-4 focus:ring-blue-50 focus:border-blue-100 outline-none transition-all placeholder:text-gray-300 placeholder:font-medium"
                                placeholder="Ej. Av. Providencia 1234"
                            />
                        </div>
                    </div>

                    <div className="pt-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all flex items-center justify-center hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <span className="flex items-center">
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                                    Creando...
                                </span>
                            ) : (
                                <>
                                    Iniciar Visita <ChevronRight className="ml-2" />
                                </>
                            )}
                        </button>
                    </div>

                </form>

                <div className="text-center mt-6">
                    <p className="text-xs text-gray-400 font-medium">
                        Se requiere GPS para iniciar visita en frío y registrar ubicación real.
                    </p>
                    <p className="text-[11px] text-gray-500 font-bold mt-2">
                        Al finalizar la visita será obligatorio ingresar nombre del doctor y su especialidad.
                    </p>
                    <p className={`text-[10px] font-bold mt-1 flex items-center justify-center ${gpsReady ? 'text-green-500' : 'text-amber-500'}`}>
                        <MapPin size={10} className="mr-1" /> {gpsReady ? 'GPS Activo' : 'GPS no disponible'}
                    </p>
                </div>
            </div>

            <section className="space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-blue-500">Pendientes</p>
                        <h2 className="text-2xl font-black text-gray-900 mt-1">Listado de visitas en frío</h2>
                        <p className="text-sm text-gray-500 font-medium mt-1">
                            {isSellerSelfView ? 'Tus visitas en frío aún no convertidas.' : 'Visitas en frío pendientes por convertir del equipo.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => openColdVisitList()}
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-white border border-gray-100 text-gray-700 text-xs font-black uppercase tracking-widest shadow-sm hover:bg-gray-50 transition-all"
                    >
                        <ClipboardList size={16} />
                        Ver listado completo
                    </button>
                </div>

                <div className="premium-card p-6">
                    {pendingLoading ? (
                        <div className="space-y-3">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <div key={index} className="h-24 rounded-2xl bg-gray-100 animate-pulse"></div>
                            ))}
                        </div>
                    ) : pendingVisits.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 rounded-3xl bg-blue-50 text-blue-300 flex items-center justify-center mx-auto mb-4">
                                <ClipboardList size={28} />
                            </div>
                            <p className="text-gray-400 font-bold">No hay visitas en frío pendientes por convertir.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            {pendingVisits.map((visit) => (
                                <div key={visit.id} className="rounded-[2rem] border border-gray-100 bg-white p-5 shadow-sm">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-widest">
                                                    Sin convertir
                                                </span>
                                                <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest">
                                                    {getVisitStatusLabel(visit.status)}
                                                </span>
                                            </div>
                                            <h3 className="text-lg font-black text-gray-900 truncate">{visit.client_name}</h3>
                                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                                                {format(parseISO(visit.check_in_time), 'dd MMM yyyy • HH:mm', { locale: es })}
                                            </p>
                                        </div>
                                        {!isSellerSelfView && (
                                            <div className="shrink-0 text-right">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Vendedor</p>
                                                <div className="mt-2 inline-flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700">
                                                    <Users size={14} />
                                                    {visit.sales_rep_name}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 space-y-2 text-sm text-gray-600">
                                        <div className="flex items-start gap-2">
                                            <MapPin size={15} className="mt-0.5 text-gray-300 shrink-0" />
                                            <span>{visit.address || 'Sin dirección registrada'}</span>
                                        </div>
                                        {visit.doctor_name && (
                                            <div className="flex items-start gap-2">
                                                <Stethoscope size={15} className="mt-0.5 text-gray-300 shrink-0" />
                                                <span>{visit.doctor_name}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-5 flex flex-col sm:flex-row gap-3">
                                        <button
                                            type="button"
                                            onClick={() => openColdVisitList(visit)}
                                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
                                        >
                                            <ShoppingCart size={16} />
                                            Vender
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => openColdVisitList(visit)}
                                            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-gray-50 text-gray-600 text-xs font-black uppercase tracking-widest hover:bg-gray-100 transition-all"
                                        >
                                            <ClipboardList size={16} />
                                            Abrir
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>

        </div>
    );
};

export default ColdVisit;
