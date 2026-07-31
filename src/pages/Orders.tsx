import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, FileText, History, PackageCheck, RefreshCw, RotateCcw, Search, ShoppingCart, Send, Truck } from 'lucide-react';
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
type DeliveryStatusFilter = 'all' | 'pending' | 'assigned' | 'out_for_delivery' | 'delivered' | 'courier_shipped';
type ViewMode = 'all' | 'mine';
type CourierProvider = 'chileexpress' | 'fedex';

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
    delivery_photo_url: string | null;
    shipment_method: string | null;
    courier_name: string | null;
    tracking_number: string | null;
    courier_marked_at: string | null;
};

const formatMoney = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const formatDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString('es-CL') : '-';
const PAYMENT_PROOFS_BUCKET = 'payment-proofs';
const ORDER_ITEMS_PREVIEW_STORAGE_KEY = 'orders.activeItemsPreviewOrderId';
const CHUNK_SIZE = 50;
const PAGE_SIZE = 10;
const isBillingBackofficeRole = (role: string | null | undefined) =>
    role === 'facturador' || role === 'tesorero';

const COURIER_OPTIONS: Array<{ value: CourierProvider; label: string }> = [
    { value: 'chileexpress', label: 'Chilexpress' },
    { value: 'fedex', label: 'FedEx' }
];

const normalizeDeliveryStatus = (status: string | null | undefined) => {
    const normalized = String(status || '').trim().toLowerCase();
    return normalized || 'pending';
};

const normalizeShipmentMethod = (value: string | null | undefined) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || 'local_dispatch';
};

const isCourierShipment = (order: Pick<EnrichedOrder, 'shipment_method'>) =>
    normalizeShipmentMethod(order.shipment_method) === 'courier';

const getCourierLabel = (courierName: string | null | undefined) => {
    const normalized = String(courierName || '').trim().toLowerCase();
    if (normalized === 'chileexpress') return 'Chilexpress';
    if (normalized === 'fedex') return 'FedEx';
    return courierName || 'Courier';
};

const chunkArray = <T,>(values: T[], size: number) => {
    if (values.length <= size) return [values];
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
};

const canResendOrderEmail = (
    effectiveRole: string | null | undefined,
    profileId: string | null | undefined,
    order: EnrichedOrder
) => {
    if (!profileId) return false;
    if (String(order.status || '').toLowerCase() === 'cancelled') return false;
    return effectiveRole === 'admin'
        || effectiveRole === 'seller'
        || isBillingBackofficeRole(effectiveRole)
        || order.user_id === profileId;
};

const canCancelOrder = (
    effectiveRole: string | null | undefined,
    profileId: string | null | undefined,
    order: EnrichedOrder
) => {
    if (!profileId) return false;
    return effectiveRole === 'admin'
        || effectiveRole === 'jefe'
        || isBillingBackofficeRole(effectiveRole)
        || order.user_id === profileId;
};

const canManageCourierShipment = (effectiveRole: string | null | undefined) =>
    effectiveRole === 'admin'
    || effectiveRole === 'jefe'
    || isBillingBackofficeRole(effectiveRole);

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

const getDeliveryStatusStyles = (status: string | null | undefined) => {
    switch (normalizeDeliveryStatus(status)) {
        case 'pending':
            return 'bg-gray-100 text-gray-600';
        case 'assigned':
            return 'bg-amber-100 text-amber-700';
        case 'out_for_delivery':
            return 'bg-indigo-100 text-indigo-700';
        case 'delivered':
            return 'bg-emerald-100 text-emerald-700';
        case 'courier_shipped':
            return 'bg-sky-100 text-sky-700';
        default:
            return 'bg-gray-100 text-gray-600';
    }
};

