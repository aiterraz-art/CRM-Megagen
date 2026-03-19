import React, { useEffect, useMemo, useState } from 'react';
import { APIProvider, AdvancedMarker, InfoWindow, Map, Pin } from '@vis.gl/react-google-maps';
import {
    AlertTriangle,
    CalendarDays,
    CheckCircle2,
    ClipboardList,
    Clock3,
    MapPin,
    Package,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldCheck,
    Truck,
    X
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Database } from '../types/supabase';
import { checkGPSConnection } from '../utils/gps';

type LoanKitRow = Database['public']['Tables']['loan_kits']['Row'];
type KitLoanRequestRow = Database['public']['Tables']['kit_loan_requests']['Row'];
type ClientRow = Database['public']['Tables']['clients']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type KitStatus = LoanKitRow['status'];
type KitLoanStatus = KitLoanRequestRow['status'];
type KitLoansTab = 'available' | 'requests' | 'map' | 'history';
type RequestActionType = 'deliver' | 'return';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const SANTIAGO_CENTER = { lat: -33.4489, lng: -70.6693 };

const KIT_STATUS_LABELS: Record<KitStatus, string> = {
    available: 'Disponible',
    reserved: 'Reservado',
    loaned: 'Prestado',
    inactive: 'Inactivo'
};

const KIT_STATUS_STYLES: Record<KitStatus, string> = {
    available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    reserved: 'bg-amber-50 text-amber-700 border-amber-200',
    loaned: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    inactive: 'bg-slate-100 text-slate-500 border-slate-200'
};

const REQUEST_STATUS_LABELS: Record<KitLoanStatus, string> = {
    pending_dispatch: 'Pendiente despacho',
    delivered: 'Entregado',
    returned: 'Devuelto',
    cancelled: 'Cancelado'
};

const REQUEST_STATUS_STYLES: Record<KitLoanStatus, string> = {
    pending_dispatch: 'bg-amber-50 text-amber-700 border-amber-200',
    delivered: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    returned: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-slate-100 text-slate-500 border-slate-200'
};

const createEmptyKitForm = () => ({
    kitName: '',
    kitNumber: '',
    notes: ''
});

const createEmptyRequestForm = () => ({
    kitId: '',
    clientId: '',
    clientSearch: '',
    requestedDays: 3,
    requestNote: '',
    deliveryAddress: '',
    lat: null as number | null,
    lng: null as number | null
});

