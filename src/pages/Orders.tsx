import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, RefreshCw, Search, ShoppingCart, Send } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { sendOrderNotificationEmail } from '../utils/orderEmail';
import { formatPaymentTermsFromCreditDays, getClientCreditDays } from '../utils/credit';

type OrderStatusFilter = 'all' | 'completed' | 'cancelled';
type DeliveryStatusFilter = 'all' | 'pending' | 'out_for_delivery' | 'delivered';
type ViewMode = 'all' | 'mine';

type EnrichedOrder = {
    id: string;
    folio: number | null;
    quotation_id: string | null;
    quotation_folio: number | null;
    client_name: string;
    seller_name: string;
    status: string | null;
    delivery_status: string | null;
    total_amount: number | null;
    created_at: string | null;
    user_id: string | null;
    payment_email_status: string | null;
    payment_email_error: string | null;
};

const formatMoney = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const formatDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString('es-CL') : '-';
const PAYMENT_PROOFS_BUCKET = 'payment-proofs';

const getPaymentEmailStatusStyles = (status: string | null | undefined) => {
    switch ((status || '').toLowerCase()) {
        case 'sent':
            return 'bg-emerald-100 text-emerald-700';
        case 'failed':
            return 'bg-red-100 text-red-700';
        case 'pending':
            return 'bg-amber-100 text-amber-700';
        default:
            return 'bg-gray-100 text-gray-600';
    }
};

const getPaymentEmailStatusLabel = (status: string | null | undefined) => {
    switch ((status || '').toLowerCase()) {
        case 'sent':
            return 'Correo enviado';
        case 'failed':
            return 'Error correo';
        case 'pending':
            return 'Pendiente correo';
        default:
            return 'Sin envio';
    }
};

