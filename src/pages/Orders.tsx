import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, FileText, History, RefreshCw, Search, ShoppingCart, Send } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { sendOrderNotificationEmail } from '../utils/orderEmail';
import { formatPaymentTermsFromCreditDays, getClientCreditDays } from '../utils/credit';
import { generateOrderPdfFile, type OrderPdfData } from '../utils/orderPdf';
import PaymentProofPreviewModal from '../components/modals/PaymentProofPreviewModal';
import OrderNotificationHistoryModal from '../components/modals/OrderNotificationHistoryModal';
import type { OrderNotificationLog } from '../utils/orderNotification';
import OrderItemsPreviewModal, { type OrderItemsPreviewItem } from '../components/modals/OrderItemsPreviewModal';
import OrderPdfPreviewModal from '../components/modals/OrderPdfPreviewModal';

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
    payment_proof_path: string | null;
    payment_proof_name: string | null;
    payment_proof_mime_type: string | null;
};

const formatMoney = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const formatDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString('es-CL') : '-';
const PAYMENT_PROOFS_BUCKET = 'payment-proofs';
const ORDER_ITEMS_PREVIEW_STORAGE_KEY = 'orders.activeItemsPreviewOrderId';
const isBillingBackofficeRole = (role: string | null | undefined) =>
    role === 'facturador' || role === 'tesorero';