const formatDate = (value?: string | null) => {
    if (!value) return 'Sin fecha';
    return new Date(value).toLocaleDateString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

const formatDateTime = (value?: string | null) => {
    if (!value) return 'Sin registro';
    return new Date(value).toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const getProfileLabel = (profile?: ProfileRow | null) => {
    if (!profile) return 'Sin responsable';
    if (profile.full_name?.trim()) return profile.full_name.trim();
    return profile.email?.split('@')[0] || 'Sin nombre';
};

const buildClientAddress = (client?: ClientRow | null) => {
    if (!client) return '';
    return [client.address, client.office, client.comuna].filter(Boolean).join(', ');
};

const isValidCoordinates = (lat: number | null | undefined, lng: number | null | undefined) => {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
    return Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180;
};

const getDaysRemaining = (request: KitLoanRequestRow) => {
    if (request.status !== 'delivered' || !request.due_at) return null;
    const now = Date.now();
    const dueAt = new Date(request.due_at).getTime();
    const diff = dueAt - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

const getRemainingTone = (daysRemaining: number | null) => {
    if (daysRemaining === null) return 'text-slate-500';
    if (daysRemaining <= 0) return 'text-rose-600';
    if (daysRemaining <= 3) return 'text-amber-600';
    return 'text-emerald-600';
};

const getMarkerTone = (daysRemaining: number | null) => {
    if (daysRemaining === null) return '#6366f1';
    if (daysRemaining <= 0) return '#e11d48';
    if (daysRemaining <= 3) return '#f59e0b';
    return '#10b981';
};

const KitLoans: React.FC = () => {
    const { profile, effectiveRole, hasPermission } = useUser();
    const canViewKitLoans = hasPermission('VIEW_KIT_LOANS');
    const canRequestKitLoans = hasPermission('REQUEST_KIT_LOANS');
    const canManageKitLoans = hasPermission('MANAGE_KIT_LOANS');

    const [activeTab, setActiveTab] = useState<KitLoansTab>('available');
    const [loading, setLoading] = useState(true);
    const [savingKit, setSavingKit] = useState(false);
    const [savingRequest, setSavingRequest] = useState(false);
    const [processingAction, setProcessingAction] = useState(false);
    const [kits, setKits] = useState<LoanKitRow[]>([]);
    const [requests, setRequests] = useState<KitLoanRequestRow[]>([]);
    const [clients, setClients] = useState<ClientRow[]>([]);
    const [profiles, setProfiles] = useState<ProfileRow[]>([]);
    const [kitSearch, setKitSearch] = useState('');
    const [requestSearch, setRequestSearch] = useState('');
    const [requestStatusFilter, setRequestStatusFilter] = useState<'all' | KitLoanStatus>('all');
    const [showKitModal, setShowKitModal] = useState(false);
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [editingKit, setEditingKit] = useState<LoanKitRow | null>(null);
    const [selectedMapRequestId, setSelectedMapRequestId] = useState<string | null>(null);
    const [requestAction, setRequestAction] = useState<{ request: KitLoanRequestRow; type: RequestActionType } | null>(null);
    const [actionNote, setActionNote] = useState('');
    const [kitForm, setKitForm] = useState(createEmptyKitForm());
    const [requestForm, setRequestForm] = useState(createEmptyRequestForm());
    const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false);

    const profilesById = useMemo(() => new globalThis.Map(profiles.map((row) => [row.id, row])), [profiles]);
    const clientsById = useMemo(() => new globalThis.Map(clients.map((row) => [row.id, row])), [clients]);
    const kitsById = useMemo(() => new globalThis.Map(kits.map((row) => [row.id, row])), [kits]);

    const defaultTab = canManageKitLoans ? 'requests' : 'available';

    useEffect(() => {
        setActiveTab(defaultTab);
    }, [defaultTab]);

    const fetchKitLoanData = async () => {
        setLoading(true);
        try {
            const [kitsRes, requestsRes, clientsRes, profilesRes] = await Promise.all([
                supabase.from('loan_kits').select('*').order('kit_name'),
                supabase.from('kit_loan_requests').select('*').order('requested_at', { ascending: false }),
                supabase.from('clients').select('id, name, address, lat, lng, rut, comuna, office').order('name'),
                supabase.from('profiles').select('id, full_name, email, role, status').order('full_name')
            ]);

            if (kitsRes.error) throw kitsRes.error;
            if (requestsRes.error) throw requestsRes.error;
            if (clientsRes.error) throw clientsRes.error;
            if (profilesRes.error) throw profilesRes.error;

            setKits((kitsRes.data || []) as LoanKitRow[]);
            setRequests((requestsRes.data || []) as KitLoanRequestRow[]);
            setClients((clientsRes.data || []) as ClientRow[]);
            setProfiles((profilesRes.data || []) as ProfileRow[]);
        } catch (error: any) {
            console.error('Error loading kit loans module:', error);
            alert(`Error cargando módulo de kits: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (canViewKitLoans) {
            void fetchKitLoanData();
        }
    }, [canViewKitLoans]);

    const openCreateKitModal = (kit?: LoanKitRow) => {
        if (kit) {
            setEditingKit(kit);
            setKitForm({
                kitName: kit.kit_name,
                kitNumber: kit.kit_number,
                notes: kit.notes || ''
            });
        } else {
            setEditingKit(null);
            setKitForm(createEmptyKitForm());
        }
        setShowKitModal(true);
    };

    const openCreateRequestModal = (kit?: LoanKitRow) => {
        setRequestForm({
            ...createEmptyRequestForm(),
            kitId: kit?.status === 'available' ? kit.id : ''
        });
        setClientSuggestionsOpen(false);
        setShowRequestModal(true);
    };

    const activeRequestByKitId = useMemo(() => {
        const map = new globalThis.Map<string, KitLoanRequestRow>();
        requests
            .filter((request) => request.status === 'pending_dispatch' || request.status === 'delivered')
            .forEach((request) => map.set(request.kit_id, request));
        return map;
    }, [requests]);

    const filteredKits = useMemo(() => {
        const term = kitSearch.trim().toLowerCase();
        const base = kits.filter((kit) => {
            if (!term) return true;
            return [kit.kit_name, kit.kit_number, kit.notes]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(term);
        });

        return [...base].sort((a, b) => {
            const order: Record<string, number> = { available: 0, reserved: 1, loaned: 2, inactive: 3 };
            return (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.kit_name.localeCompare(b.kit_name);
        });
    }, [kitSearch, kits]);

    const filteredClients = useMemo(() => {
        const term = requestForm.clientSearch.trim().toLowerCase();
        if (!term) return clients.slice(0, 8);
        return clients
            .filter((client) => [client.name, client.rut, client.address, client.comuna, client.office]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(term))
            .slice(0, 8);
    }, [clients, requestForm.clientSearch]);

    const selectedClient = requestForm.clientId ? clientsById.get(requestForm.clientId) || null : null;
    const activeRequests = useMemo(
        () => requests.filter((request) => request.status === 'pending_dispatch' || request.status === 'delivered'),
        [requests]
    );
    const historyRequests = useMemo(
        () => requests.filter((request) => request.status === 'returned' || request.status === 'cancelled'),
        [requests]
    );

    const filteredActiveRequests = useMemo(() => {
        return activeRequests.filter((request) => {
            const requester = profilesById.get(request.requester_id);
            const haystack = [
                request.kit_name_snapshot,
                request.kit_number_snapshot,
                request.client_name_snapshot,
                request.delivery_address_snapshot,
                request.request_note,
                requester?.full_name,
                requester?.email
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            if (requestSearch.trim() && !haystack.includes(requestSearch.trim().toLowerCase())) return false;
            if (requestStatusFilter !== 'all' && request.status !== requestStatusFilter) return false;
            return true;
        });
    }, [activeRequests, profilesById, requestSearch, requestStatusFilter]);

    const deliveredLoans = useMemo(
        () => requests.filter((request) => request.status === 'delivered' && isValidCoordinates(request.delivery_lat_snapshot, request.delivery_lng_snapshot)),
        [requests]
    );

    const overdueCount = useMemo(
        () => deliveredLoans.filter((request) => (getDaysRemaining(request) ?? 1) <= 0).length,
        [deliveredLoans]
    );

    const mapSelectedRequest = selectedMapRequestId
        ? deliveredLoans.find((request) => request.id === selectedMapRequestId) || null
        : deliveredLoans[0] || null;

    const handleSelectClient = (client: ClientRow) => {
        setRequestForm((current) => ({
            ...current,
            clientId: client.id,
            clientSearch: client.name,
            deliveryAddress: buildClientAddress(client),
            lat: typeof client.lat === 'number' ? client.lat : null,
            lng: typeof client.lng === 'number' ? client.lng : null
        }));
        setClientSuggestionsOpen(false);
    };

    const handleUseCurrentGPS = async () => {
        try {
            const position = await checkGPSConnection();
            setRequestForm((current) => ({
                ...current,
                lat: position.coords.latitude,
                lng: position.coords.longitude
            }));
        } catch (error: any) {
            console.error('Error obtaining GPS location:', error);
        }
    };

    const handleSaveKit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!profile?.id || !canManageKitLoans) {
            alert('No tienes permisos para registrar kits.');
            return;
        }

        const kitName = kitForm.kitName.trim();
        const kitNumber = kitForm.kitNumber.trim();

        if (!kitName || !kitNumber) {
            alert('Nombre y número del kit son obligatorios.');
            return;
        }

        setSavingKit(true);
        try {
            const payload: Database['public']['Tables']['loan_kits']['Insert'] = {
                kit_name: kitName,
                kit_number: kitNumber,
                notes: kitForm.notes.trim() || null,
                created_by: editingKit?.created_by || profile.id
            };

            if (editingKit) {
                const { error } = await supabase
                    .from('loan_kits')
                    .update({
                        kit_name: payload.kit_name,
                        kit_number: payload.kit_number,
                        notes: payload.notes
                    })
                    .eq('id', editingKit.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('loan_kits').insert(payload);
                if (error) throw error;
            }

            setShowKitModal(false);
            setEditingKit(null);
            setKitForm(createEmptyKitForm());
            await fetchKitLoanData();
        } catch (error: any) {
            console.error('Error saving kit:', error);
            alert(`Error guardando kit: ${error.message}`);
        } finally {
            setSavingKit(false);
        }
    };

    const handleToggleKitAvailability = async (kit: LoanKitRow) => {
        if (!canManageKitLoans) return;
        if (!(kit.status === 'available' || kit.status === 'inactive')) return;

        const nextStatus = kit.status === 'inactive' ? 'available' : 'inactive';
        const confirmed = window.confirm(nextStatus === 'inactive'
            ? `¿Desactivar ${kit.kit_name} (${kit.kit_number})?`
            : `¿Reactivar ${kit.kit_name} (${kit.kit_number})?`);
        if (!confirmed) return;

        try {
            const { error } = await supabase.from('loan_kits').update({ status: nextStatus }).eq('id', kit.id);
            if (error) throw error;
            await fetchKitLoanData();
        } catch (error: any) {
            console.error('Error toggling kit availability:', error);
            alert(`Error actualizando kit: ${error.message}`);
        }
    };

    const handleSaveRequest = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!profile?.id || !canRequestKitLoans) {
            alert('No tienes permisos para solicitar kits.');
            return;
        }

        const selectedKit = requestForm.kitId ? kitsById.get(requestForm.kitId) || null : null;
        if (!selectedKit || selectedKit.status !== 'available') {
            alert('Debes seleccionar un kit disponible.');
            return;
        }

        if (!selectedClient) {
            alert('Debes seleccionar un cliente desde el listado.');
            return;
        }

        if (!requestForm.deliveryAddress.trim()) {
            alert('Debes confirmar la dirección del préstamo.');
            return;
        }

        if (!isValidCoordinates(requestForm.lat, requestForm.lng)) {
            alert('Debes confirmar una ubicación GPS válida para el préstamo.');
            return;
        }

        if (!requestForm.requestedDays || requestForm.requestedDays <= 0) {
            alert('Los días de préstamo deben ser mayores a cero.');
            return;
        }

        setSavingRequest(true);
        try {
            const payload: Database['public']['Tables']['kit_loan_requests']['Insert'] = {
                kit_id: selectedKit.id,
                client_id: selectedClient.id,
                requester_id: profile.id,
                requested_days: Math.trunc(requestForm.requestedDays),
                request_note: requestForm.requestNote.trim() || null,
                delivery_address_snapshot: requestForm.deliveryAddress.trim(),
                delivery_lat_snapshot: Number(requestForm.lat),
                delivery_lng_snapshot: Number(requestForm.lng),
                client_name_snapshot: selectedClient.name,
                kit_name_snapshot: selectedKit.kit_name,
                kit_number_snapshot: selectedKit.kit_number,
                status: 'pending_dispatch'
            };

            const { error } = await supabase.from('kit_loan_requests').insert(payload);
            if (error) throw error;

            setShowRequestModal(false);
            setRequestForm(createEmptyRequestForm());
            setClientSuggestionsOpen(false);
            await fetchKitLoanData();
            setActiveTab('requests');
        } catch (error: any) {
            console.error('Error creating kit loan request:', error);
            alert(`Error creando solicitud: ${error.message}`);
        } finally {
            setSavingRequest(false);
        }
    };

    const openRequestActionModal = (request: KitLoanRequestRow, type: RequestActionType) => {
        setRequestAction({ request, type });
        setActionNote(type === 'deliver' ? request.delivery_note || '' : request.return_note || '');
    };

    const handleCancelRequest = async (request: KitLoanRequestRow) => {
        if (!canManageKitLoans) return;
        const confirmed = window.confirm(`¿Cancelar la solicitud del kit ${request.kit_number_snapshot}?`);
        if (!confirmed) return;

        setProcessingAction(true);
        try {
            const { error } = await supabase
                .from('kit_loan_requests')
                .update({ status: 'cancelled' })
                .eq('id', request.id);
            if (error) throw error;
            await fetchKitLoanData();
        } catch (error: any) {
            console.error('Error cancelling request:', error);
            alert(`Error cancelando solicitud: ${error.message}`);
        } finally {
            setProcessingAction(false);
        }
    };

    const handleSubmitRequestAction = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!requestAction || !canManageKitLoans) return;

        setProcessingAction(true);
        try {
            const payload = requestAction.type === 'deliver'
                ? { status: 'delivered', delivery_note: actionNote.trim() || null }
                : { status: 'returned', return_note: actionNote.trim() || null };

            const { error } = await supabase
                .from('kit_loan_requests')
                .update(payload)
                .eq('id', requestAction.request.id);
            if (error) throw error;

            setRequestAction(null);
            setActionNote('');
            await fetchKitLoanData();
        } catch (error: any) {
            console.error('Error processing kit request action:', error);
            alert(`Error actualizando préstamo: ${error.message}`);
        } finally {
            setProcessingAction(false);
        }
    };

    if (!canViewKitLoans) {
        return (
            <div className="max-w-3xl mx-auto premium-card p-10 text-center">
                <AlertTriangle className="mx-auto mb-4 text-amber-500" size={36} />
                <h2 className="text-2xl font-black text-slate-900 mb-2">Sin acceso al módulo de kits</h2>
                <p className="text-slate-500 font-medium">Tu perfil no tiene permisos para ver préstamos de kits.</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500 mb-2">Módulo de Kits</p>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900">Préstamo y seguimiento de kits clínicos</h1>
                    <p className="text-slate-500 font-medium mt-2">
                        Gestiona kits prestables, solicitudes del equipo y seguimiento GPS de los préstamos activos.
                    </p>
                </div>
                <div className="flex flex-wrap gap-3">
                    {canRequestKitLoans && (
                        <button
                            onClick={() => openCreateRequestModal()}
                            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 font-black text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700"
                        >
                            <Plus size={18} />
                            Nueva solicitud
                        </button>
                    )}
                    {canManageKitLoans && (
                        <button
                            onClick={() => openCreateKitModal()}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 font-black text-slate-800 shadow-sm transition-all hover:bg-slate-50"
                        >
                            <Package size={18} />
                            Registrar kit
                        </button>
                    )}
                    <button
                        onClick={() => void fetchKitLoanData()}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 font-black text-slate-700 shadow-sm transition-all hover:bg-slate-50"
                    >
                        <RefreshCw size={18} />
                        Actualizar
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="premium-card border-l-4 border-l-emerald-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Disponibles</p>
                            <h3 className="text-3xl font-black text-slate-900">{kits.filter((kit) => kit.status === 'available').length}</h3>
                        </div>
                        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                            <Package size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card border-l-4 border-l-amber-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Pendientes despacho</p>
                            <h3 className="text-3xl font-black text-slate-900">{requests.filter((request) => request.status === 'pending_dispatch').length}</h3>
                        </div>
                        <div className="rounded-2xl bg-amber-50 p-3 text-amber-600">
                            <ClipboardList size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card border-l-4 border-l-indigo-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Prestados</p>
                            <h3 className="text-3xl font-black text-slate-900">{deliveredLoans.length}</h3>
                        </div>
                        <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
                            <Truck size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card border-l-4 border-l-rose-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Vencidos</p>
                            <h3 className="text-3xl font-black text-slate-900">{overdueCount}</h3>
                        </div>
                        <div className="rounded-2xl bg-rose-50 p-3 text-rose-600">
                            <Clock3 size={24} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <button onClick={() => setActiveTab('available')} className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'available' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}>
                        Disponibles
                    </button>
                    <button onClick={() => setActiveTab('requests')} className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'requests' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}>
                        Solicitudes
                    </button>
                    <button onClick={() => setActiveTab('map')} className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'map' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}>
                        Mapa de préstamos
                    </button>
                    <button onClick={() => setActiveTab('history')} className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'history' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}>
                        Historial
                    </button>
                </div>
            </div>

            {activeTab === 'available' && (
                <div className="space-y-6">
                    <div className="relative max-w-2xl">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            value={kitSearch}
                            onChange={(event) => setKitSearch(event.target.value)}
                            placeholder="Buscar por nombre, número o nota del kit..."
                            className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        />
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                            {[1, 2, 3].map((index) => (
                                <div key={index} className="premium-card h-64 animate-pulse bg-slate-50" />
                            ))}
                        </div>
                    ) : filteredKits.length === 0 ? (
                        <div className="premium-card p-10 text-center">
                            <Package className="mx-auto mb-4 text-slate-300" size={36} />
                            <h3 className="text-xl font-black text-slate-900 mb-2">No hay kits para los filtros actuales</h3>
                            <p className="text-slate-500 font-medium">Prueba cambiando el texto de búsqueda.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                            {filteredKits.map((kit) => {
                                const activeRequest = activeRequestByKitId.get(kit.id);
                                const requester = activeRequest ? profilesById.get(activeRequest.requester_id) : null;
                                const remainingDays = activeRequest ? getDaysRemaining(activeRequest) : null;
                                return (
                                    <div key={kit.id} className="premium-card flex flex-col gap-4 p-6">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Kit {kit.kit_number}</p>
                                                <h3 className="mt-2 text-2xl font-black text-slate-900">{kit.kit_name}</h3>
                                            </div>
                                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${KIT_STATUS_STYLES[kit.status as KitStatus]}`}>
                                                {KIT_STATUS_LABELS[kit.status as KitStatus]}
                                            </span>
                                        </div>

                                        <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                                            {activeRequest ? (
                                                <>
                                                    <p className="font-bold text-slate-800">Cliente: {activeRequest.client_name_snapshot}</p>
                                                    <p className="mt-1">Solicitante: {getProfileLabel(requester)}</p>
                                                    <p className="mt-1">Estado préstamo: {REQUEST_STATUS_LABELS[activeRequest.status as KitLoanStatus]}</p>
                                                    {activeRequest.status === 'delivered' && (
                                                        <p className={`mt-2 font-black ${getRemainingTone(remainingDays)}`}>
                                                            {remainingDays !== null && remainingDays > 0
                                                                ? `${remainingDays} día(s) restantes`
                                                                : 'Préstamo vencido'}
                                                        </p>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <p className="font-bold text-slate-800">Sin préstamo activo</p>
                                                    <p className="mt-1 text-slate-500">Disponible para nuevas solicitudes del equipo.</p>
                                                </>
                                            )}
                                        </div>

                                        {kit.notes && (
                                            <p className="rounded-2xl bg-indigo-50/70 px-4 py-3 text-sm text-slate-600">{kit.notes}</p>
                                        )}

                                        <div className="mt-auto flex flex-wrap gap-2">
                                            {canRequestKitLoans && kit.status === 'available' && (
                                                <button
                                                    onClick={() => openCreateRequestModal(kit)}
                                                    className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-black text-white transition-all hover:bg-indigo-700"
                                                >
                                                    Solicitar préstamo
                                                </button>
                                            )}
                                            {canManageKitLoans && (kit.status === 'available' || kit.status === 'inactive') && (
                                                <>
                                                    <button
                                                        onClick={() => openCreateKitModal(kit)}
                                                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 transition-all hover:bg-slate-50"
                                                    >
                                                        Editar
                                                    </button>
                                                    <button
                                                        onClick={() => void handleToggleKitAvailability(kit)}
                                                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-800 transition-all hover:bg-slate-50"
                                                    >
                                                        {kit.status === 'inactive' ? 'Reactivar' : 'Desactivar'}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'requests' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr,1fr]">
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                value={requestSearch}
                                onChange={(event) => setRequestSearch(event.target.value)}
                                placeholder="Buscar por kit, cliente, dirección o vendedor..."
                                className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                        <select
                            value={requestStatusFilter}
                            onChange={(event) => setRequestStatusFilter(event.target.value as 'all' | KitLoanStatus)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300"
                        >
                            <option value="all">Todos los estados activos</option>
                            <option value="pending_dispatch">Pendientes despacho</option>
                            <option value="delivered">Entregados</option>
                        </select>
                    </div>

                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((index) => (
                                <div key={index} className="premium-card h-52 animate-pulse bg-slate-50" />
                            ))}
                        </div>
                    ) : filteredActiveRequests.length === 0 ? (
                        <div className="premium-card p-10 text-center">
                            <ClipboardList className="mx-auto mb-4 text-slate-300" size={36} />
                            <h3 className="text-xl font-black text-slate-900 mb-2">No hay solicitudes activas para los filtros actuales</h3>
                            <p className="text-slate-500 font-medium">Prueba cambiando el estado o el texto de búsqueda.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            {filteredActiveRequests.map((request) => {
                                const requester = profilesById.get(request.requester_id);
                                const deliveredBy = request.delivered_by ? profilesById.get(request.delivered_by) : null;
                                const remainingDays = getDaysRemaining(request);
                                return (
                                    <div key={request.id} className="premium-card space-y-4 p-6">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Kit {request.kit_number_snapshot}</p>
                                                <h3 className="mt-2 text-2xl font-black text-slate-900">{request.kit_name_snapshot}</h3>
                                                <p className="mt-2 text-sm font-medium text-slate-500">Cliente: {request.client_name_snapshot}</p>
                                            </div>
                                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${REQUEST_STATUS_STYLES[request.status as KitLoanStatus]}`}>
                                                {REQUEST_STATUS_LABELS[request.status as KitLoanStatus]}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm text-slate-600">
                                            <div className="rounded-2xl bg-slate-50 p-4">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Solicitante</p>
                                                <p className="mt-1 font-bold text-slate-800">{getProfileLabel(requester)}</p>
                                                <p className="mt-1 text-xs text-slate-400">{formatDateTime(request.requested_at)}</p>
                                            </div>
                                            <div className="rounded-2xl bg-slate-50 p-4">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Plazo</p>
                                                <p className="mt-1 font-bold text-slate-800">{request.requested_days} día(s)</p>
                                                <p className="mt-1 text-xs text-slate-400">Vence: {formatDate(request.due_at)}</p>
                                            </div>
                                            <div className="rounded-2xl bg-slate-50 p-4 md:col-span-2">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Dirección confirmada</p>
                                                <p className="mt-1 font-medium text-slate-700">{request.delivery_address_snapshot}</p>
                                                <p className="mt-1 text-xs text-slate-400">GPS {request.delivery_lat_snapshot.toFixed(5)}, {request.delivery_lng_snapshot.toFixed(5)}</p>
                                            </div>
                                        </div>

                                        <div className="rounded-2xl bg-indigo-50/60 p-4 text-sm text-slate-600">
                                            <p><span className="font-black text-slate-800">Nota comercial:</span> {request.request_note || 'Sin nota del solicitante.'}</p>
                                            {request.status === 'delivered' && (
                                                <>
                                                    <p className="mt-2"><span className="font-black text-slate-800">Entregado:</span> {formatDateTime(request.delivered_at)}</p>
                                                    <p className="mt-1"><span className="font-black text-slate-800">Despachado por:</span> {getProfileLabel(deliveredBy)}</p>
                                                    {request.delivery_note && <p className="mt-2"><span className="font-black text-slate-800">Nota de entrega:</span> {request.delivery_note}</p>}
                                                    <p className={`mt-2 font-black ${getRemainingTone(remainingDays)}`}>
                                                        {remainingDays !== null && remainingDays > 0
                                                            ? `${remainingDays} día(s) restantes de préstamo`
                                                            : 'Préstamo vencido'}
                                                    </p>
                                                </>
                                            )}
                                        </div>

                                        {canManageKitLoans && (
                                            <div className="flex flex-wrap gap-2">
                                                {request.status === 'pending_dispatch' && (
                                                    <>
                                                        <button
                                                            onClick={() => openRequestActionModal(request, 'deliver')}
                                                            className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-black text-white transition-all hover:bg-emerald-700"
                                                        >
                                                            Marcar entregado
                                                        </button>
                                                        <button
                                                            onClick={() => void handleCancelRequest(request)}
                                                            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-black text-rose-700 transition-all hover:bg-rose-100"
                                                        >
                                                            Cancelar solicitud
                                                        </button>
                                                    </>
                                                )}
                                                {request.status === 'delivered' && (
                                                    <button
                                                        onClick={() => openRequestActionModal(request, 'return')}
                                                        className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-700 transition-all hover:bg-indigo-100"
                                                    >
                                                        Marcar devuelto
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'map' && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px,1fr]">
                    <div className="space-y-4">
                        <div>
                            <h2 className="text-2xl font-black text-slate-900">Kits actualmente prestados</h2>
                            <p className="text-slate-500 font-medium">Mapa vivo a partir del GPS confirmado en la entrega al cliente.</p>
                        </div>
                        {deliveredLoans.length === 0 ? (
                            <div className="premium-card p-8 text-center">
                                <MapPin className="mx-auto mb-4 text-slate-300" size={36} />
                                <h3 className="text-xl font-black text-slate-900 mb-2">No hay kits prestados</h3>
                                <p className="text-slate-500 font-medium">Aparecerán aquí una vez que un admin o facturador marque una entrega.</p>
                            </div>
                        ) : (
                            deliveredLoans.map((request) => {
                                const requester = profilesById.get(request.requester_id);
                                const remainingDays = getDaysRemaining(request);
                                const isSelected = selectedMapRequestId === request.id;
                                return (
                                    <button
                                        key={request.id}
                                        onClick={() => setSelectedMapRequestId(request.id)}
                                        className={`w-full rounded-[2rem] border p-5 text-left transition-all ${isSelected ? 'border-indigo-300 bg-indigo-50 shadow-lg shadow-indigo-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Kit {request.kit_number_snapshot}</p>
                                                <p className="mt-2 text-xl font-black text-slate-900">{request.kit_name_snapshot}</p>
                                                <p className="mt-2 text-sm font-medium text-slate-600">{request.client_name_snapshot}</p>
                                            </div>
                                            <div className={`rounded-2xl px-3 py-2 text-xs font-black ${getRemainingTone(remainingDays)} bg-white`}>
                                                {remainingDays !== null && remainingDays > 0 ? `${remainingDays} d` : 'Vencido'}
                                            </div>
                                        </div>
                                        <p className="mt-3 text-sm text-slate-500">Vendedor: {getProfileLabel(requester)}</p>
                                        <p className="mt-1 text-sm text-slate-500">Entrega: {formatDate(request.delivered_at)}</p>
                                        <p className="mt-1 text-sm text-slate-500">Vence: {formatDate(request.due_at)}</p>
                                    </button>
                                );
                            })
                        )}
                    </div>

                    <div className="premium-card overflow-hidden p-0">
                        {GOOGLE_MAPS_API_KEY ? (
                            <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
                                <div className="h-[70vh] min-h-[520px] w-full overflow-hidden rounded-[2rem]">
                                    <Map
                                        mapId="KIT_LOANS_MAP"
                                        center={mapSelectedRequest ? { lat: Number(mapSelectedRequest.delivery_lat_snapshot), lng: Number(mapSelectedRequest.delivery_lng_snapshot) } : SANTIAGO_CENTER}
                                        defaultZoom={mapSelectedRequest ? 11 : 5}
                                        gestureHandling="greedy"
                                        disableDefaultUI={false}
                                    >
                                        {deliveredLoans.map((request) => {
                                            const remainingDays = getDaysRemaining(request);
                                            return (
                                                <AdvancedMarker
                                                    key={request.id}
                                                    position={{ lat: Number(request.delivery_lat_snapshot), lng: Number(request.delivery_lng_snapshot) }}
                                                    onClick={() => setSelectedMapRequestId(request.id)}
                                                >
                                                    <Pin background={getMarkerTone(remainingDays)} glyphColor="#ffffff" borderColor="#ffffff" />
                                                </AdvancedMarker>
                                            );
                                        })}

                                        {mapSelectedRequest && (
                                            <InfoWindow
                                                position={{ lat: Number(mapSelectedRequest.delivery_lat_snapshot), lng: Number(mapSelectedRequest.delivery_lng_snapshot) }}
                                                onCloseClick={() => setSelectedMapRequestId(null)}
                                            >
                                                <div className="max-w-xs p-1 text-sm text-slate-700">
                                                    <p className="font-black text-slate-900">{mapSelectedRequest.kit_name_snapshot} · {mapSelectedRequest.kit_number_snapshot}</p>
                                                    <p className="mt-1">Cliente: {mapSelectedRequest.client_name_snapshot}</p>
                                                    <p className="mt-1">Vendedor: {getProfileLabel(profilesById.get(mapSelectedRequest.requester_id))}</p>
                                                    <p className="mt-1">Entrega: {formatDate(mapSelectedRequest.delivered_at)}</p>
                                                    <p className="mt-1">Vence: {formatDate(mapSelectedRequest.due_at)}</p>
                                                    <p className={`mt-2 font-black ${getRemainingTone(getDaysRemaining(mapSelectedRequest))}`}>
                                                        {(getDaysRemaining(mapSelectedRequest) ?? 1) > 0
                                                            ? `${getDaysRemaining(mapSelectedRequest)} día(s) restantes`
                                                            : 'Préstamo vencido'}
                                                    </p>
                                                </div>
                                            </InfoWindow>
                                        )}
                                    </Map>
                                </div>
                            </APIProvider>
                        ) : (
                            <div className="flex h-[70vh] min-h-[520px] items-center justify-center p-8 text-center">
                                <div>
                                    <AlertTriangle className="mx-auto mb-4 text-amber-500" size={36} />
                                    <h3 className="text-xl font-black text-slate-900 mb-2">Falta Google Maps API Key</h3>
                                    <p className="text-slate-500 font-medium">El mapa de kits prestados requiere configurar VITE_GOOGLE_MAPS_API_KEY.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'history' && (
                <div className="space-y-6">
                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2].map((index) => (
                                <div key={index} className="premium-card h-44 animate-pulse bg-slate-50" />
                            ))}
                        </div>
                    ) : historyRequests.length === 0 ? (
                        <div className="premium-card p-10 text-center">
                            <ShieldCheck className="mx-auto mb-4 text-slate-300" size={36} />
                            <h3 className="text-xl font-black text-slate-900 mb-2">Aún no hay historial de kits</h3>
                            <p className="text-slate-500 font-medium">Aquí aparecerán los préstamos devueltos y las solicitudes canceladas.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            {historyRequests.map((request) => {
                                const requester = profilesById.get(request.requester_id);
                                const returnedBy = request.returned_by ? profilesById.get(request.returned_by) : null;
                                return (
                                    <div key={request.id} className="premium-card space-y-4 p-6">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Kit {request.kit_number_snapshot}</p>
                                                <h3 className="mt-2 text-2xl font-black text-slate-900">{request.kit_name_snapshot}</h3>
                                                <p className="mt-2 text-sm font-medium text-slate-600">Cliente: {request.client_name_snapshot}</p>
                                            </div>
                                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${REQUEST_STATUS_STYLES[request.status as KitLoanStatus]}`}>
                                                {REQUEST_STATUS_LABELS[request.status as KitLoanStatus]}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 text-sm text-slate-600">
                                            <div className="rounded-2xl bg-slate-50 p-4">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Solicitante</p>
                                                <p className="mt-1 font-bold text-slate-800">{getProfileLabel(requester)}</p>
                                                <p className="mt-1 text-xs text-slate-400">{formatDateTime(request.requested_at)}</p>
                                            </div>
                                            <div className="rounded-2xl bg-slate-50 p-4">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cierre</p>
                                                <p className="mt-1 font-bold text-slate-800">
                                                    {request.status === 'returned' ? formatDateTime(request.returned_at) : formatDateTime(request.cancelled_at)}
                                                </p>
                                                {request.status === 'returned' && (
                                                    <p className="mt-1 text-xs text-slate-400">Devuelto por {getProfileLabel(returnedBy)}</p>
                                                )}
                                            </div>
                                        </div>

                                        {request.return_note && (
                                            <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{request.return_note}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {showKitModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
                    <div className="absolute inset-0" onClick={() => setShowKitModal(false)} />
                    <div className="relative z-10 flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-[2.5rem] bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500 mb-2">{editingKit ? 'Editar' : 'Nuevo'}</p>
                                <h2 className="text-3xl font-black tracking-tight text-slate-900">{editingKit ? 'Editar kit' : 'Registrar kit prestable'}</h2>
                            </div>
                            <button onClick={() => setShowKitModal(false)} className="rounded-full bg-slate-100 p-3 text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveKit} className="flex min-h-0 flex-1 flex-col">
                            <div className="flex-1 space-y-6 overflow-y-auto px-8 py-8">
                                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                    <div>
                                        <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Nombre del kit</label>
                                        <input
                                            value={kitForm.kitName}
                                            onChange={(event) => setKitForm((current) => ({ ...current, kitName: event.target.value }))}
                                            placeholder="Ej. Kit Implante Premium"
                                            className="mt-3 w-full rounded-2xl border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Número del kit</label>
                                        <input
                                            value={kitForm.kitNumber}
                                            onChange={(event) => setKitForm((current) => ({ ...current, kitNumber: event.target.value }))}
                                            placeholder="Ej. KIT-014"
                                            className="mt-3 w-full rounded-2xl border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Nota interna</label>
                                    <textarea
                                        value={kitForm.notes}
                                        onChange={(event) => setKitForm((current) => ({ ...current, notes: event.target.value }))}
                                        rows={4}
                                        placeholder="Observaciones, composición clínica o cuidados del kit."
                                        className="mt-3 w-full rounded-[2rem] border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-8 py-6">
                                <button type="button" onClick={() => setShowKitModal(false)} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 font-black text-slate-700 transition-all hover:bg-slate-50">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={savingKit} className="rounded-2xl bg-indigo-600 px-6 py-3 font-black text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                                    {savingKit ? 'Guardando...' : editingKit ? 'Guardar cambios' : 'Crear kit'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showRequestModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
                    <div className="absolute inset-0" onClick={() => setShowRequestModal(false)} />
                    <div className="relative z-10 flex w-full max-w-5xl max-h-[92vh] flex-col overflow-hidden rounded-[2.5rem] bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500 mb-2">Nueva</p>
                                <h2 className="text-3xl font-black tracking-tight text-slate-900">Solicitud de préstamo de kit</h2>
                            </div>
                            <button onClick={() => setShowRequestModal(false)} className="rounded-full bg-slate-100 p-3 text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleSaveRequest} className="flex min-h-0 flex-1 flex-col">
                            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-[420px,1fr]">
                                <div className="space-y-6 overflow-y-auto border-b border-slate-100 px-8 py-8 xl:border-b-0 xl:border-r">
                                    <div>
                                        <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Kit disponible</label>
                                        <select
                                            value={requestForm.kitId}
                                            onChange={(event) => setRequestForm((current) => ({ ...current, kitId: event.target.value }))}
                                            className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 font-bold text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                        >
                                            <option value="">Selecciona un kit disponible</option>
                                            {kits.filter((kit) => kit.status === 'available' || kit.id === requestForm.kitId).map((kit) => (
                                                <option key={kit.id} value={kit.id}>{kit.kit_number} · {kit.kit_name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="relative">
                                        <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Cliente</label>
                                        <div className="relative mt-3">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                            <input
                                                value={requestForm.clientSearch}
                                                onChange={(event) => {
                                                    const value = event.target.value;
                                                    setRequestForm((current) => ({
                                                        ...current,
                                                        clientSearch: value,
                                                        clientId: value === current.clientSearch ? current.clientId : '',
                                                        deliveryAddress: value === current.clientSearch ? current.deliveryAddress : '',
                                                        lat: value === current.clientSearch ? current.lat : null,
                                                        lng: value === current.clientSearch ? current.lng : null
                                                    }));
                                                    setClientSuggestionsOpen(true);
                                                }}
                                                onFocus={() => setClientSuggestionsOpen(true)}
                                                placeholder="Busca cliente por nombre, RUT o dirección..."
                                                className="w-full rounded-2xl border border-slate-200 px-12 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                            />
                                            {clientSuggestionsOpen && filteredClients.length > 0 && (
                                                <div className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl">
                                                    {filteredClients.map((client) => (
                                                        <button
                                                            type="button"
                                                            key={client.id}
                                                            onClick={() => handleSelectClient(client)}
                                                            className="w-full rounded-2xl px-4 py-3 text-left transition-all hover:bg-slate-50"
                                                        >
                                                            <p className="font-black text-slate-900">{client.name}</p>
                                                            <p className="mt-1 text-xs text-slate-500">{[client.rut, client.address, client.comuna].filter(Boolean).join(' · ') || 'Sin dirección registrada'}</p>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                        <div>
                                            <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Días de préstamo</label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={requestForm.requestedDays}
                                                onChange={(event) => setRequestForm((current) => ({ ...current, requestedDays: Number(event.target.value) || 0 }))}
                                                className="mt-3 w-full rounded-2xl border border-slate-200 px-5 py-4 font-black text-slate-800 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                            />
                                        </div>
                                        <div className="rounded-[2rem] border border-slate-200 bg-slate-50 px-5 py-4">
                                            <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Estado GPS</p>
                                            <p className={`mt-3 text-sm font-black ${isValidCoordinates(requestForm.lat, requestForm.lng) ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                {isValidCoordinates(requestForm.lat, requestForm.lng) ? 'Ubicación confirmada' : 'Falta confirmar ubicación'}
                                            </p>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Dirección confirmada</label>
                                        <textarea
                                            value={requestForm.deliveryAddress}
                                            onChange={(event) => setRequestForm((current) => ({ ...current, deliveryAddress: event.target.value }))}
                                            rows={3}
                                            placeholder="Confirma la dirección exacta del préstamo"
                                            className="mt-3 w-full rounded-[2rem] border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Latitud</label>
                                            <input
                                                type="number"
                                                step="0.000001"
                                                value={requestForm.lat ?? ''}
                                                onChange={(event) => setRequestForm((current) => ({ ...current, lat: event.target.value === '' ? null : Number(event.target.value) }))}
                                                className="mt-3 w-full rounded-2xl border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Longitud</label>
                                            <input
                                                type="number"
                                                step="0.000001"
                                                value={requestForm.lng ?? ''}
                                                onChange={(event) => setRequestForm((current) => ({ ...current, lng: event.target.value === '' ? null : Number(event.target.value) }))}
                                                className="mt-3 w-full rounded-2xl border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-3">
                                        {selectedClient && isValidCoordinates(selectedClient.lat, selectedClient.lng) && (
                                            <button
                                                type="button"
                                                onClick={() => setRequestForm((current) => ({
                                                    ...current,
                                                    lat: selectedClient.lat,
                                                    lng: selectedClient.lng,
                                                    deliveryAddress: buildClientAddress(selectedClient)
                                                }))}
                                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-all hover:bg-slate-50"
                                            >
                                                Usar GPS del cliente
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => void handleUseCurrentGPS()}
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-all hover:bg-slate-50"
                                        >
                                            Usar GPS actual
                                        </button>
                                    </div>

                                    <div>
                                        <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Nota comercial</label>
                                        <textarea
                                            value={requestForm.requestNote}
                                            onChange={(event) => setRequestForm((current) => ({ ...current, requestNote: event.target.value }))}
                                            rows={4}
                                            placeholder="Explica el contexto clínico o comercial del préstamo."
                                            className="mt-3 w-full rounded-[2rem] border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                        />
                                    </div>
                                </div>

                                <div className="flex min-h-0 flex-col overflow-hidden px-8 py-8">
                                    <div className="mb-4 flex items-center justify-between gap-4">
                                        <div>
                                            <p className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">Confirmación GPS</p>
                                            <p className="mt-2 text-sm font-medium text-slate-500">Haz click en el mapa para ajustar el punto exacto del préstamo.</p>
                                        </div>
                                        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right text-xs font-black uppercase tracking-wide text-slate-400">
                                            <p>{requestForm.lat?.toFixed(5) || '--'}</p>
                                            <p>{requestForm.lng?.toFixed(5) || '--'}</p>
                                        </div>
                                    </div>
                                    <div className="min-h-[360px] flex-1 overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50">
                                        {GOOGLE_MAPS_API_KEY ? (
                                            <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
                                                <Map
                                                    mapId="KIT_LOAN_REQUEST_MAP"
                                                    center={isValidCoordinates(requestForm.lat, requestForm.lng)
                                                        ? { lat: Number(requestForm.lat), lng: Number(requestForm.lng) }
                                                        : SANTIAGO_CENTER}
                                                    defaultZoom={isValidCoordinates(requestForm.lat, requestForm.lng) ? 13 : 6}
                                                    gestureHandling="greedy"
                                                    onClick={(event) => {
                                                        if (!event.detail.latLng) return;
                                                        setRequestForm((current) => ({
                                                            ...current,
                                                            lat: event.detail.latLng?.lat ?? current.lat,
                                                            lng: event.detail.latLng?.lng ?? current.lng
                                                        }));
                                                    }}
                                                >
                                                    {isValidCoordinates(requestForm.lat, requestForm.lng) && (
                                                        <AdvancedMarker position={{ lat: Number(requestForm.lat), lng: Number(requestForm.lng) }}>
                                                            <Pin background="#6366f1" glyphColor="#ffffff" borderColor="#ffffff" />
                                                        </AdvancedMarker>
                                                    )}
                                                </Map>
                                            </APIProvider>
                                        ) : (
                                            <div className="flex h-full items-center justify-center p-8 text-center">
                                                <div>
                                                    <AlertTriangle className="mx-auto mb-4 text-amber-500" size={32} />
                                                    <p className="font-black text-slate-900">Google Maps no está disponible</p>
                                                    <p className="mt-2 text-sm text-slate-500">Aun así puedes ingresar latitud y longitud manualmente.</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-8 py-6">
                                <button type="button" onClick={() => setShowRequestModal(false)} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 font-black text-slate-700 transition-all hover:bg-slate-50">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={savingRequest} className="rounded-2xl bg-indigo-600 px-6 py-3 font-black text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                                    {savingRequest ? 'Creando...' : 'Crear solicitud'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {requestAction && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
                    <div className="absolute inset-0" onClick={() => setRequestAction(null)} />
                    <div className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-[2.5rem] bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-8 py-6">
                            <div>
                                <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500 mb-2">{requestAction.type === 'deliver' ? 'Entrega' : 'Devolución'}</p>
                                <h2 className="text-3xl font-black tracking-tight text-slate-900">
                                    {requestAction.type === 'deliver' ? 'Confirmar entrega de kit' : 'Confirmar devolución de kit'}
                                </h2>
                            </div>
                            <button onClick={() => setRequestAction(null)} className="rounded-full bg-slate-100 p-3 text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-700">
                                <X size={24} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmitRequestAction} className="space-y-6 px-8 py-8">
                            <div className="rounded-[2rem] bg-slate-50 p-5 text-sm text-slate-600">
                                <p className="font-black text-slate-900">{requestAction.request.kit_name_snapshot} · {requestAction.request.kit_number_snapshot}</p>
                                <p className="mt-2">Cliente: {requestAction.request.client_name_snapshot}</p>
                                <p className="mt-1">Dirección: {requestAction.request.delivery_address_snapshot}</p>
                            </div>
                            <div>
                                <label className="text-xs font-black uppercase tracking-[0.25em] text-slate-400">
                                    {requestAction.type === 'deliver' ? 'Nota de entrega' : 'Nota de devolución'}
                                </label>
                                <textarea
                                    value={actionNote}
                                    onChange={(event) => setActionNote(event.target.value)}
                                    rows={5}
                                    placeholder={requestAction.type === 'deliver' ? 'Observaciones de la entrega al cliente.' : 'Observaciones del retorno del kit.'}
                                    className="mt-3 w-full rounded-[2rem] border border-slate-200 px-5 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                />
                            </div>
                            <div className="flex items-center justify-end gap-3">
                                <button type="button" onClick={() => setRequestAction(null)} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 font-black text-slate-700 transition-all hover:bg-slate-50">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={processingAction} className="rounded-2xl bg-indigo-600 px-6 py-3 font-black text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                                    {processingAction
                                        ? 'Guardando...'
                                        : requestAction.type === 'deliver'
                                            ? 'Marcar entregado'
                                            : 'Marcar devuelto'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KitLoans;
