import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, Headset, Mail, Phone, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { useVisit } from '../contexts/VisitContext';
import VirtualVisitStartModal from '../components/modals/VirtualVisitStartModal';
import { isProspectStatus } from '../utils/prospect';
import { getVirtualChannelLabel, getVirtualOutcomeLabel, VIRTUAL_VISIT_TYPE } from '../utils/virtualVisits';

type ClientOption = {
    id: string;
    name: string;
    rut: string | null;
    phone: string | null;
    email: string | null;
    comuna: string | null;
    status: string | null;
};

type RecentVirtualVisit = {
    id: string;
    check_in_time: string;
    status: string | null;
    channel: string | null;
    outcome: string | null;
    client_id: string | null;
    client_name: string;
};

const MIN_SEARCH_LENGTH = 2;
const SEARCH_LIMIT = 20;

// PostgREST separa condiciones de .or() con comas y parentesis: se quitan del termino.
const sanitizeSearchTerm = (value: string) => value.replace(/[,()*%\\]/g, ' ').trim();

const VirtualVisit = () => {
    const navigate = useNavigate();
    const { profile, hasPermission } = useUser();
    const { activeVisit } = useVisit();
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [results, setResults] = useState<ClientOption[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);
    const [recentVisits, setRecentVisits] = useState<RecentVirtualVisit[]>([]);

    // Sin VIEW_ALL_CLIENTS cada vendedor busca solo en su propia cartera.
    const canSearchAllClients = hasPermission('VIEW_ALL_CLIENTS');

    useEffect(() => {
        const timeoutId = window.setTimeout(() => setDebouncedSearch(sanitizeSearchTerm(search)), 300);
        return () => window.clearTimeout(timeoutId);
    }, [search]);

    useEffect(() => {
        if (!profile?.id || debouncedSearch.length < MIN_SEARCH_LENGTH) {
            setResults([]);
            setSearchError(null);
            return;
        }

        let cancelled = false;
        const runSearch = async () => {
            setSearching(true);
            setSearchError(null);
            const pattern = `%${debouncedSearch}%`;
            let query = supabase
                .from('clients')
                .select('id, name, rut, phone, email, comuna, status')
                .or(`name.ilike.${pattern},rut.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
                .order('name', { ascending: true })
                .limit(SEARCH_LIMIT);

            if (!canSearchAllClients) {
                query = query.eq('created_by', profile.id);
            }

            const { data, error } = await query;
            if (cancelled) return;
            if (error) {
                console.error('Error searching clients for virtual visit:', error);
                setSearchError('No se pudo buscar clientes. Intenta nuevamente.');
                setResults([]);
            } else {
                setResults((data || []) as ClientOption[]);
            }
            setSearching(false);
        };

        void runSearch();
        return () => { cancelled = true; };
    }, [debouncedSearch, profile?.id, canSearchAllClients]);

    useEffect(() => {
        if (!profile?.id) return;

        let cancelled = false;
        const fetchRecent = async () => {
            const { data, error } = await supabase
                .from('visits')
                .select('id, check_in_time, status, channel, outcome, client_id, clients (name)')
                .eq('sales_rep_id', profile.id)
                .eq('type', VIRTUAL_VISIT_TYPE)
                .order('check_in_time', { ascending: false })
                .limit(10);

            if (cancelled) return;
            if (error) {
                console.error('Error fetching recent virtual visits:', error);
                return;
            }
            setRecentVisits((data || []).map((row: any) => {
                const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
                return {
                    id: row.id,
                    check_in_time: row.check_in_time,
                    status: row.status,
                    channel: row.channel,
                    outcome: row.outcome,
                    client_id: row.client_id,
                    client_name: client?.name || 'Cliente'
                };
            }));
        };

        void fetchRecent();
        return () => { cancelled = true; };
    }, [profile?.id, activeVisit?.id]);

    const showHint = debouncedSearch.length < MIN_SEARCH_LENGTH;

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10">
            <div className="text-center mb-8">
                <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-indigo-100 shadow-xl shadow-indigo-50">
                    <Headset size={32} />
                </div>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">Gestión Virtual</h1>
                <p className="text-gray-400 font-medium mt-2">Busca a tu cliente y registra una llamada, WhatsApp, videollamada o correo.</p>
            </div>

            {activeVisit && (
                <div className="max-w-xl mx-auto premium-card p-5 flex items-center justify-between gap-4 border border-amber-100 bg-amber-50/50">
                    <p className="text-sm font-bold text-amber-800">Tienes una visita o gestión en curso. Termínala antes de iniciar otra.</p>
                    <button
                        onClick={() => navigate(`/visit/${activeVisit.client_id}`)}
                        className="shrink-0 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-black uppercase tracking-wider hover:bg-amber-700 transition-all"
                    >
                        Ir a la gestión
                    </button>
                </div>
            )}

            <div className="max-w-xl mx-auto space-y-4">
                <div className="premium-card p-6 space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">
                        {canSearchAllClients ? 'Buscar cliente' : 'Buscar en mi cartera'}
                    </label>
                    <div className="relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={20} />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            autoFocus
                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-transparent rounded-2xl font-bold text-gray-900 focus:bg-white focus:ring-4 focus:ring-indigo-50 focus:border-indigo-100 outline-none transition-all placeholder:text-gray-300 placeholder:font-medium"
                            placeholder="Nombre, RUT, correo o teléfono"
                        />
                    </div>
                </div>

                <div className="premium-card overflow-hidden">
                    {showHint ? (
                        <p className="p-8 text-center text-sm font-bold text-gray-400">Escribe al menos {MIN_SEARCH_LENGTH} caracteres para buscar.</p>
                    ) : searching ? (
                        <p className="p-8 text-center text-sm font-bold text-gray-400">Buscando...</p>
                    ) : searchError ? (
                        <p className="p-8 text-center text-sm font-bold text-red-500">{searchError}</p>
                    ) : results.length === 0 ? (
                        <p className="p-8 text-center text-sm font-bold text-gray-400">
                            {canSearchAllClients ? 'No se encontraron clientes.' : 'No se encontraron clientes en tu cartera.'}
                        </p>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {results.map((client) => (
                                <li key={client.id}>
                                    <button
                                        onClick={() => setSelectedClient(client)}
                                        disabled={Boolean(activeVisit)}
                                        className="w-full p-5 flex items-center justify-between gap-4 text-left hover:bg-indigo-50/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${isProspectStatus(client.status) ? 'bg-amber-100 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                                <Building2 size={20} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-black text-gray-900 truncate">{client.name}</p>
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs font-bold text-gray-400">
                                                    {client.rut && <span>{client.rut}</span>}
                                                    {client.comuna && <span>{client.comuna}</span>}
                                                    {client.phone && <span className="flex items-center gap-1"><Phone size={11} /> {client.phone}</span>}
                                                    {client.email && <span className="flex items-center gap-1"><Mail size={11} /> {client.email}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={20} className="text-gray-300 shrink-0" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {recentVisits.length > 0 && (
                <div className="max-w-xl mx-auto space-y-3">
                    <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Mis últimas gestiones</h2>
                    <div className="premium-card overflow-hidden">
                        <ul className="divide-y divide-gray-100">
                            {recentVisits.map((visit) => (
                                <li key={visit.id} className="p-4 flex items-center justify-between gap-4">
                                    <div className="min-w-0">
                                        <p className="font-bold text-gray-900 truncate">{visit.client_name}</p>
                                        <p className="text-xs font-bold text-gray-400">
                                            {format(parseISO(visit.check_in_time), "dd MMM · HH:mm", { locale: es })} · {getVirtualChannelLabel(visit.channel)}
                                        </p>
                                    </div>
                                    <span className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${visit.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                        {visit.status === 'in_progress' ? 'En curso' : getVirtualOutcomeLabel(visit.outcome) || 'Finalizada'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {selectedClient && (
                <VirtualVisitStartModal
                    client={selectedClient}
                    isOpen
                    onClose={() => setSelectedClient(null)}
                />
            )}
        </div>
    );
};

export default VirtualVisit;
