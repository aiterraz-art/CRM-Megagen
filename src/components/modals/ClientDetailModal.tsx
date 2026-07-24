import { useState, useEffect, useMemo } from 'react';
import { X, MapPin, Phone, Mail, Building2, FileText, ShoppingBag, Clock, FileSpreadsheet, Pencil, CalendarRange, CheckCircle2, AlertTriangle, Send, MessageCircle } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { Database } from '../../types/supabase';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { useNavigate } from 'react-router-dom';
import CallOutcomeModal from './CallOutcomeModal';
import ScheduleVisitModal from './ScheduleVisitModal';
import ClientManagementModal from './ClientManagementModal';
import { useUser } from '../../contexts/UserContext';
import { googleService } from '../../services/googleService';
import {
    buildCollectionsDebtSnapshotFromRows,
    buildCollectionsRutVariants,
    normalizeCollectionsRut,
} from '../../utils/collectionsLinking';

type Client = Database['public']['Tables']['clients']['Row'];

const normalizeCollectionSellerEmail = (value: string | null | undefined) =>
    (value || '').trim().toLowerCase();

interface ClientDetailModalProps {
    client: Client;
    onClose: () => void;
    onEdit: () => void;
    onEmail: () => void;
}

type ClientDetailTab = 'overview' | 'history' | 'visits' | 'quotations' | 'sent_quotations' | 'orders' | 'collections' | 'emails' | 'calls' | 'messages';
type ClientHistoryKind = 'visit' | 'quotation' | 'order' | 'call' | 'email' | 'whatsapp';
type ClientHistoryItem = {
    id: string;
    kind: ClientHistoryKind;
    date: string;
    title: string;
    subtitle: string;
    actor?: string | null;
    status?: string | null;
    amount?: number | null;
};

type HistoryFetchResult = {
    items: ClientHistoryItem[];
    warnings: string[];
};

type ActorNameMap = Record<string, string>;

const formatCallStatusLabel = (status: string | null | undefined) => {
    switch (status) {
        case 'contestada':
            return 'Contestada';
        case 'no_contesto':
            return 'No contestó';
        case 'buzon':
            return 'Buzón';
        case 'ocupado':
            return 'Ocupado';
        case 'equivocado':
            return 'Número equivocado';
        default:
            return 'Sin estado';
    }
};

const formatQuotationStatusLabel = (status: string | null | undefined) => {
    switch (status) {
        case 'approved':
            return 'Aprobada';
        case 'sent':
            return 'Enviada';
        case 'rejected':
            return 'Rechazada';
        default:
            return 'Borrador';
    }
};

const getHistoryKindMeta = (kind: ClientHistoryKind) => {
    switch (kind) {
        case 'visit':
            return {
                label: 'Visita',
                icon: MapPin,
                iconClassName: 'bg-emerald-50 text-emerald-600',
                badgeClassName: 'bg-emerald-50 text-emerald-700'
            };
        case 'quotation':
            return {
                label: 'Cotización',
                icon: FileSpreadsheet,
                iconClassName: 'bg-blue-50 text-blue-600',
                badgeClassName: 'bg-blue-50 text-blue-700'
            };
        case 'order':
            return {
                label: 'Venta',
                icon: ShoppingBag,
                iconClassName: 'bg-purple-50 text-purple-600',
                badgeClassName: 'bg-purple-50 text-purple-700'
            };
        case 'call':
            return {
                label: 'Llamada',
                icon: Phone,
                iconClassName: 'bg-orange-50 text-orange-600',
                badgeClassName: 'bg-orange-50 text-orange-700'
            };
        case 'email':
            return {
                label: 'Correo',
                icon: Mail,
                iconClassName: 'bg-sky-50 text-sky-600',
                badgeClassName: 'bg-sky-50 text-sky-700'
            };
        case 'whatsapp':
            return {
                label: 'WhatsApp',
                icon: MessageCircle,
                iconClassName: 'bg-emerald-50 text-emerald-600',
                badgeClassName: 'bg-emerald-50 text-emerald-700'
            };
    }
};

const extractErrorMessage = (error: unknown) => {
    if (!error) return 'desconocido';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
        return (error as { message: string }).message;
    }
    return 'desconocido';
};

