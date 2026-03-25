import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Edit2, Plus, RefreshCw, Search, Send, XCircle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Database } from '../types/supabase';
import SizeChangeRequestForm from '../components/forms/SizeChangeRequestForm';
import SizeChangeRequestDetailModal from '../components/modals/SizeChangeRequestDetailModal';

type SizeChangeRequestRow = Database['public']['Tables']['size_change_requests']['Row'];
type SizeChangeRequestItemRow = Database['public']['Tables']['size_change_request_items']['Row'];
type ClientRow = Database['public']['Tables']['clients']['Row'];
type InventoryRow = Database['public']['Tables']['inventory']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type RequestTab = 'open' | 'history';
type ActionType = 'send' | 'close' | 'cancel';

type EnrichedRequest = SizeChangeRequestRow & {
    items: SizeChangeRequestItemRow[];
    totalAmount: number;
    itemCount: number;
};

const statusStyles: Record<string, string> = {
    requested: 'bg-amber-50 text-amber-700 border-amber-200',
    sent: 'bg-sky-50 text-sky-700 border-sky-200',
    closed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

const statusLabels: Record<string, string> = {
    requested: 'Solicitado',
    sent: 'Enviado',
    closed: 'Cerrado',
    cancelled: 'Cancelado',
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

const formatDateTime = (value?: string | null) => {
    if (!value) return 'Sin registro';
    return new Date(value).toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const buildActorName = (profile?: ProfileRow | null) => {
    if (!profile) return 'Usuario';
    return profile.full_name?.trim() || profile.email?.split('@')[0] || 'Usuario';
};

const SizeChanges: React.FC = () => {
    const { profile, effectiveRole, hasPermission } = useUser();
    const canViewSizeChanges = hasPermission('VIEW_SIZE_CHANGES');
    const canCreateSizeChanges = hasPermission('CREATE_SIZE_CHANGES');
    const canManageSizeChanges = hasPermission('MANAGE_SIZE_CHANGES');

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [processingAction, setProcessingAction] = useState(false);
    const [activeTab, setActiveTab] = useState<RequestTab>('open');
    const [search, setSearch] = useState('');
    const [requests, setRequests] = useState<SizeChangeRequestRow[]>([]);
    const [requestItems, setRequestItems] = useState<SizeChangeRequestItemRow[]>([]);
    const [clients, setClients] = useState<ClientRow[]>([]);
    const [inventory, setInventory] = useState<InventoryRow[]>([]);
    const [profiles, setProfiles] = useState<ProfileRow[]>([]);
    const [showFormModal, setShowFormModal] = useState(false);
    const [editingRequest, setEditingRequest] = useState<EnrichedRequest | null>(null);
    const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
    const [actionModal, setActionModal] = useState<{ type: ActionType; request: EnrichedRequest } | null>(null);
    const [actionNote, setActionNote] = useState('');

    const profilesById = useMemo(() => new Map(profiles.map((row) => [row.id, row])), [profiles]);
    const actorNames = useMemo(() => {
        const mapping: Record<string, string> = {};
        profiles.forEach((row) => {
            mapping[row.id] = buildActorName(row);
        });
        return mapping;
    }, [profiles]);

    const sellerOptions = useMemo(
        () => profiles.filter((row) => row.role === 'seller' && row.status === 'active'),
        [profiles]
    );

    const requestItemsByRequestId = useMemo(() => {
        const grouped = new Map<string, SizeChangeRequestItemRow[]>();
        requestItems.forEach((item) => {
            const current = grouped.get(item.request_id) || [];
            current.push(item);
            grouped.set(item.request_id, current);
        });
        return grouped;
    }, [requestItems]);

    const enrichedRequests = useMemo<EnrichedRequest[]>(() => {
        return requests.map((request) => {
            const items = requestItemsByRequestId.get(request.id) || [];
            return {
                ...request,
                items,
                totalAmount: items.reduce((sum, item) => sum + Number(item.line_total || 0), 0),
                itemCount: items.length,
            };
        });
    }, [requestItemsByRequestId, requests]);

    const selectedRequest = useMemo(
        () => enrichedRequests.find((request) => request.id === selectedRequestId) || null,
        [enrichedRequests, selectedRequestId]
    );

    const requestStats = useMemo(() => {
        const requested = enrichedRequests.filter((request) => request.status === 'requested').length;
        const sent = enrichedRequests.filter((request) => request.status === 'sent').length;
        const closed = enrichedRequests.filter((request) => request.status === 'closed').length;
        const totalAmount = enrichedRequests.reduce((sum, request) => sum + request.totalAmount, 0);
        return { total: enrichedRequests.length, requested, sent, closed, totalAmount };
    }, [enrichedRequests]);

    const filteredRequests = useMemo(() => {
        const term = search.trim().toLowerCase();
        const statusSet = activeTab === 'open'
            ? new Set(['requested', 'sent'])
            : new Set(['closed', 'cancelled']);

        return enrichedRequests
            .filter((request) => statusSet.has(request.status))
            .filter((request) => {
                if (!term) return true;
                const haystack = [
                    request.folio?.toString(),
                    request.client_name_snapshot,
                    request.client_rut_snapshot,
                    request.seller_name_snapshot,
                    request.request_comment,
                    request.sent_note,
                    request.close_note,
                    request.cancel_note,
                    ...request.items.flatMap((item) => [item.sku_snapshot, item.product_name_snapshot]),
                ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();

                return haystack.includes(term);
            })
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }, [activeTab, enrichedRequests, search]);

    const fetchData = async () => {
        if (!canViewSizeChanges) return;

        setLoading(true);
        try {
            const [requestsRes, itemsRes, profilesRes, clientsRes, inventoryRes] = await Promise.all([
                supabase.from('size_change_requests').select('*').order('created_at', { ascending: false }),
                supabase.from('size_change_request_items').select('*'),
                supabase.from('profiles').select('id, full_name, email, role, status').order('full_name'),
                canCreateSizeChanges
                    ? supabase.from('clients').select('id, name, rut, address, comuna, office, created_by').order('name')
                    : Promise.resolve({ data: [], error: null }),
                canCreateSizeChanges
                    ? supabase.from('inventory').select('id, sku, name, price, stock_qty, created_at, category, demo_available').order('name')
                    : Promise.resolve({ data: [], error: null }),
            ]);

            if (requestsRes.error) throw requestsRes.error;
            if (itemsRes.error) throw itemsRes.error;
            if (profilesRes.error) throw profilesRes.error;
            if (clientsRes.error) throw clientsRes.error;
            if (inventoryRes.error) throw inventoryRes.error;

            setRequests((requestsRes.data || []) as SizeChangeRequestRow[]);
            setRequestItems((itemsRes.data || []) as SizeChangeRequestItemRow[]);
            setProfiles((profilesRes.data || []) as ProfileRow[]);
            setClients((clientsRes.data || []) as ClientRow[]);
            setInventory((inventoryRes.data || []) as InventoryRow[]);
        } catch (error: any) {
            console.error('Error loading size change requests:', error);
            alert(`Error cargando cambios de medida: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchData();
    }, [canViewSizeChanges, canCreateSizeChanges]);

    const openCreateModal = () => {
        setEditingRequest(null);
        setShowFormModal(true);
    };

    const openEditModal = (request: EnrichedRequest) => {
        setEditingRequest(request);
        setSelectedRequestId(null);
        setShowFormModal(true);
    };

    const closeFormModal = () => {
        setShowFormModal(false);
        setEditingRequest(null);
    };

    const closeActionModal = () => {
        setActionModal(null);
        setActionNote('');
    };

    const canEditRequest = (request: EnrichedRequest) => {
        if (request.status !== 'requested') return false;
        if (effectiveRole === 'admin') return true;
        return effectiveRole === 'seller' && request.seller_id === profile?.id;
    };

    const canMarkSentRequest = (request: EnrichedRequest) => canManageSizeChanges && request.status === 'requested';
    const canCloseRequest = (request: EnrichedRequest) => canManageSizeChanges && request.status === 'sent';
    const canCancelRequest = (request: EnrichedRequest) => {
        if (effectiveRole === 'seller') return request.seller_id === profile?.id && request.status === 'requested';
        return canManageSizeChanges && (request.status === 'requested' || request.status === 'sent');
    };

    const handleSubmitForm = async (payload: {
        clientId: string;
        sellerId: string;
        requestComment: string;
        items: Array<{ productId: string; qty: number; unitPrice: number }>;
    }) => {
        setSubmitting(true);
        try {
            const rpcPayload = {
                client_id: payload.clientId,
                seller_id: payload.sellerId,
                request_comment: payload.requestComment,
                items: payload.items.map((item) => ({
                    product_id: item.productId,
                    qty: Number(item.qty),
                    unit_price: Number(item.unitPrice),
                })),
            };

            const { error } = editingRequest
                ? await supabase.rpc('update_size_change_request', {
                    p_request_id: editingRequest.id,
                    p_payload: rpcPayload,
                })
                : await supabase.rpc('create_size_change_request', {
                    p_payload: rpcPayload,
                });

            if (error) throw error;

            closeFormModal();
            await fetchData();
            alert(editingRequest ? 'Solicitud actualizada correctamente.' : 'Solicitud creada correctamente.');
        } catch (error: any) {
            console.error('Error saving size change request:', error);
            alert(error?.message || 'No se pudo guardar la solicitud de cambio.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleConfirmAction = async () => {
        if (!actionModal) return;
        setProcessingAction(true);
        try {
            let response;
            if (actionModal.type === 'send') {
                response = await supabase.rpc('mark_size_change_sent', {
                    p_request_id: actionModal.request.id,
                    p_sent_note: actionNote.trim() || null,
                });
            } else if (actionModal.type === 'close') {
                response = await supabase.rpc('close_size_change_request', {
                    p_request_id: actionModal.request.id,
                    p_close_note: actionNote.trim() || null,
                });
            } else {
                response = await supabase.rpc('cancel_size_change_request', {
                    p_request_id: actionModal.request.id,
                    p_cancel_note: actionNote.trim() || null,
                });
            }

            if (response.error) throw response.error;

            closeActionModal();
            setSelectedRequestId(actionModal.request.id);
            await fetchData();

            if (actionModal.type === 'send') {
                alert('Cambio marcado como enviado correctamente.');
            } else if (actionModal.type === 'close') {
                alert('Cambio cerrado correctamente y stock descontado.');
            } else {
                alert('Solicitud cancelada correctamente.');
            }
        } catch (error: any) {
            console.error('Error processing size change action:', error);
            alert(error?.message || 'No se pudo completar la acción.');
        } finally {
            setProcessingAction(false);
        }
    };

    const selectedActionRequest = actionModal?.request || null;

    if (!canViewSizeChanges) {
        return (
            <div className="max-w-3xl mx-auto premium-card p-10 text-center">
                <h2 className="text-2xl font-black text-gray-900">Sin acceso al módulo</h2>
                <p className="text-sm font-medium text-gray-500 mt-2">Tu perfil no tiene permisos para ver cambios de medida.</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight">Cambios de Medida</h2>
                    <p className="text-gray-400 font-medium mt-1 text-lg">Solicita cambios de medida sin generar pedido</p>
                </div>
                {canCreateSizeChanges && (
                    <button
                        onClick={openCreateModal}
                        className="bg-side-gradient text-white px-8 py-4 rounded-[2rem] font-bold flex items-center shadow-xl shadow-indigo-100 active:scale-95 transition-all"
                    >
                        <Plus size={20} className="mr-3" />
                        Nueva solicitud
                    </button>
                )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="premium-card border-l-4 border-l-indigo-500 p-6">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Total</p>
                    <p className="text-2xl font-black text-gray-900 mt-2">{requestStats.total}</p>
                </div>
                <div className="premium-card border-l-4 border-l-amber-500 p-6">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Solicitados</p>
                    <p className="text-2xl font-black text-amber-600 mt-2">{requestStats.requested}</p>
                </div>
                <div className="premium-card border-l-4 border-l-sky-500 p-6">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Enviados</p>
                    <p className="text-2xl font-black text-sky-600 mt-2">{requestStats.sent}</p>
                </div>
                <div className="premium-card border-l-4 border-l-emerald-500 p-6 col-span-2 md:col-span-1">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Monto total</p>
                    <p className="text-xl font-black text-emerald-600 mt-2">{formatMoney(requestStats.totalAmount)}</p>
                </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm flex flex-col md:flex-row gap-2">
                <button
                    onClick={() => setActiveTab('open')}
                    className={`flex-1 rounded-[1.3rem] px-5 py-3 text-sm font-black transition-all ${activeTab === 'open' ? 'bg-side-gradient text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    Abiertas
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex-1 rounded-[1.3rem] px-5 py-3 text-sm font-black transition-all ${activeTab === 'history' ? 'bg-side-gradient text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                >
                    Historial
                </button>
            </div>

            <div className="relative">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                    type="text"
                    placeholder="Buscar por folio, cliente, vendedor, SKU o comentario..."
                    className="w-full pl-14 pr-6 py-4 bg-white border border-transparent rounded-3xl shadow-sm focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-gray-600 font-medium"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="premium-card h-56 animate-pulse bg-slate-50" />
                    ))}
                </div>
            ) : filteredRequests.length === 0 ? (
                <div className="premium-card p-10 text-center">
                    <h3 className="text-xl font-black text-gray-900">No hay solicitudes para este filtro</h3>
                    <p className="text-sm font-medium text-gray-500 mt-2">Ajusta la búsqueda o crea un nuevo cambio de medida.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredRequests.map((request) => {
                        const editable = canEditRequest(request);
                        const sendable = canMarkSentRequest(request);
                        const closable = canCloseRequest(request);
                        const cancellable = canCancelRequest(request);

                        return (
                            <button
                                key={request.id}
                                type="button"
                                onClick={() => setSelectedRequestId(request.id)}
                                className="premium-card group w-full space-y-4 p-6 text-left transition-all hover:-translate-y-1 hover:shadow-2xl"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-indigo-500">Cambio #{request.folio}</p>
                                        <h3 className="mt-2 text-lg font-black text-gray-900 uppercase leading-tight">{request.client_name_snapshot}</h3>
                                        <p className="mt-1 text-xs font-medium text-gray-500">{formatDateTime(request.created_at)}</p>
                                    </div>
                                    <span className={`rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${statusStyles[request.status] || statusStyles.requested}`}>
                                        {statusLabels[request.status] || request.status}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3 py-2 border-t border-gray-50">
                                    <div>
                                        <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Vendedor</p>
                                        <p className="text-sm font-black text-gray-900 mt-1 truncate">{request.seller_name_snapshot}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Monto</p>
                                        <p className="text-sm font-black text-indigo-600 mt-1">{formatMoney(request.totalAmount)}</p>
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Comentario</p>
                                    <p className="mt-2 text-sm font-medium text-gray-700 line-clamp-3">{request.request_comment || 'Sin comentarios registrados.'}</p>
                                </div>

                                <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-500">
                                    <span>{request.itemCount} línea(s)</span>
                                    <span>{request.items.reduce((sum, item) => sum + Number(item.qty || 0), 0).toLocaleString('es-CL')} unidad(es)</span>
                                </div>

                                <div className="flex flex-wrap gap-2 pt-2" onClick={(event) => event.stopPropagation()}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedRequestId(request.id)}
                                        className="rounded-2xl border border-gray-200 px-4 py-2.5 text-xs font-black text-gray-700 hover:bg-gray-50 transition-colors"
                                    >
                                        Ver detalle
                                    </button>
                                    {editable && (
                                        <button
                                            type="button"
                                            onClick={() => openEditModal(request)}
                                            className="inline-flex items-center rounded-2xl border border-amber-100 bg-amber-50 px-4 py-2.5 text-xs font-black text-amber-700 hover:bg-amber-100 transition-colors"
                                        >
                                            <Edit2 size={14} className="mr-2" /> Editar
                                        </button>
                                    )}
                                    {sendable && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActionModal({ type: 'send', request });
                                                setActionNote('');
                                            }}
                                            className="inline-flex items-center rounded-2xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white hover:bg-sky-700 transition-colors"
                                        >
                                            <Send size={14} className="mr-2" /> Enviar
                                        </button>
                                    )}
                                    {closable && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActionModal({ type: 'close', request });
                                                setActionNote('');
                                            }}
                                            className="inline-flex items-center rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700 transition-colors"
                                        >
                                            <CheckCircle2 size={14} className="mr-2" /> Cerrar
                                        </button>
                                    )}
                                    {cancellable && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActionModal({ type: 'cancel', request });
                                                setActionNote('');
                                            }}
                                            className="inline-flex items-center rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs font-black text-red-600 hover:bg-red-100 transition-colors"
                                        >
                                            <XCircle size={14} className="mr-2" /> Cancelar
                                        </button>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            <SizeChangeRequestForm
                isOpen={showFormModal}
                mode={editingRequest ? 'edit' : 'create'}
                submitting={submitting}
                clients={clients}
                inventory={inventory}
                sellerOptions={sellerOptions}
                currentUserProfile={profile as ProfileRow | null}
                effectiveRole={effectiveRole}
                initialRequest={editingRequest ? {
                    clientId: editingRequest.client_id,
                    sellerId: editingRequest.seller_id,
                    requestComment: editingRequest.request_comment || '',
                    items: editingRequest.items.map((item) => ({
                        productId: item.product_id,
                        sku: item.sku_snapshot,
                        productName: item.product_name_snapshot,
                        qty: Number(item.qty || 0),
                        unitPrice: Number(item.unit_price || 0),
                    })),
                } : null}
                onClose={closeFormModal}
                onSubmit={handleSubmitForm}
            />

            <SizeChangeRequestDetailModal
                isOpen={Boolean(selectedRequest)}
                request={selectedRequest}
                items={selectedRequest?.items || []}
                actorNames={actorNames}
                canEdit={selectedRequest ? canEditRequest(selectedRequest) : false}
                canMarkSent={selectedRequest ? canMarkSentRequest(selectedRequest) : false}
                canCloseRequest={selectedRequest ? canCloseRequest(selectedRequest) : false}
                canCancel={selectedRequest ? canCancelRequest(selectedRequest) : false}
                onClose={() => setSelectedRequestId(null)}
                onEdit={() => selectedRequest && openEditModal(selectedRequest)}
                onMarkSent={() => {
                    if (!selectedRequest) return;
                    setActionModal({ type: 'send', request: selectedRequest });
                    setActionNote('');
                    setSelectedRequestId(null);
                }}
                onCloseRequest={() => {
                    if (!selectedRequest) return;
                    setActionModal({ type: 'close', request: selectedRequest });
                    setActionNote('');
                    setSelectedRequestId(null);
                }}
                onCancel={() => {
                    if (!selectedRequest) return;
                    setActionModal({ type: 'cancel', request: selectedRequest });
                    setActionNote('');
                    setSelectedRequestId(null);
                }}
            />

            {selectedActionRequest && (
                <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
                    <div className="w-full max-w-xl rounded-[2rem] bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-6 md:py-5 border-b border-gray-100">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Cambio #{selectedActionRequest.folio}</p>
                                <h3 className="text-xl font-black text-gray-900 mt-1">
                                    {actionModal?.type === 'send' ? 'Marcar enviado' : actionModal?.type === 'close' ? 'Cerrar cambio' : 'Cancelar solicitud'}
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">{selectedActionRequest.client_name_snapshot}</p>
                            </div>
                            <button onClick={closeActionModal} className="p-2 rounded-full hover:bg-gray-100 transition-colors shrink-0">
                                <XCircle size={22} />
                            </button>
                        </div>
                        <div className="p-5 md:p-6 space-y-4">
                            {actionModal?.type === 'close' ? (
                                <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5 text-sm text-emerald-900 space-y-2">
                                    <div className="flex items-center gap-2 font-black"><CheckCircle2 size={16} /> Cambio realizado exitosamente</div>
                                    <div className="flex items-center gap-2 font-black"><RefreshCw size={16} /> Productos de devolución retirados</div>
                                    <p className="text-emerald-700 font-medium pt-1">Al cerrar se descontará stock de los productos salientes. Si una línea no tiene stock suficiente, no se cerrará la solicitud.</p>
                                </div>
                            ) : actionModal?.type === 'send' ? (
                                <div className="rounded-3xl border border-sky-100 bg-sky-50 p-5 text-sm font-medium text-sky-800">
                                    El cambio quedará en estado <span className="font-black">Enviado</span> y la solicitud comercial quedará congelada para edición.
                                </div>
                            ) : (
                                <div className="rounded-3xl border border-red-100 bg-red-50 p-5 text-sm font-medium text-red-700 flex items-start gap-3">
                                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                                    Esta solicitud se cancelará sin mover stock. El historial quedará guardado en el CRM.
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                                    {actionModal?.type === 'send' ? 'Nota de envío' : actionModal?.type === 'close' ? 'Comentario de cierre' : 'Motivo de cancelación'}
                                </label>
                                <textarea
                                    value={actionNote}
                                    onChange={(event) => setActionNote(event.target.value)}
                                    className="mt-3 min-h-[130px] w-full rounded-3xl border border-gray-200 bg-white px-4 py-4 text-sm font-medium text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                    placeholder={actionModal?.type === 'close'
                                        ? 'Ej: cambio entregado al cliente y devolución retirada sin diferencias.'
                                        : actionModal?.type === 'send'
                                            ? 'Opcional: agrega contexto operativo para facturación.'
                                            : 'Opcional: explica por qué se cancela la solicitud.'}
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-3 px-5 py-4 md:px-6 border-t border-gray-100 bg-white">
                            <button
                                onClick={closeActionModal}
                                className="rounded-2xl border border-gray-200 px-5 py-3 text-sm font-black text-gray-600 hover:bg-gray-50 transition-colors"
                            >
                                Volver
                            </button>
                            <button
                                onClick={() => void handleConfirmAction()}
                                disabled={processingAction}
                                className={`inline-flex items-center rounded-2xl px-5 py-3 text-sm font-black text-white transition-colors ${actionModal?.type === 'cancel' ? 'bg-red-600 hover:bg-red-700' : actionModal?.type === 'close' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'} disabled:opacity-60`}
                            >
                                {processingAction ? <RefreshCw size={16} className="mr-2 animate-spin" /> : null}
                                {actionModal?.type === 'send' ? 'Confirmar envío' : actionModal?.type === 'close' ? 'Cerrar cambio' : 'Cancelar solicitud'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SizeChanges;