const canResendOrderEmail = (
    effectiveRole: string | null | undefined,
    profileId: string | null | undefined,
    order: EnrichedOrder
) => {
    if (!profileId) return false;
    return effectiveRole === 'admin'
        || effectiveRole === 'seller'
        || isBillingBackofficeRole(effectiveRole)
        || order.user_id === profileId;
};

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
    const [selectedProofOrder, setSelectedProofOrder] = useState<EnrichedOrder | null>(null);
    const [proofPreviewState, setProofPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [proofFile, setProofFile] = useState<File | null>(null);
    const [proofBlobUrl, setProofBlobUrl] = useState<string | null>(null);
    const [proofError, setProofError] = useState<string | null>(null);
    const [notificationLogsByOrderId, setNotificationLogsByOrderId] = useState<Record<string, OrderNotificationLog[]>>({});
    const [selectedNotificationOrder, setSelectedNotificationOrder] = useState<EnrichedOrder | null>(null);
    const [selectedItemsOrder, setSelectedItemsOrder] = useState<EnrichedOrder | null>(null);
    const [orderItemsPreviewState, setOrderItemsPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [orderItemsPreview, setOrderItemsPreview] = useState<OrderItemsPreviewItem[]>([]);
    const [orderItemsPreviewError, setOrderItemsPreviewError] = useState<string | null>(null);
    const [pendingItemsPreviewRestoreId, setPendingItemsPreviewRestoreId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return sessionStorage.getItem(ORDER_ITEMS_PREVIEW_STORAGE_KEY);
    });
    const [selectedOrderPdfOrder, setSelectedOrderPdfOrder] = useState<EnrichedOrder | null>(null);
    const [orderPdfPreviewState, setOrderPdfPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [orderPdfFile, setOrderPdfFile] = useState<File | null>(null);
    const [orderPdfBlobUrl, setOrderPdfBlobUrl] = useState<string | null>(null);
    const [orderPdfError, setOrderPdfError] = useState<string | null>(null);

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
                .select('id, folio, quotation_id, client_id, user_id, status, delivery_status, total_amount, created_at, payment_email_status, payment_email_error, payment_proof_path, payment_proof_name, payment_proof_mime_type')
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
            const orderIds = loaded.map((o) => o.id).filter(Boolean);

            const [clientsRes, profilesRes, quotationsRes, notificationLogsRes] = await Promise.all([
                clientIds.length > 0
                    ? supabase.from('clients').select('id, name').in('id', clientIds)
                    : Promise.resolve({ data: [], error: null } as any),
                userIds.length > 0
                    ? supabase.from('profiles').select('id, full_name, email').in('id', userIds)
                    : Promise.resolve({ data: [], error: null } as any),
                quotationIds.length > 0
                    ? supabase.from('quotations').select('id, folio').in('id', quotationIds)
                    : Promise.resolve({ data: [], error: null } as any),
                orderIds.length > 0
                    ? supabase
                        .from('order_notification_logs')
                        .select('id, order_id, sender_email, to_recipients, cc_recipients, status, gmail_message_id, gmail_thread_id, error_message, request_source, sent_at, created_at')
                        .in('order_id', orderIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null } as any)
            ]);

            if (clientsRes.error) throw clientsRes.error;
            if (profilesRes.error) throw profilesRes.error;
            if (quotationsRes.error) throw quotationsRes.error;
            if (notificationLogsRes.error) throw notificationLogsRes.error;

            const clientsMap = new Map<string, any>((clientsRes.data || []).map((c: any) => [c.id, c]));
            const profilesMap = new Map<string, any>((profilesRes.data || []).map((p: any) => [p.id, p]));
            const quotationsMap = new Map<string, any>((quotationsRes.data || []).map((q: any) => [q.id, q]));
            const logsByOrderId = (notificationLogsRes.data || []).reduce((acc: Record<string, OrderNotificationLog[]>, log: OrderNotificationLog) => {
                acc[log.order_id] = [...(acc[log.order_id] || []), log];
                return acc;
            }, {});

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
                    payment_email_error: order.payment_email_error ?? null,
                    payment_proof_path: order.payment_proof_path ?? null,
                    payment_proof_name: order.payment_proof_name ?? null,
                    payment_proof_mime_type: order.payment_proof_mime_type ?? null
                };
            });

            setOrders(enriched);
            setNotificationLogsByOrderId(logsByOrderId);
            setLastRefreshAt(new Date().toISOString());
        } catch (error: any) {
            console.error('Error fetching orders:', error);
            setErrorMessage(error?.message || 'No se pudo cargar el módulo de pedidos.');
            setOrders([]);
            setNotificationLogsByOrderId({});
        } finally {
            setLoading(false);
        }
    }, [canViewAll, isSellerRole, profile?.id]);

    useEffect(() => {
        if (profile?.id) {
            fetchOrders();
        }
    }, [fetchOrders, profile?.id]);

    const cleanupProofPreview = useCallback(() => {
        if (proofBlobUrl) {
            URL.revokeObjectURL(proofBlobUrl);
        }
        setProofBlobUrl(null);
        setProofFile(null);
        setProofError(null);
        setProofPreviewState('idle');
    }, [proofBlobUrl]);

    useEffect(() => {
        return () => {
            if (proofBlobUrl) {
                URL.revokeObjectURL(proofBlobUrl);
            }
        };
    }, [proofBlobUrl]);

    useEffect(() => {
        return () => {
            if (orderPdfBlobUrl) {
                URL.revokeObjectURL(orderPdfBlobUrl);
            }
        };
    }, [orderPdfBlobUrl]);

    const closeProofPreview = useCallback(() => {
        cleanupProofPreview();
        setSelectedProofOrder(null);
    }, [cleanupProofPreview]);

    const downloadProofFile = useCallback((file: File | null) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name || 'comprobante_pago';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, []);

    const cleanupOrderPdfPreview = useCallback(() => {
        if (orderPdfBlobUrl) {
            URL.revokeObjectURL(orderPdfBlobUrl);
        }
        setOrderPdfBlobUrl(null);
        setOrderPdfFile(null);
        setOrderPdfError(null);
        setOrderPdfPreviewState('idle');
    }, [orderPdfBlobUrl]);

    const loadProofForOrder = useCallback(async (order: EnrichedOrder) => {
        if (!order.payment_proof_path) {
            setProofPreviewState('error');
            setProofError('Este pedido no tiene un comprobante de pago guardado.');
            return;
        }

        setProofPreviewState('loading');
        setProofError(null);

        try {
            const { data, error } = await supabase.storage
                .from(PAYMENT_PROOFS_BUCKET)
                .download(order.payment_proof_path);

            if (error) throw error;

            if (proofBlobUrl) {
                URL.revokeObjectURL(proofBlobUrl);
            }

            const file = new File(
                [data],
                order.payment_proof_name || 'comprobante_pago',
                { type: order.payment_proof_mime_type || data.type || 'application/octet-stream' }
            );
            const blobUrl = URL.createObjectURL(file);
            setProofFile(file);
            setProofBlobUrl(blobUrl);
            setProofPreviewState('ready');
        } catch (error: any) {
            console.error('Error loading payment proof:', error);
            setProofFile(null);
            setProofBlobUrl(null);
            setProofPreviewState('error');
            setProofError(error?.message || 'No se pudo descargar el comprobante.');
        }
    }, [proofBlobUrl]);

    const openPaymentProofPreview = useCallback(async (order: EnrichedOrder) => {
        setSelectedProofOrder(order);
        setProofFile(null);
        setProofBlobUrl(null);
        setProofError(null);
        setProofPreviewState('idle');
        await loadProofForOrder(order);
    }, [loadProofForOrder]);

    const closeOrderItemsPreview = useCallback(() => {
        setSelectedItemsOrder(null);
        setOrderItemsPreviewState('idle');
        setOrderItemsPreview([]);
        setOrderItemsPreviewError(null);
    }, []);

    const closeOrderPdfPreview = useCallback(() => {
        cleanupOrderPdfPreview();
        setSelectedOrderPdfOrder(null);
    }, [cleanupOrderPdfPreview]);

    const buildOrderPdfPayload = useCallback(async (order: EnrichedOrder): Promise<{ orderRow: any; orderPdfData: OrderPdfData; creditDays: number }> => {
        const { data: orderRow, error: orderError } = await supabase
            .from('orders')
            .select('id, folio, client_id, user_id, total_amount, payment_proof_path, payment_proof_name, payment_proof_mime_type')
            .eq('id', order.id)
            .single();

        if (orderError) throw orderError;

        const [clientRes, sellerRes, itemsRes] = await Promise.all([
            supabase
                .from('clients')
                .select('id, name, rut, address, office, phone, email, giro, credit_days, comuna, zone, purchase_contact')
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

        return {
            orderRow,
            creditDays,
            orderPdfData: {
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
                clientCity: client.zone || 'Santiago',
                clientComuna: client.comuna || '',
                clientContact: client.purchase_contact || '',
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
                totalAmount: Number(orderRow.total_amount || 0),
                comments: order.quotation_folio ? `Pedido generado desde cotización #${order.quotation_folio}.` : 'Pedido generado desde CRM.'
            }
        };
    }, []);

    const loadOrderItemsPreview = useCallback(async (order: EnrichedOrder) => {
        setOrderItemsPreviewState('loading');
        setOrderItemsPreview([]);
        setOrderItemsPreviewError(null);

        try {
            const { data, error } = await supabase
                .from('order_items')
                .select('id, quantity, unit_price, total_price, inventory(name, sku)')
                .eq('order_id', order.id)
                .order('id', { ascending: true });

            if (error) throw error;

            const items = (data || []).map((item: any) => ({
                sku: item.inventory?.sku || '',
                productName: item.inventory?.name || 'Producto',
                quantity: Number(item.quantity || 0),
                value: Number(item.total_price || (Number(item.unit_price || 0) * Number(item.quantity || 0)))
            }));

            setOrderItemsPreview(items);
            setOrderItemsPreviewState('ready');
        } catch (error: any) {
            console.error('Error loading order items preview:', error);
            setOrderItemsPreview([]);
            setOrderItemsPreviewState('error');
            setOrderItemsPreviewError(error?.message || 'No se pudo cargar el detalle del pedido.');
        }
    }, []);

    const openOrderItemsPreview = useCallback(async (order: EnrichedOrder) => {
        setSelectedItemsOrder(order);
        setOrderItemsPreviewState('idle');
        setOrderItemsPreview([]);
        setOrderItemsPreviewError(null);
        await loadOrderItemsPreview(order);
    }, [loadOrderItemsPreview]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (selectedItemsOrder?.id) {
            sessionStorage.setItem(ORDER_ITEMS_PREVIEW_STORAGE_KEY, selectedItemsOrder.id);
        } else {
            sessionStorage.removeItem(ORDER_ITEMS_PREVIEW_STORAGE_KEY);
        }
    }, [selectedItemsOrder?.id]);

    useEffect(() => {
        if (loading || !pendingItemsPreviewRestoreId || selectedItemsOrder) return;

        const restoredOrder = orders.find((order) => order.id === pendingItemsPreviewRestoreId);
        if (!restoredOrder) {
            if (typeof window !== 'undefined') {
                sessionStorage.removeItem(ORDER_ITEMS_PREVIEW_STORAGE_KEY);
            }
            setPendingItemsPreviewRestoreId(null);
            return;
        }

        setPendingItemsPreviewRestoreId(null);
        void openOrderItemsPreview(restoredOrder);
    }, [loading, openOrderItemsPreview, orders, pendingItemsPreviewRestoreId, selectedItemsOrder]);

    const loadOrderPdfPreview = useCallback(async (order: EnrichedOrder) => {
        setOrderPdfPreviewState('loading');
        setOrderPdfFile(null);
        setOrderPdfError(null);

        try {
            const { orderPdfData } = await buildOrderPdfPayload(order);
            const pdfFile = await generateOrderPdfFile(orderPdfData);

            if (orderPdfBlobUrl) {
                URL.revokeObjectURL(orderPdfBlobUrl);
            }

            const blobUrl = URL.createObjectURL(pdfFile);
            setOrderPdfFile(pdfFile);
            setOrderPdfBlobUrl(blobUrl);
            setOrderPdfPreviewState('ready');
        } catch (error: any) {
            console.error('Error loading order PDF preview:', error);
            setOrderPdfFile(null);
            setOrderPdfBlobUrl(null);
            setOrderPdfPreviewState('error');
            setOrderPdfError(error?.message || 'No se pudo generar el PDF del pedido.');
        }
    }, [buildOrderPdfPayload, orderPdfBlobUrl]);

    const openOrderPdfPreview = useCallback(async (order: EnrichedOrder) => {
        setSelectedOrderPdfOrder(order);
        cleanupOrderPdfPreview();
        await loadOrderPdfPreview(order);
    }, [cleanupOrderPdfPreview, loadOrderPdfPreview]);

    const handleResendOrderEmail = useCallback(async (order: EnrichedOrder) => {
        if (!profile?.id) {
            alert('No se pudo identificar al usuario actual.');
            return;
        }
        const canResend = canResendOrderEmail(effectiveRole, profile.id, order);
        if (!canResend) {
            alert('No tienes permisos para reenviar este correo.');
            return;
        }

        setResendingOrderId(order.id);
        try {
            const { orderRow, orderPdfData, creditDays } = await buildOrderPdfPayload(order);

            if (orderRow.payment_proof_path) {
                const { error: proofError } = await supabase.storage
                    .from(PAYMENT_PROOFS_BUCKET)
                    .download(orderRow.payment_proof_path);

                if (proofError) throw proofError;
            } else if (creditDays === 0) {
                throw new Error('El pedido no tiene un comprobante de pago guardado para reenviar.');
            }

            await sendOrderNotificationEmail({
                orderId: order.id,
                requestSource: 'manual_resend',
                order: orderPdfData
            });

            await fetchOrders();
            alert('Correo reenviado a facturación correctamente.');
        } catch (error: any) {
            const message = error?.message || 'No se pudo reenviar el correo';
            await fetchOrders();
            alert(message);
        } finally {
            setResendingOrderId(null);
        }
    }, [buildOrderPdfPayload, effectiveRole, fetchOrders, profile?.id]);

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
                                        {(() => {
                                            const orderLogs = notificationLogsByOrderId[order.id] || [];
                                            const latestLog = orderLogs[0] || null;
                                            const canResend = canResendOrderEmail(effectiveRole, profile?.id, order);
                                            const canRetryEmail = canResend && ['failed', 'pending'].includes(String(order.payment_email_status || '').toLowerCase());
                                            return (
                                                <>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => void openOrderItemsPreview(order)}
                                                className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-900 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-all"
                                            >
                                                #{order.folio ?? '-'}
                                            </button>
                                        </td>
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
                                                {latestLog && (
                                                    <div className="pt-1 space-y-1">
                                                        <p className="text-[11px] font-semibold text-gray-600">
                                                            Emisor: <span className="text-gray-800">{latestLog.sender_email}</span>
                                                        </p>
                                                        <p className="text-[11px] font-semibold text-gray-600 max-w-[260px] truncate" title={latestLog.to_recipients.join(', ')}>
                                                            Para: <span className="text-gray-800">{latestLog.to_recipients.join(', ')}</span>
                                                        </p>
                                                        <p className="text-[11px] font-semibold text-gray-500">
                                                            Último intento: {formatDate(latestLog.sent_at || latestLog.created_at)}
                                                        </p>
                                                    </div>
                                                )}
                                                {canRetryEmail ? (
                                                    <button
                                                        onClick={() => handleResendOrderEmail(order)}
                                                        disabled={resendingOrderId === order.id}
                                                        className="mt-2 inline-flex items-center px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-[11px] font-black uppercase tracking-wider hover:bg-red-100 transition-all disabled:opacity-50"
                                                    >
                                                        {resendingOrderId === order.id ? (
                                                            <div className="w-4 h-4 border-2 border-red-700 border-t-transparent animate-spin rounded-full" />
                                                        ) : (
                                                            <>
                                                                <Send size={14} className="mr-2" />
                                                                Reenviar correo
                                                            </>
                                                        )}
                                                    </button>
                                                ) : null}
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
                                            <div className="flex flex-col items-start gap-2">
                                                {order.payment_proof_path ? (
                                                    <button
                                                        onClick={() => openPaymentProofPreview(order)}
                                                        className="inline-flex items-center px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 transition-all"
                                                    >
                                                        <Eye size={14} className="mr-2" />
                                                        Ver comprobante
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-gray-400 font-medium">Sin comprobante</span>
                                                )}

                                                <button
                                                    onClick={() => void openOrderPdfPreview(order)}
                                                    className="inline-flex items-center px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 transition-all"
                                                >
                                                    <FileText size={14} className="mr-2" />
                                                    Ver PDF
                                                </button>

                                                <button
                                                    onClick={() => setSelectedNotificationOrder(order)}
                                                    className="inline-flex items-center px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 transition-all"
                                                >
                                                    <History size={14} className="mr-2" />
                                                    Historial correo
                                                </button>

                                                {canResend ? (
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
                                                ) : null}
                                            </div>
                                        </td>
                                                </>
                                            );
                                        })()}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <PaymentProofPreviewModal
                isOpen={Boolean(selectedProofOrder)}
                orderFolio={selectedProofOrder?.folio ?? null}
                clientName={selectedProofOrder?.client_name || 'Cliente'}
                fileName={proofFile?.name || selectedProofOrder?.payment_proof_name || null}
                blobUrl={proofBlobUrl}
                fileType={proofFile?.type || selectedProofOrder?.payment_proof_mime_type || null}
                loading={proofPreviewState === 'loading'}
                error={proofPreviewState === 'error' ? proofError : null}
                canDownload={Boolean(proofFile)}
                onClose={closeProofPreview}
                onRetry={() => {
                    if (selectedProofOrder) {
                        void loadProofForOrder(selectedProofOrder);
                    }
                }}
                onDownload={() => downloadProofFile(proofFile)}
            />

            <OrderPdfPreviewModal
                isOpen={Boolean(selectedOrderPdfOrder)}
                orderFolio={selectedOrderPdfOrder?.folio ?? null}
                clientName={selectedOrderPdfOrder?.client_name || 'Cliente'}
                fileName={orderPdfFile?.name || null}
                blobUrl={orderPdfBlobUrl}
                loading={orderPdfPreviewState === 'loading'}
                error={orderPdfPreviewState === 'error' ? orderPdfError : null}
                canDownload={Boolean(orderPdfFile)}
                onClose={closeOrderPdfPreview}
                onRetry={() => {
                    if (selectedOrderPdfOrder) {
                        void loadOrderPdfPreview(selectedOrderPdfOrder);
                    }
                }}
                onDownload={() => downloadProofFile(orderPdfFile)}
            />

            <OrderNotificationHistoryModal
                isOpen={Boolean(selectedNotificationOrder)}
                orderFolio={selectedNotificationOrder?.folio ?? null}
                clientName={selectedNotificationOrder?.client_name || 'Cliente'}
                logs={selectedNotificationOrder ? (notificationLogsByOrderId[selectedNotificationOrder.id] || []) : []}
                onClose={() => setSelectedNotificationOrder(null)}
            />

            <OrderItemsPreviewModal
                isOpen={Boolean(selectedItemsOrder)}
                orderFolio={selectedItemsOrder?.folio ?? null}
                clientName={selectedItemsOrder?.client_name || 'Cliente'}
                items={orderItemsPreview}
                loading={orderItemsPreviewState === 'loading'}
                error={orderItemsPreviewState === 'error' ? orderItemsPreviewError : null}
                onClose={closeOrderItemsPreview}
                onRetry={() => {
                    if (selectedItemsOrder) {
                        void loadOrderItemsPreview(selectedItemsOrder);
                    }
                }}
            />
        </div>
    );
};

export default Orders;