const ClientDetailModal = ({ client, onClose, onEdit, onEmail }: ClientDetailModalProps) => {
    const navigate = useNavigate();
    const { profile, effectiveRole } = useUser();
    const [activeTab, setActiveTab] = useState<ClientDetailTab>('overview');
    const [stats, setStats] = useState({
        totalVisits: 0,
        totalSales: 0,
        lastVisit: null as string | null,
        totalQuotations: 0,
        approvedQuotations: 0,
        totalCollectionsDocuments: 0,
        totalCollectionsOutstanding: 0,
        overdueCollectionsOutstanding: 0
    });
    const [visits, setVisits] = useState<any[]>([]);
    const [quotations, setQuotations] = useState<any[]>([]);
    const [orders, setOrders] = useState<any[]>([]);
    const [collections, setCollections] = useState<any[]>([]);
    const [emails, setEmails] = useState<any[]>([]);
    const [callLogs, setCallLogs] = useState<any[]>([]);
    const [messageLogs, setMessageLogs] = useState<any[]>([]);
    const [historyItems, setHistoryItems] = useState<ClientHistoryItem[]>([]);
    const [recentActivity, setRecentActivity] = useState<ClientHistoryItem[]>([]);
    const [sentQuotations, setSentQuotations] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [showCallOutcome, setShowCallOutcome] = useState(false);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showManagementModal, setShowManagementModal] = useState(false);

    const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    const clientRutVariants = buildCollectionsRutVariants(client.rut);
    const normalizedClientRut = normalizeCollectionsRut(client.rut);
    const mySellerEmail = normalizeCollectionSellerEmail(profile?.email);

    const canViewCollectionRow = (row: any) => {
        if (effectiveRole !== 'seller') return true;
        const sellerId = row?.seller_id || null;
        const sellerEmail = normalizeCollectionSellerEmail(row?.seller_email);
        return (profile?.id && sellerId === profile.id) || (mySellerEmail && sellerEmail === mySellerEmail);
    };

    useEffect(() => {
        fetchData();
    }, [client.id, activeTab]);

    const fetchActorNameMap = async (userIds: Array<string | null | undefined>) => {
        const uniqueUserIds = Array.from(new Set(userIds.filter((value): value is string => Boolean(value))));
        if (uniqueUserIds.length === 0) {
            return {} as ActorNameMap;
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', uniqueUserIds);

        if (error) throw error;

        return (data || []).reduce<ActorNameMap>((acc, profile) => {
            acc[profile.id] = profile.full_name || 'Usuario';
            return acc;
        }, {});
    };

    const fetchHistoryItems = async (limit?: number): Promise<HistoryFetchResult> => {
        let visitsQuery = supabase
            .from('visits')
            .select('id, title, purpose, notes, status, check_in_time, sales_rep_id')
            .eq('client_id', client.id)
            .order('check_in_time', { ascending: false });
        let quotationsQuery = supabase
            .from('quotations')
            .select('id, folio, status, total_amount, created_at, comments')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });
        let ordersQuery = supabase
            .from('orders')
            .select('id, folio, status, total_amount, created_at')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });
        let callsQuery = supabase
            .from('call_logs')
            .select('id, created_at, status, notes, user_id')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });
        let emailsQuery = supabase
            .from('email_logs')
            .select('id, created_at, subject, snippet, user_id')
            .eq('client_id', client.id)
            .order('created_at', { ascending: false });
        let messagesQuery = supabase
            .from('lead_message_logs')
            .select('id, created_at, destination, status, error_message, user_id')
            .eq('client_id', client.id)
            .eq('channel', 'whatsapp')
            .order('created_at', { ascending: false });

        if (limit) {
            visitsQuery = visitsQuery.limit(limit);
            quotationsQuery = quotationsQuery.limit(limit);
            ordersQuery = ordersQuery.limit(limit);
            callsQuery = callsQuery.limit(limit);
            emailsQuery = emailsQuery.limit(limit);
            messagesQuery = messagesQuery.limit(limit);
        }

        const [
            visitsResult,
            quotationsResult,
            ordersResult,
            callsResult,
            emailsResult,
            messagesResult
        ] = await Promise.all([
            visitsQuery,
            quotationsQuery,
            ordersQuery,
            callsQuery,
            emailsQuery,
            messagesQuery
        ]);

        const warnings = [
            visitsResult.error ? `Visitas: ${extractErrorMessage(visitsResult.error)}` : null,
            quotationsResult.error ? `Cotizaciones: ${extractErrorMessage(quotationsResult.error)}` : null,
            ordersResult.error ? `Ventas: ${extractErrorMessage(ordersResult.error)}` : null,
            callsResult.error ? `Llamadas: ${extractErrorMessage(callsResult.error)}` : null,
            emailsResult.error ? `Correos: ${extractErrorMessage(emailsResult.error)}` : null,
            messagesResult.error ? `WhatsApp: ${extractErrorMessage(messagesResult.error)}` : null
        ].filter((warning): warning is string => Boolean(warning));

        const visitsData = visitsResult.data || [];
        const quotationsData = quotationsResult.data || [];
        const ordersData = ordersResult.data || [];
        const callsData = callsResult.data || [];
        const emailsData = emailsResult.data || [];
        const messagesData = messagesResult.data || [];

        const actorNameMap = await fetchActorNameMap([
            ...visitsData.map((item: any) => item.sales_rep_id),
            ...callsData.map((item: any) => item.user_id),
            ...emailsData.map((item: any) => item.user_id),
            ...messagesData.map((item: any) => item.user_id)
        ]);

        const items = [
            ...(visitsData.map((item: any) => ({
                id: `visit-${item.id}`,
                kind: 'visit' as const,
                date: item.check_in_time,
                title: item.status === 'scheduled' ? 'Visita agendada' : item.status === 'cancelled' ? 'Visita cancelada' : 'Visita registrada',
                subtitle: item.title || item.purpose || item.notes || 'Sin detalle',
                actor: item.sales_rep_id ? actorNameMap[item.sales_rep_id] || 'Usuario' : null,
                status: item.status === 'scheduled' ? 'Agendada' : item.status === 'cancelled' ? 'Cancelada' : 'Completada'
            }))),
            ...(quotationsData.map((item: any) => ({
                id: `quotation-${item.id}`,
                kind: 'quotation' as const,
                date: item.created_at,
                title: `Cotización ${formatQuotationStatusLabel(item.status).toLowerCase()}`,
                subtitle: item.comments || `Folio #${item.folio || '---'}`,
                status: formatQuotationStatusLabel(item.status),
                amount: Number(item.total_amount || 0)
            }))),
            ...(ordersData.map((item: any) => ({
                id: `order-${item.id}`,
                kind: 'order' as const,
                date: item.created_at,
                title: `Pedido / venta ${item.folio ? `#${item.folio}` : 'registrada'}`,
                subtitle: item.status ? `Estado: ${String(item.status).replaceAll('_', ' ')}` : 'Venta confirmada',
                status: item.status ? String(item.status).replaceAll('_', ' ') : 'Registrada',
                amount: Number(item.total_amount || 0)
            }))),
            ...(callsData.map((item: any) => ({
                id: `call-${item.id}`,
                kind: 'call' as const,
                date: item.created_at,
                title: 'Llamada registrada',
                subtitle: item.notes || formatCallStatusLabel(item.status),
                actor: item.user_id ? actorNameMap[item.user_id] || 'Usuario' : null,
                status: formatCallStatusLabel(item.status)
            }))),
            ...(emailsData.map((item: any) => ({
                id: `email-${item.id}`,
                kind: 'email' as const,
                date: item.created_at,
                title: item.subject || 'Correo registrado',
                subtitle: item.snippet || 'Sin detalle',
                actor: item.user_id ? actorNameMap[item.user_id] || 'Usuario' : null,
                status: 'Enviado'
            }))),
            ...(messagesData.map((item: any) => ({
                id: `whatsapp-${item.id}`,
                kind: 'whatsapp' as const,
                date: item.created_at,
                title: 'WhatsApp registrado',
                subtitle: item.error_message || item.destination || 'Sin detalle',
                actor: item.user_id ? actorNameMap[item.user_id] || 'Usuario' : null,
                status: String(item.status || 'sent').replaceAll('_', ' ')
            })))
        ]
            .filter((item) => !!item.date)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, limit || Number.MAX_SAFE_INTEGER);

        return { items, warnings };
    };

    const fetchData = async () => {
        setLoading(true);
        setLoadError(null);
        try {
            if (activeTab === 'overview') {
                const collectionsPromise = clientRutVariants.length > 0
                    ? supabase.from('vw_collections_pending_current').select('*').in('client_rut', clientRutVariants).order('due_date', { ascending: true })
                    : Promise.resolve({ data: [], error: null } as any);

                const [
                    { count: visitsCount, error: visitsCountError },
                    { data: lastVisit, error: lastVisitError },
                    { data: salesData, error: salesError },
                    { data: quotesData, error: quotesError },
                    { data: collectionData, error: collectionsError },
                    historyResult
                ] = await Promise.all([
                    supabase.from('visits').select('*', { count: 'exact', head: true }).eq('client_id', client.id),
                    supabase.from('visits').select('check_in_time').eq('client_id', client.id).eq('status', 'completed').order('check_in_time', { ascending: false }).limit(1).maybeSingle(),
                    supabase.from('orders').select('total_amount').eq('client_id', client.id),
                    supabase.from('quotations').select('id, status, folio, total_amount, created_at, comments').eq('client_id', client.id).order('created_at', { ascending: false }),
                    collectionsPromise,
                    fetchHistoryItems(8)
                ]);

                const overviewWarnings = [
                    visitsCountError ? `Conteo de visitas: ${extractErrorMessage(visitsCountError)}` : null,
                    lastVisitError ? `Última visita: ${extractErrorMessage(lastVisitError)}` : null,
                    salesError ? `Ventas: ${extractErrorMessage(salesError)}` : null,
                    quotesError ? `Cotizaciones: ${extractErrorMessage(quotesError)}` : null,
                    collectionsError ? `Cobranzas: ${extractErrorMessage(collectionsError)}` : null,
                    ...historyResult.warnings
                ].filter((warning): warning is string => Boolean(warning));

                const totalSales = salesData?.reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0) || 0;
                const totalQuotations = quotesData?.length || 0;
                const approvedQuotations = (quotesData || []).filter((q) => q.status === 'approved').length;
                const sent = (quotesData || []).filter((q) => q.status === 'sent');
                const matchedCollections = (collectionData || []).filter((row: any) =>
                    normalizeCollectionsRut(row.client_rut) === normalizedClientRut && canViewCollectionRow(row)
                );
                const totalCollectionsOutstanding = matchedCollections.reduce((acc: number, row: any) => acc + Number(row.outstanding_amount || 0), 0);
                const overdueCollectionsOutstanding = matchedCollections
                    .filter((row: any) => Number(row.aging_days || 0) > 0)
                    .reduce((acc: number, row: any) => acc + Number(row.outstanding_amount || 0), 0);

                setStats({
                    totalVisits: visitsCount || 0,
                    totalSales,
                    lastVisit: lastVisit?.check_in_time || null,
                    totalQuotations,
                    approvedQuotations,
                    totalCollectionsDocuments: matchedCollections.length,
                    totalCollectionsOutstanding,
                    overdueCollectionsOutstanding
                });
                setSentQuotations(sent.slice(0, 6));
                setCollections(matchedCollections);
                setRecentActivity(historyResult.items);
                if (overviewWarnings.length > 0) {
                    setLoadError(`Parte de la ficha no se pudo cargar: ${overviewWarnings[0]}`);
                }
            } else if (activeTab === 'history') {
                const result = await fetchHistoryItems();
                setHistoryItems(result.items);
                if (result.warnings.length > 0) {
                    setLoadError(`Parte del historial no se pudo cargar: ${result.warnings[0]}`);
                }
            } else if (activeTab === 'visits') {
                const { data, error } = await supabase
                    .from('visits')
                    .select('*')
                    .eq('client_id', client.id)
                    .order('check_in_time', { ascending: false });
                if (error) throw error;

                const actorNameMap = await fetchActorNameMap((data || []).map((visit: any) => visit.sales_rep_id));
                setVisits((data || []).map((visit: any) => ({
                    ...visit,
                    profiles: {
                        full_name: visit.sales_rep_id ? actorNameMap[visit.sales_rep_id] || 'Usuario' : 'Usuario'
                    }
                })));
            } else if (activeTab === 'quotations') {
                const { data, error } = await supabase.from('quotations').select('*').eq('client_id', client.id).order('created_at', { ascending: false });
                if (error) throw error;
                setQuotations(data || []);
            } else if (activeTab === 'sent_quotations') {
                const { data, error } = await supabase
                    .from('quotations')
                    .select('id, status, folio, total_amount, created_at, comments')
                    .eq('client_id', client.id)
                    .eq('status', 'sent')
                    .order('created_at', { ascending: false });
                if (error) throw error;
                setSentQuotations(data || []);
            } else if (activeTab === 'orders') {
                const { data, error } = await supabase.from('orders').select('*, order_items(quantity, total_price, inventory(name))').eq('client_id', client.id).order('created_at', { ascending: false });
                if (error) throw error;
                setOrders(data || []);
            } else if (activeTab === 'collections') {
                if (clientRutVariants.length === 0) {
                    setCollections([]);
                } else {
                    const { data, error } = await supabase
                        .from('vw_collections_pending_current')
                        .select('*')
                        .in('client_rut', clientRutVariants)
                        .order('due_date', { ascending: true });
                    if (error) throw error;
                    setCollections((data || []).filter((row: any) =>
                        normalizeCollectionsRut(row.client_rut) === normalizedClientRut && canViewCollectionRow(row)
                    ));
                }
            } else if (activeTab === 'emails') {
                const { data, error } = await supabase
                    .from('email_logs')
                    .select('*')
                    .eq('client_id', client.id)
                    .order('created_at', { ascending: false });
                if (error) throw error;

                const actorNameMap = await fetchActorNameMap((data || []).map((email: any) => email.user_id));
                setEmails((data || []).map((email: any) => ({
                    ...email,
                    profiles: {
                        full_name: email.user_id ? actorNameMap[email.user_id] || 'Usuario' : 'Usuario'
                    }
                })));
            } else if (activeTab === 'calls') {
                const { data, error } = await supabase
                    .from('call_logs')
                    .select('*')
                    .eq('client_id', client.id)
                    .order('created_at', { ascending: false });
                if (error) throw error;

                const actorNameMap = await fetchActorNameMap((data || []).map((log: any) => log.user_id));
                setCallLogs((data || []).map((log: any) => ({
                    ...log,
                    profiles: {
                        full_name: log.user_id ? actorNameMap[log.user_id] || 'Usuario' : 'Usuario'
                    }
                })));
            } else if (activeTab === 'messages') {
                const { data, error } = await supabase
                    .from('lead_message_logs')
                    .select('*')
                    .eq('client_id', client.id)
                    .eq('channel', 'whatsapp')
                    .order('created_at', { ascending: false });
                if (error) throw error;

                const actorNameMap = await fetchActorNameMap((data || []).map((message: any) => message.user_id));
                setMessageLogs((data || []).map((message: any) => ({
                    ...message,
                    profiles: {
                        full_name: message.user_id ? actorNameMap[message.user_id] || 'Usuario' : 'Usuario'
                    }
                })));
            }
        } catch (error) {
            console.error("Error fetching client details:", error);
            setLoadError(`No se pudo cargar la información de esta ficha. Detalle: ${extractErrorMessage(error)}`);
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (iso: string) => iso ? new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
    const formatDateTime = (iso: string) => iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'N/A';
    const formatCurrency = (amount: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(amount);
    const lastVisitAgeDays = stats.lastVisit ? Math.floor((Date.now() - new Date(stats.lastVisit).getTime()) / (1000 * 60 * 60 * 24)) : null;
    const collectionsSnapshot = useMemo(() => buildCollectionsDebtSnapshotFromRows(collections), [collections]);

    const handleVisit = () => navigate(`/visit/${client.id}`);
    const handleQuote = () => navigate('/quotations', { state: { client: client } });

    const handleCall = async () => {
        window.location.href = `tel:${client.phone}`;
        setTimeout(() => setShowCallOutcome(true), 1500);
    };

    const recommendation = (() => {
        if (!client.phone && !client.email) {
            return {
                title: 'Completar datos de contacto',
                reason: 'El cliente no tiene teléfono ni correo registrados.',
                actionLabel: 'Editar ficha',
                action: onEdit
            };
        }
        if (stats.totalVisits === 0) {
            return {
                title: 'Agendar primera visita',
                reason: 'Aún no hay visitas registradas para este cliente.',
                actionLabel: 'Agendar ahora',
                action: () => setShowScheduleModal(true)
            };
        }
        if (sentQuotations.length > 0 && stats.approvedQuotations === 0) {
            return {
                title: 'Hacer seguimiento de cotización enviada',
                reason: `Hay ${sentQuotations.length} cotización(es) enviada(s) sin aprobación.`,
                actionLabel: 'Ir a cotizaciones',
                action: () => navigate('/quotations', { state: { client } })
            };
        }
        if (lastVisitAgeDays !== null && lastVisitAgeDays >= 15) {
            return {
                title: 'Registrar visita de seguimiento',
                reason: `La última visita fue hace ${lastVisitAgeDays} días.`,
                actionLabel: 'Registrar visita',
                action: () => navigate(`/visit/${client.id}`)
            };
        }
        return {
            title: 'Mantener ritmo comercial',
            reason: 'Cliente con actividad reciente. Recomendada llamada de control.',
            actionLabel: 'Registrar llamada',
            action: handleCall
        };
    })();

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full max-w-5xl h-[100dvh] sm:h-[90vh] rounded-none sm:rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 flex flex-col">
                {/* Header */}
                <div className="bg-gray-900 text-white px-4 pb-4 pt-5 sm:p-8 shrink-0 relative overflow-hidden">
                    <div className="absolute right-4 top-4 sm:right-8 sm:top-8 flex gap-2 z-10">
                        <button onClick={onEdit} className="p-2.5 sm:p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-all backdrop-blur-md" title="Editar"><Pencil size={18} className="sm:w-5 sm:h-5" /></button>
                        <button onClick={onClose} className="p-2.5 sm:p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-all backdrop-blur-md"><X size={18} className="sm:w-5 sm:h-5" /></button>
                    </div>
                    <div className="flex flex-col gap-5 sm:gap-6 relative z-0">
                        <div className="flex items-start gap-4 sm:gap-6 pr-24 sm:pr-28">
                            <div className="w-16 h-16 sm:w-24 sm:h-24 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[1.5rem] sm:rounded-3xl flex items-center justify-center shadow-2xl border-4 border-gray-800 shrink-0">
                                <Building2 size={30} className="text-white sm:w-10 sm:h-10" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight break-words">{client.name}</h2>
                                <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-3 text-gray-400 font-medium text-xs sm:text-sm">
                                    <span className="flex items-center gap-1.5 bg-gray-800 px-3 py-1 rounded-lg border border-gray-700">
                                        <FileSpreadsheet size={14} className="text-indigo-400" /> {client.rut || 'Sin RUT'}
                                    </span>
                                    <span className="flex items-center gap-1.5 bg-gray-800 px-3 py-1 rounded-lg border border-gray-700">
                                        <MapPin size={14} className="text-emerald-400" /> {client.comuna || 'Santiago'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3 w-full">
                            <button onClick={() => setShowScheduleModal(true)} className="min-w-0 flex items-center justify-center gap-2 px-3 sm:px-5 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-sm sm:text-base transition-all shadow-lg shadow-purple-900/50 active:scale-95">
                                <CalendarRange size={18} /> Agendar
                            </button>
                            <button onClick={handleVisit} className="min-w-0 flex items-center justify-center gap-2 px-3 sm:px-5 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm sm:text-base transition-all shadow-lg shadow-indigo-900/50 active:scale-95">
                                <MapPin size={18} /> Visita
                            </button>
                            <button onClick={() => setShowManagementModal(true)} className="min-w-0 flex items-center justify-center gap-2 px-3 sm:px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm sm:text-base transition-all shadow-lg shadow-emerald-900/30 active:scale-95">
                                <MessageCircle size={18} /> Gestión
                            </button>
                            <button onClick={handleQuote} className="min-w-0 flex items-center justify-center gap-2 px-3 sm:px-5 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold text-sm sm:text-base transition-all border border-gray-700 active:scale-95">
                                <FileText size={18} /> Cotizar
                            </button>
                            <button onClick={handleCall} className="min-w-0 flex items-center justify-center gap-2 px-3 sm:px-5 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold text-sm sm:text-base transition-all border border-gray-700 active:scale-95">
                                <Phone size={18} /> Llamar
                            </button>
                            <button onClick={onEmail} className="min-w-0 flex items-center justify-center gap-2 px-3 sm:px-5 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-bold text-sm sm:text-base transition-all border border-gray-700 active:scale-95">
                                <Mail size={18} /> Email
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 px-2 sm:px-8 shrink-0 overflow-x-auto bg-white sticky top-0 z-10">
                    {[
                        { id: 'overview', label: 'Resumen', icon: FileText },
                        { id: 'history', label: 'Historial', icon: Clock },
                        { id: 'visits', label: 'Actividad', icon: MapPin },
                        { id: 'quotations', label: 'Comercial', icon: FileSpreadsheet },
                        { id: 'sent_quotations', label: 'Enviadas', icon: Send },
                        { id: 'orders', label: 'Ventas', icon: ShoppingBag },
                        { id: 'collections', label: 'Cobranzas', icon: AlertTriangle },
                        { id: 'calls', label: 'Llamadas', icon: Phone },
                        { id: 'messages', label: 'WhatsApp', icon: MessageCircle },
                        { id: 'emails', label: 'Correos', icon: Mail },
                    ].map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex items-center gap-2 px-3 sm:px-6 py-4 sm:py-5 text-xs sm:text-sm font-bold border-b-4 transition-all whitespace-nowrap min-w-max ${activeTab === tab.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'}`}>
                            <tab.icon size={16} /> {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto bg-gray-50/50 p-4 sm:p-8">
                    {loadError && (
                        <div className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-medium">
                            {loadError}
                        </div>
                    )}
                    {loading ? (
                        <div className="space-y-4 animate-pulse">{[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-200 rounded-2xl"></div>)}</div>
                    ) : (
                        <>
                            {activeTab === 'overview' && (
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8">
                                    <div className="lg:col-span-2 space-y-8">
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Ventas Totales</p>
                                                <p className="text-xl sm:text-2xl font-black text-gray-900 mt-1 break-words">{formatCurrency(stats.totalSales)}</p>
                                            </div>
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Visitas</p>
                                                <p className="text-xl sm:text-2xl font-black text-gray-900 mt-1">{stats.totalVisits}</p>
                                            </div>
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Última Visita</p>
                                                <p className="text-lg sm:text-xl font-black text-gray-900 mt-1">{formatDate(stats.lastVisit || '')}</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Cotizaciones</p>
                                                <p className="text-xl sm:text-2xl font-black text-gray-900 mt-1">{stats.totalQuotations}</p>
                                            </div>
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Aprobadas</p>
                                                <p className="text-xl sm:text-2xl font-black text-emerald-600 mt-1">{stats.approvedQuotations}</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Docs en Cobranza</p>
                                                <p className="text-xl sm:text-2xl font-black text-gray-900 mt-1">{stats.totalCollectionsDocuments}</p>
                                            </div>
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Saldo Pendiente</p>
                                                <p className="text-xl sm:text-2xl font-black text-amber-600 mt-1 break-words">{formatCurrency(stats.totalCollectionsOutstanding)}</p>
                                            </div>
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm">
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Saldo Vencido</p>
                                                <p className="text-xl sm:text-2xl font-black text-red-600 mt-1 break-words">{formatCurrency(stats.overdueCollectionsOutstanding)}</p>
                                            </div>
                                        </div>
                                        {collectionsSnapshot.documents > 0 && (
                                            <div className={`rounded-3xl border p-6 shadow-sm ${collectionsSnapshot.overdue_documents > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}>
                                                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                                                    <div>
                                                        <h3 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                                                            <AlertTriangle size={18} className={collectionsSnapshot.overdue_documents > 0 ? 'text-amber-600' : 'text-indigo-600'} />
                                                            Estado de cobranzas
                                                        </h3>
                                                        {collectionsSnapshot.overdue_documents > 0 ? (
                                                            <p className="text-sm font-medium text-amber-800">
                                                                Cliente con {collectionsSnapshot.overdue_documents} factura(s) vencida(s) por {formatCurrency(collectionsSnapshot.overdue_total)}.
                                                            </p>
                                                        ) : (
                                                            <p className="text-sm font-medium text-gray-600">
                                                                Cliente con documentos pendientes, pero sin deuda vencida.
                                                            </p>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => setActiveTab('collections')}
                                                        className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-gray-800 transition-colors"
                                                    >
                                                        Ver cobranzas completas
                                                    </button>
                                                </div>
                                                <div className="mt-4 space-y-2">
                                                    {collectionsSnapshot.invoices.slice(0, 5).map((invoice) => (
                                                        <div key={invoice.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 border border-white px-4 py-3">
                                                            <div>
                                                                <p className="font-bold text-gray-900">{invoice.document_number || 'Sin documento'}</p>
                                                                <p className="text-xs text-gray-500">
                                                                    Vence {formatDate(invoice.due_date || '')}
                                                                </p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="font-black text-gray-900">{formatCurrency(invoice.outstanding_amount)}</p>
                                                                <p className={`text-xs font-bold ${invoice.aging_days > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                                                    {invoice.aging_days > 0 ? `${invoice.aging_days} días de mora` : 'Pendiente'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <div className="bg-white p-5 sm:p-8 rounded-3xl border border-gray-100 shadow-sm">
                                            <h3 className="font-bold text-gray-900 mb-4 sm:mb-6 flex items-center gap-2"><FileText size={20} className="text-indigo-600" /> Información de Contacto</h3>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-5 sm:gap-y-6 gap-x-8">
                                                <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Dirección</label><p className="font-medium text-gray-700">{client.address}{client.office ? `, Oficina ${client.office}` : ''}</p></div>
                                                <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Teléfono</label><a href={`tel:${client.phone}`} className="font-bold text-indigo-600 hover:underline">{client.phone}</a></div>
                                                <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Email</label><a href={`mailto:${client.email}`} className="font-bold text-indigo-600 hover:underline">{client.email}</a></div>
                                                <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Giro</label><p className="font-medium text-gray-700">{client.giro || '---'}</p></div>
                                                <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Días de Crédito</label><p className="font-medium text-gray-700">{client.credit_days || 0} días</p></div>
                                                <div className="col-span-1 md:col-span-2"><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Notas</label><p className="font-medium text-gray-600 bg-gray-50 p-4 rounded-xl border border-gray-200/50 italic">{client.notes || 'Sin notas registradas.'}</p></div>
                                            </div>
                                        </div>
                                        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm">
                                            <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                                                <CheckCircle2 size={18} className="text-indigo-600" /> Próxima Acción Recomendada
                                            </h3>
                                            <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100">
                                                <p className="font-black text-indigo-900">{recommendation.title}</p>
                                                <p className="text-sm text-indigo-700 mt-1">{recommendation.reason}</p>
                                                <button
                                                    onClick={recommendation.action}
                                                    className="mt-3 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
                                                >
                                                    {recommendation.actionLabel}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm">
                                            <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                                                    <Clock size={18} className="text-indigo-600" /> Actividad Reciente
                                                </h3>
                                                <button
                                                    onClick={() => setActiveTab('history')}
                                                    className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-200"
                                                >
                                                    Ver historial completo
                                                </button>
                                            </div>
                                            <div className="space-y-3">
                                                {recentActivity.map((activity) => (
                                                    <div key={activity.id} className="p-3 rounded-xl border border-gray-100 bg-gray-50/60">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <p className="text-sm font-bold text-gray-900">{activity.title}</p>
                                                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${getHistoryKindMeta(activity.kind).badgeClassName}`}>
                                                                {getHistoryKindMeta(activity.kind).label}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-gray-600 mt-1">{activity.subtitle}</p>
                                                        {activity.actor && (
                                                            <p className="text-[11px] text-gray-500 mt-1">Por {activity.actor}</p>
                                                        )}
                                                        <p className="text-[11px] text-gray-400 mt-1">{formatDateTime(activity.date)}</p>
                                                    </div>
                                                ))}
                                                {recentActivity.length === 0 && (
                                                    <div className="p-6 text-center text-sm text-gray-500 bg-gray-50 rounded-xl border border-gray-100">
                                                        Sin actividad reciente registrada.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="h-[240px] sm:h-full min-h-[240px] sm:min-h-[300px] rounded-3xl overflow-hidden shadow-lg border-2 border-white">
                                        {client.lat && client.lng && GOOGLE_MAPS_API_KEY ? (
                                            <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
                                                <Map defaultCenter={{ lat: client.lat, lng: client.lng }} defaultZoom={15} mapId="CLIENT_DETAIL_MAP" className="w-full h-full">
                                                    <AdvancedMarker position={{ lat: client.lat, lng: client.lng }}><Pin background={'#4F46E5'} borderColor={'#312E81'} glyphColor={'#FFF'} /></AdvancedMarker>
                                                </Map>
                                            </APIProvider>
                                        ) : (
                                            <div className="w-full h-full bg-gray-200 flex flex-col items-center justify-center text-gray-500 font-bold gap-2">
                                                <AlertTriangle size={18} />
                                                Sin ubicación GPS
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab !== 'overview' && (
                                <div className="bg-white rounded-[2rem] sm:rounded-[2.5rem] shadow-sm border border-gray-100 overflow-hidden">
                                    {activeTab === 'history' && historyItems.map((item) => {
                                        const meta = getHistoryKindMeta(item.kind);
                                        const Icon = meta.icon;
                                        return (
                                            <div key={item.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                                    <div className="flex items-start gap-4 min-w-0">
                                                        <div className={`mt-1 flex h-12 w-12 items-center justify-center rounded-2xl ${meta.iconClassName}`}>
                                                            <Icon size={20} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <p className="font-bold text-gray-900 break-words">{item.title}</p>
                                                                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${meta.badgeClassName}`}>
                                                                    {meta.label}
                                                                </span>
                                                                {item.status && (
                                                                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-gray-600">
                                                                        {item.status}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="mt-1 text-sm text-gray-600">{item.subtitle}</p>
                                                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-medium text-gray-500">
                                                                <span>{formatDateTime(item.date)}</span>
                                                                {item.actor && <span>Por {item.actor}</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {item.amount !== null && item.amount !== undefined && (
                                                        <p className="text-left sm:text-right font-black text-gray-900">{formatCurrency(item.amount)}</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {activeTab === 'visits' && visits.map((visit) => (
                                        <div key={visit.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 group">
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold ${visit.status === 'scheduled' ? 'bg-purple-50 text-purple-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                                    {visit.status === 'scheduled' ? <CalendarRange size={20} /> : <MapPin size={20} />}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-900">{visit.title || visit.purpose || 'Visita Regular'}</p>
                                                    <p className="text-xs text-gray-500 font-medium flex items-center gap-1"><Clock size={10} /> {formatDateTime(visit.check_in_time)} por {visit.profiles?.full_name}</p>
                                                    {visit.status === 'scheduled' && <p className="text-[10px] text-purple-600 font-bold bg-purple-50 inline-block px-2 py-0.5 rounded mt-1">PROGRAMADA</p>}
                                                    {visit.notes && (
                                                        <div className="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
                                                            <p className="text-xs text-gray-600 italic">"{visit.notes}"</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 self-start sm:self-auto">
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${visit.status === 'scheduled' ? 'bg-purple-100 text-purple-700' : visit.status === 'cancelled' ? 'bg-red-100 text-red-700' : visit.check_out_time ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700 animate-pulse'}`}>
                                                    {visit.status === 'scheduled' ? 'Agendada' : visit.status === 'cancelled' ? 'Cancelada' : visit.check_out_time ? 'Completada' : 'En Curso'}
                                                </span>
                                                {visit.status === 'scheduled' && (
                                                    <button
                                                        onClick={async () => {
                                                            if (!confirm('¿Estás seguro de cancelar esta visita? Se eliminará también de Google Calendar.')) return;
                                                            setLoading(true);
                                                            try {
                                                                // 1. Delete from Google if ID exists
                                                                if (visit.google_event_id) {
                                                                    await googleService.fetchGoogle(
                                                                        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(visit.google_event_id)}`,
                                                                        { method: 'DELETE' }
                                                                    );
                                                                }
                                                                // 2. Mark as Cancelled in Supabase
                                                                await supabase.from('visits').update({ status: 'cancelled' }).eq('id', visit.id);
                                                                fetchData();
                                                                alert('Visita cancelada correctamente.');
                                                            } catch (err) {
                                                                console.error("Error cancelling visit:", err);
                                                                alert("Error al cancelar visita.");
                                                            } finally {
                                                                setLoading(false);
                                                            }
                                                        }}
                                                        className="p-1 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-full transition-colors"
                                                        title="Cancelar Visita"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {activeTab === 'quotations' && quotations.map((q) => (
                                        <div key={q.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-bold"><FileSpreadsheet size={20} /></div>
                                                <div><p className="font-bold text-gray-900">Folio #{q.folio || '---'}</p><p className="text-xs text-gray-500 font-medium">{formatDate(q.created_at)} • {formatCurrency(q.total_amount || 0)}</p></div>
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${q.status === 'approved' ? 'bg-green-100 text-green-700' : q.status === 'sent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{q.status === 'approved' ? 'Aprobada' : q.status === 'sent' ? 'Enviada' : 'Borrador'}</span>
                                        </div>
                                    ))}
                                    {activeTab === 'orders' && orders.map((o) => (
                                        <div key={o.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center font-bold"><ShoppingBag size={20} /></div>
                                                <div><p className="font-bold text-gray-900">Venta Confirmada</p><p className="text-xs text-gray-500 font-medium">{formatDateTime(o.created_at)}</p>{o.order_items && o.order_items.length > 0 && (<div className="mt-1 text-xs text-gray-400">{o.order_items.map((item: any) => `${item.inventory?.name || 'Producto'} (x${item.quantity})`).join(', ')}</div>)}</div>
                                            </div>
                                            <p className="font-black text-gray-900">{formatCurrency(o.total_amount)}</p>
                                        </div>
                                    ))}
                                    {activeTab === 'collections' && collections.map((item) => (
                                        <div key={item.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="font-bold text-gray-900">Documento #{item.document_number}</p>
                                                        <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-amber-100 text-amber-700">
                                                            {item.document_type || 'Documento'}
                                                        </span>
                                                        {Number(item.aging_days || 0) > 0 && (
                                                            <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-red-100 text-red-700">
                                                                {item.aging_days} día(s) vencido
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-gray-500 font-medium mt-1">
                                                        Vence: {formatDate(item.due_date)} • Vendedor: {item.seller_name || item.seller_email || 'Sin asignar'}
                                                    </p>
                                                    {item.seller_comment && (
                                                        <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Descargo del vendedor</p>
                                                            <p className="text-sm text-gray-700 mt-1">{item.seller_comment}</p>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="text-left sm:text-right">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Saldo pendiente</p>
                                                    <p className="font-black text-xl text-amber-700">{formatCurrency(Number(item.outstanding_amount || item.amount || 0))}</p>
                                                    <p className="text-xs text-gray-500 mt-1">Monto documento: {formatCurrency(Number(item.amount || 0))}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {activeTab === 'sent_quotations' && sentQuotations.map((quote) => (
                                        <div key={quote.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-bold text-gray-900">Folio #{quote.folio || '---'}</p>
                                                    <p className="text-xs text-gray-500 font-medium">{formatDateTime(quote.created_at)}</p>
                                                    {quote.comments && <p className="text-xs text-gray-600 mt-2 italic">"{quote.comments}"</p>}
                                                </div>
                                                <div className="text-left sm:text-right">
                                                    <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-blue-100 text-blue-700">Enviada</span>
                                                    <p className="font-black text-gray-900 mt-2">{formatCurrency(Number(quote.total_amount || 0))}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {activeTab === 'emails' && emails.map((email) => (
                                        <div key={email.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 mb-1"><h4 className="font-bold text-gray-900 text-sm break-words">{email.subject}</h4><span className="text-[10px] text-gray-400 font-bold uppercase">{formatDateTime(email.created_at)}</span></div>
                                            <p className="text-xs text-gray-500 line-clamp-2">{email.snippet || 'Sin vista previa'}</p>
                                            <div className="mt-2 flex items-center gap-2"><span className="text-[10px] font-medium bg-gray-100 px-2 py-0.5 rounded text-gray-500">Por: {email.profiles?.full_name || 'Usuario'}</span></div>
                                        </div>
                                    ))}
                                    {activeTab === 'messages' && messageLogs.map((message) => (
                                        <div key={message.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 mb-1">
                                                <h4 className="font-bold text-gray-900 text-sm">WhatsApp {message.status === 'failed' ? 'fallido' : 'registrado'}</h4>
                                                <span className="text-[10px] text-gray-400 font-bold uppercase">{formatDateTime(message.created_at)}</span>
                                            </div>
                                            <p className="text-xs text-gray-500">{message.destination || 'Sin destino registrado'}</p>
                                            {message.error_message && (
                                                <p className="text-xs text-gray-600 mt-2 italic">"{message.error_message}"</p>
                                            )}
                                            <div className="mt-2 flex items-center gap-2">
                                                <span className="text-[10px] font-medium bg-gray-100 px-2 py-0.5 rounded text-gray-500">Por: {message.profiles?.full_name || 'Usuario'}</span>
                                                <span className="text-[10px] font-medium bg-emerald-50 px-2 py-0.5 rounded text-emerald-700 uppercase">{String(message.status || 'sent').replace('_', ' ')}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {activeTab === 'calls' && callLogs.map((log) => (
                                        <div key={log.id} className="p-4 sm:p-6 border-b border-gray-100 hover:bg-gray-50 transition-colors flex justify-between items-start">
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold ${log.status === 'contestada' ? 'bg-green-50 text-green-600' : log.status === 'no_contesto' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'}`}><Phone size={20} /></div>
                                                <div>
                                                    <p className="font-bold text-gray-900 capitalize">{log.status.replace('_', ' ')}</p>
                                                    <p className="text-xs text-gray-500 font-medium">{formatDateTime(log.created_at)} • {log.profiles?.full_name || 'Usuario'}</p>
                                                    {log.notes && <p className="text-sm text-gray-600 mt-1 italic">"{log.notes}"</p>}
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Empty States */}
                                    {activeTab === 'history' && historyItems.length === 0 && <EmptyState message="No hay gestiones ni movimientos registrados" />}
                                    {activeTab === 'visits' && visits.length === 0 && <EmptyState message="No hay actividad de visitas" />}
                                    {activeTab === 'quotations' && quotations.length === 0 && <EmptyState message="No hay actividad comercial" />}
                                    {activeTab === 'sent_quotations' && sentQuotations.length === 0 && <EmptyState message="No hay cotizaciones enviadas" />}
                                    {activeTab === 'orders' && orders.length === 0 && <EmptyState message="No hay ventas registradas" />}
                                    {activeTab === 'collections' && collections.length === 0 && <EmptyState message={client.rut ? "No hay cobranzas pendientes para este cliente" : "El cliente no tiene RUT para vincular cobranzas"} />}
                                    {activeTab === 'emails' && emails.length === 0 && <EmptyState message="No hay correos registrados" />}
                                    {activeTab === 'messages' && messageLogs.length === 0 && <EmptyState message="No hay WhatsApp registrados" />}
                                    {activeTab === 'calls' && callLogs.length === 0 && <EmptyState message="No hay llamadas registradas" />}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <CallOutcomeModal
                client={client}
                isOpen={showCallOutcome}
                onClose={() => setShowCallOutcome(false)}
                onSaved={() => {
                    if (activeTab === 'calls' || activeTab === 'overview' || activeTab === 'history') fetchData();
                }}
            />

            <ScheduleVisitModal
                client={client}
                isOpen={showScheduleModal}
                onClose={() => setShowScheduleModal(false)}
                onSaved={() => {
                    if (activeTab === 'visits' || activeTab === 'overview' || activeTab === 'history') fetchData();
                }}
            />

            <ClientManagementModal
                client={client}
                isOpen={showManagementModal}
                onClose={() => setShowManagementModal(false)}
                onSaved={() => {
                    fetchData();
                }}
            />
        </div>
    );
};

const EmptyState = ({ message }: { message: string }) => (
    <div className="p-12 text-center flex flex-col items-center justify-center opacity-40">
        <div className="w-16 h-16 bg-gray-200 rounded-full mb-4"></div>
        <p className="font-bold text-gray-900">{message}</p>
    </div>
);

export default ClientDetailModal;