const getDeliveryStatusLabel = (status: string | null | undefined) => {
    switch (normalizeDeliveryStatus(status)) {
        case 'pending':
            return 'Pendiente';
        case 'assigned':
            return 'Asignado';
        case 'out_for_delivery':
            return 'En reparto';
        case 'delivered':
            return 'Entregado';
        case 'courier_shipped':
            return 'Encomienda enviada';
        default:
            return status || 'Pendiente';
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
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [viewMode, setViewMode] = useState<ViewMode>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [resendingOrderId, setResendingOrderId] = useState<string | null>(null);
    const [selectedProofOrder, setSelectedProofOrder] = useState<EnrichedOrder | null>(null);
    const [proofPreviewState, setProofPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [proofFile, setProofFile] = useState<File | null>(null);
    const [proofBlobUrl, setProofBlobUrl] = useState<string | null>(null);
    const [proofError, setProofError] = useState<string | null>(null);
    const [selectedDeliveryProofOrder, setSelectedDeliveryProofOrder] = useState<EnrichedOrder | null>(null);
    const [deliveryProofPreviewState, setDeliveryProofPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [deliveryProofFile, setDeliveryProofFile] = useState<File | null>(null);
    const [deliveryProofBlobUrl, setDeliveryProofBlobUrl] = useState<string | null>(null);
    const [deliveryProofError, setDeliveryProofError] = useState<string | null>(null);
    const [notificationLogsByOrderId, setNotificationLogsByOrderId] = useState<Record<string, OrderNotificationLog[]>>({});
    const [selectedNotificationOrder, setSelectedNotificationOrder] = useState<EnrichedOrder | null>(null);
    const [notificationHistoryLoading, setNotificationHistoryLoading] = useState(false);
    const [notificationHistoryError, setNotificationHistoryError] = useState<string | null>(null);
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
    const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
    const [courierModalOrder, setCourierModalOrder] = useState<EnrichedOrder | null>(null);
    const [courierProvider, setCourierProvider] = useState<CourierProvider>('chileexpress');
    const [trackingNumber, setTrackingNumber] = useState('');
    const [courierModalError, setCourierModalError] = useState<string | null>(null);
    const [savingCourierOrderId, setSavingCourierOrderId] = useState<string | null>(null);

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
                .select('id, folio, quotation_id, client_id, user_id, status, delivery_status, delivery_photo_url, total_amount, created_at, payment_email_status, payment_email_error, payment_proof_path, payment_proof_name, payment_proof_mime_type, shipment_method, courier_name, tracking_number, courier_marked_at')
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

            const fetchChunkedRows = async <TRow,>(
                table: 'clients' | 'profiles' | 'quotations',
                selectClause: string,
                ids: string[]
            ): Promise<TRow[]> => {
                if (ids.length === 0) return [];

                const chunks = chunkArray(ids, CHUNK_SIZE);
                const results = await Promise.all(
                    chunks.map(async (chunk) => {
                        const { data, error } = await supabase.from(table).select(selectClause).in('id', chunk);
                        if (error) throw error;
                        return (data || []) as TRow[];
                    })
                );

                return results.flat();
            };

            const [clientsRows, profilesRows, quotationsRows] = await Promise.all([
                fetchChunkedRows<any>('clients', 'id, name', clientIds),
                fetchChunkedRows<any>('profiles', 'id, full_name, email', userIds),
                fetchChunkedRows<any>('quotations', 'id, folio', quotationIds)
            ]);

            const clientsMap = new Map<string, any>(clientsRows.map((client: any) => [client.id, client]));
            const profilesMap = new Map<string, any>(profilesRows.map((profileRow: any) => [profileRow.id, profileRow]));
            const quotationsMap = new Map<string, any>(quotationsRows.map((quotation: any) => [quotation.id, quotation]));

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
                    payment_proof_mime_type: order.payment_proof_mime_type ?? null,
                    delivery_photo_url: order.delivery_photo_url ?? null,
                    shipment_method: order.shipment_method ?? null,
                    courier_name: order.courier_name ?? null,
                    tracking_number: order.tracking_number ?? null,
                    courier_marked_at: order.courier_marked_at ?? null
                };
            });

            setOrders(enriched);
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

    const openNotificationHistory = useCallback(async (order: EnrichedOrder) => {
        setSelectedNotificationOrder(order);
        setNotificationHistoryLoading(true);
        setNotificationHistoryError(null);

        if (notificationLogsByOrderId[order.id]) {
            setNotificationHistoryLoading(false);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('order_notification_logs')
                .select('id, order_id, sender_email, to_recipients, cc_recipients, status, gmail_message_id, gmail_thread_id, error_message, request_source, sent_at, created_at')
                .eq('order_id', order.id)
                .order('created_at', { ascending: false });

            if (error) throw error;

            setNotificationLogsByOrderId((prev) => ({
                ...prev,
                [order.id]: (data || []) as OrderNotificationLog[]
            }));
        } catch (error: any) {
            console.error('Error loading order notification history:', error);
            setNotificationHistoryError(error?.message || 'No se pudo cargar el historial de correos.');
        } finally {
            setNotificationHistoryLoading(false);
        }
    }, [notificationLogsByOrderId]);

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
            if (deliveryProofBlobUrl) {
                URL.revokeObjectURL(deliveryProofBlobUrl);
            }
        };
    }, [deliveryProofBlobUrl]);

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

    const cleanupDeliveryProofPreview = useCallback(() => {
        if (deliveryProofBlobUrl) {
            URL.revokeObjectURL(deliveryProofBlobUrl);
        }
        setDeliveryProofBlobUrl(null);
        setDeliveryProofFile(null);
        setDeliveryProofError(null);
        setDeliveryProofPreviewState('idle');
    }, [deliveryProofBlobUrl]);

    const closeDeliveryProofPreview = useCallback(() => {
        cleanupDeliveryProofPreview();
        setSelectedDeliveryProofOrder(null);
    }, [cleanupDeliveryProofPreview]);

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

    const loadDeliveryProofForOrder = useCallback(async (order: EnrichedOrder) => {
        if (!order.delivery_photo_url) {
            setDeliveryProofPreviewState('error');
            setDeliveryProofError('Este pedido no tiene una prueba de entrega guardada.');
            return;
        }

        setDeliveryProofPreviewState('loading');
        setDeliveryProofError(null);

        try {
            const response = await fetch(order.delivery_photo_url);
            if (!response.ok) {
                throw new Error('No se pudo descargar la prueba de entrega.');
            }
            const blob = await response.blob();

            if (deliveryProofBlobUrl) {
                URL.revokeObjectURL(deliveryProofBlobUrl);
            }

            const file = new File(
                [blob],
                `prueba_entrega_pedido_${order.folio ?? order.id}.jpg`,
                { type: blob.type || 'image/jpeg' }
            );
            const blobUrl = URL.createObjectURL(file);
            setDeliveryProofFile(file);
            setDeliveryProofBlobUrl(blobUrl);
            setDeliveryProofPreviewState('ready');
        } catch (error: any) {
            console.error('Error loading delivery proof:', error);
            setDeliveryProofFile(null);
            setDeliveryProofBlobUrl(null);
            setDeliveryProofPreviewState('error');
            setDeliveryProofError(error?.message || 'No se pudo descargar la prueba de entrega.');
        }
    }, [deliveryProofBlobUrl]);

    const openDeliveryProofPreview = useCallback(async (order: EnrichedOrder) => {
        setSelectedDeliveryProofOrder(order);
        setDeliveryProofFile(null);
        setDeliveryProofBlobUrl(null);
        setDeliveryProofError(null);
        setDeliveryProofPreviewState('idle');
        await loadDeliveryProofForOrder(order);
    }, [loadDeliveryProofForOrder]);

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
            .select('id, folio, client_id, user_id, total_amount, notes, payment_proof_path, payment_proof_name, payment_proof_mime_type')
            .eq('id', order.id)
            .single();

        if (orderError) throw orderError;

        const [clientRes, sellerRes, itemsRes, quotationRes] = await Promise.all([
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
                .eq('order_id', order.id),
            order.quotation_id
                ? supabase
                    .from('quotations')
                    .select('id, comments')
                    .eq('id', order.quotation_id)
                    .single()
                : Promise.resolve({ data: null, error: null })
        ]);

        if (clientRes.error) throw clientRes.error;
        if (sellerRes.error) throw sellerRes.error;
        if (itemsRes.error) throw itemsRes.error;
        if (quotationRes?.error) throw quotationRes.error;

        const client = clientRes.data;
        const seller = sellerRes.data;
        const creditDays = getClientCreditDays(client);
        const normalizedComments = String(orderRow.notes || '').trim()
            || String(quotationRes?.data?.comments || '').trim()
            || (order.quotation_folio ? `Pedido generado desde cotización #${order.quotation_folio}.` : 'Pedido generado desde CRM.');

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
                comments: normalizedComments
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

    const handleCancelOrder = useCallback(async (order: EnrichedOrder) => {
        if (!profile?.id) {
            alert('No se pudo identificar al usuario actual.');
            return;
        }

        const canCancel = canCancelOrder(effectiveRole, profile.id, order);
        if (!canCancel) {
            alert('No tienes permisos para cancelar este pedido.');
            return;
        }

        if (String(order.status || '').toLowerCase() === 'cancelled') {
            alert('Este pedido ya está cancelado.');
            return;
        }

        if (['assigned', 'out_for_delivery', 'delivered'].includes(String(order.delivery_status || '').toLowerCase())) {
            alert('Este pedido ya está en despacho o entregado y no puede reabrirse desde aquí.');
            return;
        }

        const reason = window.prompt(
            `Motivo de cancelación del pedido #${order.folio ?? order.id.slice(0, 8)}:`,
            'Comprobante adjunto por error'
        );

        if (reason === null) return;

        if (!window.confirm(`¿Cancelar el pedido #${order.folio ?? '-'} y reabrir la cotización #${order.quotation_folio ?? '-'}?`)) {
            return;
        }

        setCancellingOrderId(order.id);
        try {
            const { data, error } = await supabase.rpc('cancel_order_and_reopen_quotation', {
                p_order_id: order.id,
                p_reason: String(reason || '').trim() || null,
            });

            if (error) throw error;

            await fetchOrders();

            const response = (data || {}) as {
                quotation_folio?: number | null;
                quotation_status?: string | null;
                quotation_reopened?: boolean;
            };

            const reopenedLabel = response.quotation_reopened
                ? ` La cotización quedó nuevamente disponible con estado ${response.quotation_status || 'draft'}.`
                : '';

            alert(`Pedido #${order.folio ?? '-'} cancelado correctamente.${reopenedLabel}`);
        } catch (error: any) {
            console.error('Error cancelling order:', error);
            alert(error?.message || 'No se pudo cancelar el pedido.');
        } finally {
            setCancellingOrderId(null);
        }
    }, [effectiveRole, fetchOrders, profile?.id]);

    const closeCourierModal = useCallback(() => {
        setCourierModalOrder(null);
        setCourierProvider('chileexpress');
        setTrackingNumber('');
        setCourierModalError(null);
    }, []);

    const openCourierModal = useCallback((order: EnrichedOrder) => {
        setCourierModalOrder(order);
        const currentCourier = String(order.courier_name || '').trim().toLowerCase();
        setCourierProvider(currentCourier === 'fedex' ? 'fedex' : 'chileexpress');
        setTrackingNumber(String(order.tracking_number || '').trim());
        setCourierModalError(null);
    }, []);

    const handleSaveCourierShipment = useCallback(async () => {
        if (!courierModalOrder) return;
        if (!profile?.id) {
            setCourierModalError('No se pudo identificar al usuario actual.');
            return;
        }
        if (!canManageCourierShipment(effectiveRole)) {
            setCourierModalError('No tienes permisos para marcar encomiendas.');
            return;
        }

        const normalizedTracking = trackingNumber.trim();
        if (!normalizedTracking) {
            setCourierModalError('Debes ingresar el número de seguimiento.');
            return;
        }

        setSavingCourierOrderId(courierModalOrder.id);
        setCourierModalError(null);

        try {
            const isDelivered = normalizeDeliveryStatus(courierModalOrder.delivery_status) === 'delivered';
            const { error } = await supabase
                .from('orders')
                .update({
                    shipment_method: 'courier',
                    courier_name: courierProvider,
                    tracking_number: normalizedTracking,
                    courier_marked_at: new Date().toISOString(),
                    courier_marked_by: profile.id,
                    delivery_status: isDelivered ? 'delivered' : 'courier_shipped'
                })
                .eq('id', courierModalOrder.id);

            if (error) throw error;

            await fetchOrders();
            closeCourierModal();
            alert(`Pedido #${courierModalOrder.folio ?? '-'} marcado como encomienda correctamente.`);
        } catch (error: any) {
            console.error('Error saving courier shipment:', error);
            setCourierModalError(error?.message || 'No se pudo guardar la encomienda.');
        } finally {
            setSavingCourierOrderId(null);
        }
    }, [closeCourierModal, courierModalOrder, courierProvider, effectiveRole, fetchOrders, profile?.id, trackingNumber]);

    const filteredOrders = useMemo(() => {
        const term = search.trim().toLowerCase();
        return orders.filter((order) => {
            const matchesSearch = !term
                || (order.client_name || '').toLowerCase().includes(term)
                || (order.seller_name || '').toLowerCase().includes(term)
                || String(order.folio || '').includes(term)
                || String(order.quotation_folio || '').includes(term);

            const matchesOrderStatus = orderStatusFilter === 'all' || (order.status || '').toLowerCase() === orderStatusFilter;
            const matchesDeliveryStatus = deliveryStatusFilter === 'all' || normalizeDeliveryStatus(order.delivery_status) === deliveryStatusFilter;
            const matchesView = viewMode === 'all' || order.user_id === profile?.id;
            const orderTimestamp = order.created_at ? new Date(order.created_at).getTime() : null;
            const matchesDateFrom = !dateFrom || (orderTimestamp !== null && orderTimestamp >= new Date(`${dateFrom}T00:00:00`).getTime());
            const matchesDateTo = !dateTo || (orderTimestamp !== null && orderTimestamp <= new Date(`${dateTo}T23:59:59`).getTime());

            return matchesSearch && matchesOrderStatus && matchesDeliveryStatus && matchesView && matchesDateFrom && matchesDateTo;
        });
    }, [dateFrom, dateTo, deliveryStatusFilter, orderStatusFilter, orders, profile?.id, search, viewMode]);

    useEffect(() => {
        setCurrentPage(1);
    }, [search, orderStatusFilter, deliveryStatusFilter, viewMode, dateFrom, dateTo]);

    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
    const paginatedOrders = useMemo(() => {
        const safePage = Math.min(currentPage, totalPages);
        const start = (safePage - 1) * PAGE_SIZE;
        return filteredOrders.slice(start, start + PAGE_SIZE);
    }, [currentPage, filteredOrders, totalPages]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const orderStats = useMemo(() => {
        const completed = filteredOrders.filter((o) => (o.status || '').toLowerCase() === 'completed').length;
        const delivered = filteredOrders.filter((o) => normalizeDeliveryStatus(o.delivery_status) === 'delivered').length;
        const billedAmount = filteredOrders
            .filter((o) => (o.status || '').toLowerCase() !== 'cancelled')
            .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
        return { total: filteredOrders.length, completed, delivered, billedAmount };
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
                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Monto Facturado</p>
                    <p className="text-3xl font-black text-gray-900 mt-2">{formatMoney(orderStats.billedAmount)}</p>
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

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:min-w-[320px]">
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                            aria-label="Fecha desde"
                        />
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                            aria-label="Fecha hasta"
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

                {(dateFrom || dateTo) && (
                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
                        <p className="text-xs font-bold text-indigo-700">
                            Periodo seleccionado: {dateFrom || 'inicio'} a {dateTo || 'hoy'}
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                setDateFrom('');
                                setDateTo('');
                            }}
                            className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wider text-indigo-700 transition hover:bg-indigo-100"
                        >
                            Limpiar fechas
                        </button>
                    </div>
                )}

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
                        { key: 'assigned', label: 'Despacho: Asignado' },
                        { key: 'out_for_delivery', label: 'Despacho: En reparto' },
                        { key: 'delivered', label: 'Despacho: Entregado' },
                        { key: 'courier_shipped', label: 'Despacho: Encomienda' }
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
                    <div className="space-y-4">
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
                                {paginatedOrders.map((order) => (
                                    <tr key={order.id} className="border-b border-gray-100 last:border-0">
                                        {(() => {
                                            const canResend = canResendOrderEmail(effectiveRole, profile?.id, order);
                                            const canRetryEmail = canResend && ['failed', 'pending'].includes(String(order.payment_email_status || '').toLowerCase());
                                            const canCancel = canCancelOrder(effectiveRole, profile?.id, order);
                                            const canManageCourier = canManageCourierShipment(effectiveRole);
                                            const isCancelled = String(order.status || '').toLowerCase() === 'cancelled';
                                            const isDispatchLocked = ['assigned', 'out_for_delivery', 'delivered'].includes(String(order.delivery_status || '').toLowerCase());
                                            const hasCourier = isCourierShipment(order);
                                            const canEditCourier = canManageCourier && !isCancelled && (!isDispatchLocked || hasCourier);
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
                                            <div className="space-y-1">
                                                <span className={`px-2 py-1 rounded-full text-[10px] font-black uppercase ${getDeliveryStatusStyles(order.delivery_status)}`}>
                                                    {getDeliveryStatusLabel(order.delivery_status)}
                                                </span>
                                                {hasCourier ? (
                                                    <div className="space-y-1">
                                                        <p className="text-[11px] font-black text-sky-700">
                                                            {getCourierLabel(order.courier_name)}
                                                        </p>
                                                        <p className="text-[11px] font-medium text-gray-500 break-all">
                                                            Seguimiento: {order.tracking_number || 'Sin número'}
                                                        </p>
                                                    </div>
                                                ) : null}
                                            </div>
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

                                                {order.delivery_photo_url ? (
                                                    <button
                                                        onClick={() => void openDeliveryProofPreview(order)}
                                                        className="inline-flex items-center px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase tracking-wider hover:bg-emerald-100 transition-all"
                                                    >
                                                        <Eye size={14} className="mr-2" />
                                                        Ver entrega
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-gray-400 font-medium">Sin prueba de entrega</span>
                                                )}

                                                <button
                                                    onClick={() => void openOrderPdfPreview(order)}
                                                    className="inline-flex items-center px-3 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-[11px] font-black uppercase tracking-wider hover:bg-gray-50 transition-all"
                                                >
                                                    <FileText size={14} className="mr-2" />
                                                    Ver PDF
                                                </button>

                                                <button
                                                    onClick={() => void openNotificationHistory(order)}
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

                                                {canManageCourier ? (
                                                    <button
                                                        onClick={() => openCourierModal(order)}
                                                        disabled={!canEditCourier || savingCourierOrderId === order.id}
                                                        title={
                                                            !canEditCourier
                                                                ? 'No se puede marcar encomienda en un pedido ya tomado por despacho local o cancelado.'
                                                                : hasCourier
                                                                    ? 'Editar datos de encomienda'
                                                                    : 'Marcar pedido enviado por encomienda'
                                                        }
                                                        className="inline-flex items-center px-3 py-2 rounded-xl border border-sky-200 bg-sky-50 text-sky-700 text-[11px] font-black uppercase tracking-wider hover:bg-sky-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {savingCourierOrderId === order.id ? (
                                                            <div className="w-4 h-4 border-2 border-sky-700 border-t-transparent animate-spin rounded-full" />
                                                        ) : (
                                                            <>
                                                                <Truck size={14} className="mr-2" />
                                                                {hasCourier ? 'Editar encomienda' : 'Marcar encomienda'}
                                                            </>
                                                        )}
                                                    </button>
                                                ) : null}

                                                {canCancel ? (
                                                    <button
                                                        onClick={() => handleCancelOrder(order)}
                                                        disabled={isCancelled || isDispatchLocked || cancellingOrderId === order.id}
                                                        title={
                                                            isCancelled
                                                                ? 'Este pedido ya fue cancelado.'
                                                                : isDispatchLocked
                                                                    ? 'No se puede cancelar un pedido ya asignado a despacho o entregado.'
                                                                    : 'Cancelar pedido y reabrir cotización'
                                                        }
                                                        className="inline-flex items-center px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-[11px] font-black uppercase tracking-wider hover:bg-amber-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {cancellingOrderId === order.id ? (
                                                            <div className="w-4 h-4 border-2 border-amber-700 border-t-transparent animate-spin rounded-full" />
                                                        ) : (
                                                            <>
                                                                <RotateCcw size={14} className="mr-2" />
                                                                Cancelar
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
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <p className="text-xs font-bold text-gray-500">
                            Mostrando {paginatedOrders.length} de {filteredOrders.length} pedido(s) filtrados. Página {Math.min(currentPage, totalPages)} de {totalPages}.
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                                disabled={currentPage <= 1}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-gray-700 transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Anterior
                            </button>
                            <div className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-black uppercase tracking-wider text-gray-700">
                                {Math.min(currentPage, totalPages)} / {totalPages}
                            </div>
                            <button
                                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                                disabled={currentPage >= totalPages}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-gray-700 transition-all hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Siguiente
                            </button>
                        </div>
                    </div>
                    </div>
                )}
            </div>

            <PaymentProofPreviewModal
                isOpen={Boolean(selectedProofOrder)}
                orderFolio={selectedProofOrder?.folio ?? null}
                clientName={selectedProofOrder?.client_name || 'Cliente'}
                title="Comprobante de pago"
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

            <PaymentProofPreviewModal
                isOpen={Boolean(selectedDeliveryProofOrder)}
                orderFolio={selectedDeliveryProofOrder?.folio ?? null}
                clientName={selectedDeliveryProofOrder?.client_name || 'Cliente'}
                title="Prueba de entrega"
                fileName={deliveryProofFile?.name || null}
                blobUrl={deliveryProofBlobUrl}
                fileType={deliveryProofFile?.type || 'image/jpeg'}
                loading={deliveryProofPreviewState === 'loading'}
                error={deliveryProofPreviewState === 'error' ? deliveryProofError : null}
                canDownload={Boolean(deliveryProofFile)}
                onClose={closeDeliveryProofPreview}
                onRetry={() => {
                    if (selectedDeliveryProofOrder) {
                        void loadDeliveryProofForOrder(selectedDeliveryProofOrder);
                    }
                }}
                onDownload={() => downloadProofFile(deliveryProofFile)}
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
                loading={notificationHistoryLoading}
                error={notificationHistoryError}
                onClose={() => {
                    setSelectedNotificationOrder(null);
                    setNotificationHistoryLoading(false);
                    setNotificationHistoryError(null);
                }}
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

            {courierModalOrder ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
                    <div className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl shadow-slate-900/20">
                        <div className="flex items-start gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                                <PackageCheck size={26} />
                            </div>
                            <div className="flex-1">
                                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-600">Encomienda</p>
                                <h3 className="mt-1 text-2xl font-black text-slate-900">
                                    Pedido #{courierModalOrder.folio ?? '-'}
                                </h3>
                                <p className="mt-2 text-sm font-medium text-slate-500">
                                    Registra el courier y el número de seguimiento para este pedido.
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                                    Courier
                                </label>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {COURIER_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => setCourierProvider(option.value)}
                                            className={`rounded-2xl border px-4 py-4 text-left transition-all ${courierProvider === option.value ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                                        >
                                            <p className="text-sm font-black">{option.label}</p>
                                            <p className="mt-1 text-xs font-medium text-slate-400">Seleccionar courier</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label htmlFor="tracking-number" className="mb-2 block text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">
                                    Número de seguimiento
                                </label>
                                <input
                                    id="tracking-number"
                                    value={trackingNumber}
                                    onChange={(event) => setTrackingNumber(event.target.value)}
                                    placeholder="Ej. 123456789CL"
                                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-200"
                                />
                            </div>

                            {courierModalError ? (
                                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                                    {courierModalError}
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={closeCourierModal}
                                disabled={savingCourierOrderId === courierModalOrder.id}
                                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleSaveCourierShipment()}
                                disabled={savingCourierOrderId === courierModalOrder.id}
                                className="inline-flex items-center justify-center rounded-2xl bg-sky-600 px-5 py-3 text-sm font-black text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {savingCourierOrderId === courierModalOrder.id ? (
                                    <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                                ) : (
                                    <>
                                        <Truck size={16} className="mr-2" />
                                        Guardar encomienda
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export default Orders;