const Orders = () => {
    const { profile, effectiveRole, hasPermission, isSupervisor } = useUser();
    const [orders, setOrders] = useState<EnrichedOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatusFilter>('all');
    const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<DeliveryStatusFilter>('all');
    const [viewMode, setViewMode] = useState<ViewMode>('all');
    const [resendingOrderId, setResendingOrderId] = useState<string | null>(null);

    const isSellerRole = effectiveRole === 'seller';
    const canViewAll = useMemo(
        () => !isSellerRole && (hasPermission('VIEW_ALL_CLIENTS') || isSupervisor || profile?.email === (import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl')),
        [isSellerRole, hasPermission, isSupervisor, profile?.email]
    );

    const fetchOrders = useCallback(async () => {
        setLoading(true);
        setErrorMessage(null);
        try {
            let query = supabase
                .from('orders')
                .select('id, folio, quotation_id, client_id, user_id, status, delivery_status, total_amount, created_at, payment_email_status, payment_email_error')
                .not('quotation_id', 'is', null)
                .order('created_at', { ascending: false });

            if (isSellerRole && profile?.id) {
                query = query.eq('user_id', profile.id);
            } else if (!canViewAll && profile?.id) {
                query = query.eq('user_id', profile.id);
            }

            const { data, error } = await query;
            if (error) throw error;

            const loaded = (data || []) as Array<any>;
            if (loaded.length === 0) {
                setOrders([]);
                setLastRefreshAt(new Date().toISOString());
                return;
            }

            const clientIds = Array.from(new Set(loaded.map((o) => o.client_id).filter(Boolean)));
            const userIds = Array.from(new Set(loaded.map((o) => o.user_id).filter(Boolean)));
            const quotationIds = Array.from(new Set(loaded.map((o) => o.quotation_id).filter(Boolean)));

            const [clientsRes, profilesRes, quotationsRes] = await Promise.all([
                clientIds.length > 0
                    ? supabase.from('clients').select('id, name').in('id', clientIds)
                    : Promise.resolve({ data: [], error: null } as any),
                userIds.length > 0
                    ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
                    : Promise.resolve({ data: [], error: null } as any),
                quotationIds.length > 0
                    ? supabase.from('quotations').select('id, folio').in('id', quotationIds)
                    : Promise.resolve({ data: [], error: null } as any)
            ]);

            if (clientsRes.error) throw clientsRes.error;
            if (profilesRes.error) throw profilesRes.error;
            if (quotationsRes.error) throw quotationsRes.error;

            const clientsMap = new Map<string, any>((clientsRes.data || []).map((c: any) => [c.id, c]));
            const profilesMap = new Map<string, any>((profilesRes.data || []).map((p: any) => [p.id, p]));
            const quotationsMap = new Map<string, any>((quotationsRes.data || []).map((q: any) => [q.id, q]));

            const enriched: EnrichedOrder[] = loaded.map((order: any) => {
                const seller = profilesMap.get(order.user_id || '');
                const client = clientsMap.get(order.client_id || '');
                const quotation = quotationsMap.get(order.quotation_id || '');

                return {
                    id: order.id,
                    folio: order.folio ?? null,
                    quotation_id: order.quotation_id ?? null,
                    quotation_folio: quotation?.folio ?? null,
                    client_name: client?.name || 'Cliente no disponible',
                    seller_name: seller?.full_name || seller?.email || 'Sin vendedor',
                    status: order.status ?? null,
                    delivery_status: order.delivery_status ?? null,
                    total_amount: order.total_amount ?? 0,
                    created_at: order.created_at ?? null,
                    user_id: order.user_id ?? null,
                    payment_email_status: order.payment_email_status ?? null,
                    payment_email_error: order.payment_email_error ?? null
                };
            });

            setOrders(enriched);
            setLastRefreshAt(new Date().toISOString());
        } catch (error: any) {
            console.error('Error fetching orders:', error);
            setErrorMessage(error?.message || 'No se pudo cargar el módulo de pedidos.');
            setOrders([]);
        } finally {
            setLoading(false);
        }
    }, [canViewAll, isSellerRole, profile?.id]);

    useEffect(() => {
        if (profile?.id) {
            fetchOrders();
        }
    }, [fetchOrders, profile?.id]);

    const updateOrderEmailStatus = useCallback(async (orderId: string, status: 'sent' | 'failed', errorMessage?: string | null) => {
        const payload: any = {
            payment_email_status: status,
            payment_email_error: status === 'failed' ? (errorMessage || 'No se pudo enviar el correo') : null,
            payment_email_sent_at: status === 'sent' ? new Date().toISOString() : null
        };

        const { error } = await supabase
            .from('orders')
            .update(payload)
            .eq('id', orderId);

        if (error) {
            console.warn('No se pudo actualizar el estado de correo del pedido:', error.message);
        }
    }, []);

    const handleResendOrderEmail = useCallback(async (order: EnrichedOrder) => {
        if (!profile?.id) {
            alert('No se pudo identificar al usuario actual.');
            return;
        }
        if (order.user_id !== profile.id) {
            alert('Solo el vendedor dueño del pedido puede reenviar este correo.');
            return;
        }

        setResendingOrderId(order.id);
        try {
            const { data: orderRow, error: orderError } = await supabase
                .from('orders')
                .select('id, folio, client_id, user_id, total_amount, payment_proof_path, payment_proof_name, payment_proof_mime_type')
                .eq('id', order.id)
                .single();

            if (orderError) throw orderError;

            const [clientRes, sellerRes, itemsRes] = await Promise.all([
                supabase
                    .from('clients')
                    .select('id, name, rut, address, office, phone, email, giro, credit_days')
                    .eq('id', orderRow.client_id)
                    .single(),
                supabase
                    .from('profiles')
                    .select('id, full_name, email')
                    .eq('id', orderRow.user_id)
                    .single(),
                supabase
                    .from('order_items')
                    .select('quantity, unit_price, total_price, inventory(name, sku)')
                    .eq('order_id', order.id)
            ]);

            if (clientRes.error) throw clientRes.error;
            if (sellerRes.error) throw sellerRes.error;
            if (itemsRes.error) throw itemsRes.error;

            const client = clientRes.data;
            const seller = sellerRes.data;
            const creditDays = getClientCreditDays(client);

            let proofAttachment: File | null = null;
            if (orderRow.payment_proof_path) {
                const { data: proofBlob, error: proofError } = await supabase.storage
                    .from(PAYMENT_PROOFS_BUCKET)
                    .download(orderRow.payment_proof_path);

                if (proofError) throw proofError;

                proofAttachment = new File(
                    [proofBlob],
                    orderRow.payment_proof_name || 'comprobante_pago',
                    { type: orderRow.payment_proof_mime_type || proofBlob.type || 'application/octet-stream' }
                );
            } else if (creditDays === 0) {
                throw new Error('El pedido no tiene un comprobante de pago guardado para reenviar.');
            }

            await sendOrderNotificationEmail({
                order: {
                    folio: orderRow.folio || order.id.slice(0, 8),
                    quotationFolio: order.quotation_folio,
                    date: new Date(order.created_at || new Date().toISOString()).toLocaleDateString('es-CL'),
                    clientName: client.name,
                    clientRut: client.rut || '',
                    clientAddress: client.address || '',
                    clientOffice: client.office || '',
                    clientPhone: client.phone || '',
                    clientEmail: client.email || '',
                    clientGiro: client.giro || '',
                    paymentTerms: formatPaymentTermsFromCreditDays(creditDays),
                    sellerName: seller.full_name || seller.email || 'Vendedor',
                    sellerEmail: seller.email || '',
                    items: (itemsRes.data || []).map((item: any) => ({
                        code: item.inventory?.sku || '',
                        detail: item.inventory?.name || 'Producto',
                        qty: Number(item.quantity || 0),
                        unit: 'UN',
                        unitPrice: Number(item.unit_price || 0),
                        total: Number(item.total_price || 0)
                    })),
                    totalAmount: Number(orderRow.total_amount || 0)
                },
                proofAttachment,
                clientId: client.id,
                profileId: profile.id
            });

            await updateOrderEmailStatus(order.id, 'sent');
            setOrders((prev) => prev.map((current) => (
                current.id === order.id
                    ? { ...current, payment_email_status: 'sent', payment_email_error: null }
                    : current
            )));
            alert('Correo reenviado correctamente.');
        } catch (error: any) {
            const message = error?.message || 'No se pudo reenviar el correo';
            await updateOrderEmailStatus(order.id, 'failed', message);
            setOrders((prev) => prev.map((current) => (
                current.id === order.id
                    ? { ...current, payment_email_status: 'failed', payment_email_error: message }
                    : current
            )));
            alert(message);
        } finally {
            setResendingOrderId(null);
        }
    }, [profile?.id, updateOrderEmailStatus]);

    const filteredOrders = useMemo(() => {
        const term = search.trim().toLowerCase();
        return orders.filter((order) => {
            const matchesSearch = !term
                || (order.client_name || '').toLowerCase().includes(term)
                || (order.seller_name || '').toLowerCase().includes(term)
                || String(order.folio || '').includes(term)
                || String(order.quotation_folio || '').includes(term);

            const matchesOrderStatus = orderStatusFilter === 'all' || (order.status || '').toLowerCase() === orderStatusFilter;
            const matchesDeliveryStatus = deliveryStatusFilter === 'all' || (order.delivery_status || '').toLowerCase() === deliveryStatusFilter;
            const matchesView = viewMode === 'all' || order.user_id === profile?.id;

            return matchesSearch && matchesOrderStatus && matchesDeliveryStatus && matchesView;
        });
    }, [deliveryStatusFilter, orderStatusFilter, orders, profile?.id, search, viewMode]);

    const orderStats = useMemo(() => {
        const completed = filteredOrders.filter((o) => (o.status || '').toLowerCase() === 'completed').length;
        const delivered = filteredOrders.filter((o) => (o.delivery_status || '').toLowerCase() === 'delivered').length;
        const totalAmount = filteredOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
        return { total: filteredOrders.length, completed, delivered, totalAmount };
    }, [filteredOrders]);

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                        <ShoppingCart className="text-indigo-600" />
                        Pedidos
                    </h2>
                    <p className="text-gray-500 font-medium mt-1">Pedidos convertidos desde cotizaciones. No está permitida la creación manual.</p>
                    {lastRefreshAt && (
                        <p className="text-xs text-gray-400 mt-2">Última actualización: {new Date(lastRefreshAt).toLocaleString('es-CL')}</p>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        to="/quotations"
                        className="px-4 py-3 rounded-2xl bg-indigo-600 text-white text-sm font-bold inline-flex items-center hover:bg-indigo-700 transition-all"
                    >
                        <FileText size={16} className="mr-2" />
                        Ir a Cotizaciones
                    </Link>
                    <button
                        onClick={fetchOrders}
                        className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-gray-700 text-sm font-bold inline-flex items-center hover:bg-gray-50 transition-all"
                    >
                        <RefreshCw size={16} className="mr-2" />
                        Actualizar
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="premium-card p-4">
                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Total Pedidos</p>
                    <p className="text-3xl font-black text-gray-900 mt-2">{orderStats.total}</p>
                </div>
                <div className="premium-card p-4">
                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Completados</p>
                    <p className="text-3xl font-black text-emerald-600 mt-2">{orderStats.completed}</p>
                </div>
                <div className="premium-card p-4">
                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Entregados</p>
                    <p className="text-3xl font-black text-indigo-600 mt-2">{orderStats.delivered}</p>
                </div>
                <div className="premium-card p-4">
                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Total Vendido</p>
                    <p className="text-3xl font-black text-gray-900 mt-2">{formatMoney(orderStats.totalAmount)}</p>
                </div>
            </div>

            <div className="premium-card p-4 md:p-6 border border-gray-100 space-y-4">
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1 relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por cliente, vendedor, folio pedido o cotización..."
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    {canViewAll && (
                        <div className="flex bg-gray-100 p-1 rounded-xl">
                            <button
                                onClick={() => setViewMode('all')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Todos
                            </button>
                            <button
                                onClick={() => setViewMode('mine')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'mine' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Mis Pedidos
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    {([
                        { key: 'all', label: 'Todos' },
                        { key: 'completed', label: 'Completados' },
                        { key: 'cancelled', label: 'Cancelados' }
                    ] as Array<{ key: OrderStatusFilter; label: string }>).map((option) => (
                        <button
                            key={`order-${option.key}`}
                            onClick={() => setOrderStatusFilter(option.key)}
                            className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider border ${orderStatusFilter === option.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                        >
                            {option.label}
                        </button>
                    ))}
                    {([
                        { key: 'all', label: 'Despacho: Todos' },
                        { key: 'pending', label: 'Despacho: Pendiente' },
                        { key: 'out_for_delivery', label: 'Despacho: En Ruta' },
                        { key: 'delivered', label: 'Despacho: Entregado' }
                    ] as Array<{ key: DeliveryStatusFilter; label: string }>).map((option) => (
                        <button
                            key={`delivery-${option.key}`}
                            onClick={() => setDeliveryStatusFilter(option.key)}
                            className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider border ${deliveryStatusFilter === option.key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                {loading ? (
                    <div className="py-12 text-center">
                        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    </div>
                ) : errorMessage ? (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm font-bold">
                        {errorMessage}
                    </div>
                ) : filteredOrders.length === 0 ? (
                    <div className="py-12 text-center text-gray-500 font-bold">
                        No hay pedidos convertidos para los filtros seleccionados.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1240px] text-sm">
                            <thead className="bg-gray-50 border-y border-gray-100">
                                <tr>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Pedido</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Cotización</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Cliente</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Vendedor</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Estado Venta</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Correo</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Estado Despacho</th>
                                    <th className="text-right px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Total</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Fecha</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOrders.map((order) => (
                                    <tr key={order.id} className="border-b border-gray-100 last:border-0">
                                        <td className="px-4 py-3 font-black text-gray-900">#{order.folio ?? '-'}</td>
                                        <td className="px-4 py-3 font-bold text-indigo-600">#{order.quotation_folio ?? '-'}</td>
                                        <td className="px-4 py-3 font-bold text-gray-800">{order.client_name}</td>
                                        <td className="px-4 py-3 font-medium text-gray-700">{order.seller_name}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${String(order.status || '').toLowerCase() === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {order.status || 'N/A'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="space-y-1">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${getPaymentEmailStatusStyles(order.payment_email_status)}`}>
                                                    {getPaymentEmailStatusLabel(order.payment_email_status)}
                                                </span>
                                                {order.payment_email_error && (
                                                    <p className="text-[11px] font-medium text-red-600 max-w-[200px] truncate" title={order.payment_email_error}>
                                                        {order.payment_email_error}
                                                    </p>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${String(order.delivery_status || '').toLowerCase() === 'delivered' ? 'bg-emerald-100 text-emerald-700' : String(order.delivery_status || '').toLowerCase() === 'out_for_delivery' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {order.delivery_status || 'pending'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-black text-gray-900">{formatMoney(order.total_amount)}</td>
                                        <td className="px-4 py-3 font-medium text-gray-500">{formatDate(order.created_at)}</td>
                                        <td className="px-4 py-3">
                                            {(order.user_id === profile?.id && (order.payment_email_status === 'pending' || order.payment_email_status === 'failed')) ? (
                                                <button
                                                    onClick={() => handleResendOrderEmail(order)}
                                                    disabled={resendingOrderId === order.id}
                                                    className="inline-flex items-center px-3 py-2 rounded-xl bg-indigo-600 text-white text-[11px] font-black uppercase tracking-wider hover:bg-indigo-700 transition-all disabled:opacity-50"
                                                >
                                                    {resendingOrderId === order.id ? (
                                                        <div className="w-4 h-4 border-2 border-white border-t-transparent animate-spin rounded-full" />
                                                    ) : (
                                                        <>
                                                            <Send size={14} className="mr-2" />
                                                            Reenviar
                                                        </>
                                                    )}
                                                </button>
                                            ) : (
                                                <span className="text-xs text-gray-400 font-medium">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Orders;
