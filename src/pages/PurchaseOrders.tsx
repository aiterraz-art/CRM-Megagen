import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    Eye,
    FilePlus2,
    Mail,
    Package,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    ShoppingBag,
    Trash2,
    Truck,
    Users,
    X,
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Database } from '../types/supabase';
import { generatePurchaseOrderPdfFile, type PurchaseOrderPdfData } from '../utils/purchaseOrderPdf';
import { sendPurchaseOrderNotificationEmail } from '../utils/purchaseOrderEmail';
import { uploadFileToStorage } from '../utils/storageUpload';

type SupplierRow = Database['public']['Tables']['suppliers']['Row'];
type InventoryRow = Database['public']['Tables']['inventory']['Row'];
type PurchaseOrderRow = Database['public']['Tables']['purchase_orders']['Row'];
type PurchaseOrderItemRow = Database['public']['Tables']['purchase_order_items']['Row'];
type PurchaseOrderEmailLogRow = Database['public']['Tables']['purchase_order_email_logs']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type PurchaseOrderStatus = PurchaseOrderRow['status'];
type PurchaseOrderCurrency = PurchaseOrderRow['currency'];
type PageTab = 'orders' | 'suppliers';

type SupplierFormState = {
    id?: string;
    name: string;
    email: string;
    contact_name: string;
    phone: string;
    tax_id: string;
    country: string;
    city: string;
    address: string;
    preferred_currency: '' | 'CLP' | 'USD';
    notes: string;
    status: 'active' | 'inactive';
};

type PurchaseOrderLineForm = {
    localId: string;
    inventoryId: string;
    productSearch: string;
    qty: number;
    unitPrice: number;
    discountAmount: number;
    lineNotes: string;
};

type PurchaseOrderFormState = {
    supplierId: string;
    currency: 'CLP' | 'USD';
    neededByDate: string;
    generalNotes: string;
    lines: PurchaseOrderLineForm[];
};

type PurchaseOrderView = PurchaseOrderRow & {
    items: PurchaseOrderItemRow[];
    emailLogs: PurchaseOrderEmailLogRow[];
    supplier: SupplierRow | null;
    createdByProfile: ProfileRow | null;
    sentByProfile: ProfileRow | null;
};

const PURCHASE_ORDER_PDF_BUCKET = 'purchase-order-pdfs';

const createEmptySupplierForm = (): SupplierFormState => ({
    name: '',
    email: '',
    contact_name: '',
    phone: '',
    tax_id: '',
    country: '',
    city: '',
    address: '',
    preferred_currency: '',
    notes: '',
    status: 'active',
});

const createEmptyOrderLine = (): PurchaseOrderLineForm => ({
    localId: crypto.randomUUID(),
    inventoryId: '',
    productSearch: '',
    qty: 1,
    unitPrice: 0,
    discountAmount: 0,
    lineNotes: '',
});

const createEmptyOrderForm = (): PurchaseOrderFormState => ({
    supplierId: '',
    currency: 'CLP',
    neededByDate: '',
    generalNotes: '',
    lines: [createEmptyOrderLine()],
});

const formatCurrency = (value: number | null | undefined, currency: 'CLP' | 'USD' = 'CLP') =>
    new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency,
        minimumFractionDigits: currency === 'CLP' ? 0 : 2,
        maximumFractionDigits: currency === 'CLP' ? 0 : 2,
    }).format(Number(value || 0));

const formatDate = (value?: string | null) => {
    if (!value) return 'Sin fecha';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Sin fecha';
    return date.toLocaleDateString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
};

const formatDateTime = (value?: string | null) => {
    if (!value) return 'Sin registro';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Sin registro';
    return date.toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatFolio = (folio?: number | null) => `OC-${String(folio || 0).padStart(6, '0')}`;

const getUserLabel = (profile?: ProfileRow | null) => {
    if (!profile) return 'Sin responsable';
    if (profile.full_name?.trim()) return profile.full_name.trim();
    return profile.email?.split('@')[0] || 'Sin nombre';
};

const statusLabelMap: Record<string, string> = {
    draft: 'Borrador',
    sent: 'Enviada',
    send_failed: 'Error Envío',
    cancelled: 'Cancelada',
};

const statusStyleMap: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    send_failed: 'bg-rose-50 text-rose-700 border-rose-200',
    cancelled: 'bg-amber-50 text-amber-700 border-amber-200',
};

const emailStatusLabelMap: Record<string, string> = {
    pending: 'Pendiente',
    sent: 'Enviado',
    failed: 'Fallido',
    not_sent: 'No enviado',
};

const emailStatusStyleMap: Record<string, string> = {
    pending: 'bg-sky-50 text-sky-700 border-sky-200',
    sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed: 'bg-rose-50 text-rose-700 border-rose-200',
    not_sent: 'bg-slate-100 text-slate-700 border-slate-200',
};

const PurchaseOrders: React.FC = () => {
    const { profile, hasPermission } = useUser();
    const canManage = hasPermission('MANAGE_PURCHASE_ORDERS');
    const location = useLocation();
    const navigate = useNavigate();
    const defaultTabFromRoute: PageTab = location.pathname === '/suppliers' ? 'suppliers' : 'orders';

    const [activeTab, setActiveTab] = useState<PageTab>(defaultTabFromRoute);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [inventoryItems, setInventoryItems] = useState<InventoryRow[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderView[]>([]);
    const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrderView | null>(null);
    const [showSupplierModal, setShowSupplierModal] = useState(false);
    const [showOrderModal, setShowOrderModal] = useState(false);
    const [supplierForm, setSupplierForm] = useState<SupplierFormState>(createEmptySupplierForm());
    const [orderForm, setOrderForm] = useState<PurchaseOrderFormState>(createEmptyOrderForm());
    const [supplierSearch, setSupplierSearch] = useState('');
    const [orderSearch, setOrderSearch] = useState('');
    const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | PurchaseOrderStatus>('all');
    const [orderCurrencyFilter, setOrderCurrencyFilter] = useState<'all' | PurchaseOrderCurrency>('all');
    const [orderSupplierFilter, setOrderSupplierFilter] = useState<'all' | string>('all');
    const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
    const [resendingOrderId, setResendingOrderId] = useState<string | null>(null);

    const fetchModuleData = useCallback(async (showLoader = true) => {
        if (showLoader) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }

        try {
            const [suppliersRes, inventoryRes, purchaseOrdersRes] = await Promise.all([
                supabase.from('suppliers').select('*').order('name', { ascending: true }),
                supabase
                    .from('inventory')
                    .select('id, sku, name, price, stock_qty, category, is_service_item, min_stock_alert, target_coverage_days, last_stock_reviewed_at, last_stock_reviewed_by, supplier_id, created_at')
                    .or('is_service_item.is.null,is_service_item.eq.false')
                    .order('name', { ascending: true }),
                supabase.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(200),
            ]);

            if (suppliersRes.error) throw suppliersRes.error;
            if (inventoryRes.error) throw inventoryRes.error;
            if (purchaseOrdersRes.error) throw purchaseOrdersRes.error;

            const supplierRows = (suppliersRes.data || []) as SupplierRow[];
            const inventoryRows = (inventoryRes.data || []) as InventoryRow[];
            const orderRows = (purchaseOrdersRes.data || []) as PurchaseOrderRow[];

            const orderIds = orderRows.map((order) => order.id);
            const profileIds = Array.from(
                new Set(
                    orderRows
                        .flatMap((order) => [order.created_by, order.sent_by])
                        .filter(Boolean) as string[]
                )
            );

            const [itemsRes, logsRes, profilesRes] = await Promise.all([
                orderIds.length
                    ? supabase
                        .from('purchase_order_items')
                        .select('*')
                        .in('purchase_order_id', orderIds)
                    : Promise.resolve({ data: [], error: null } as const),
                orderIds.length
                    ? supabase
                        .from('purchase_order_email_logs')
                        .select('*')
                        .in('purchase_order_id', orderIds)
                        .order('created_at', { ascending: false })
                    : Promise.resolve({ data: [], error: null } as const),
                profileIds.length
                    ? supabase.from('profiles').select('*').in('id', profileIds)
                    : Promise.resolve({ data: [], error: null } as const),
            ]);

            if (itemsRes.error) throw itemsRes.error;
            if (logsRes.error) throw logsRes.error;
            if (profilesRes.error) throw profilesRes.error;

            const itemsByOrderId = new Map<string, PurchaseOrderItemRow[]>();
            for (const item of (itemsRes.data || []) as PurchaseOrderItemRow[]) {
                const current = itemsByOrderId.get(item.purchase_order_id) || [];
                current.push(item);
                itemsByOrderId.set(item.purchase_order_id, current);
            }

            const logsByOrderId = new Map<string, PurchaseOrderEmailLogRow[]>();
            for (const log of (logsRes.data || []) as PurchaseOrderEmailLogRow[]) {
                const current = logsByOrderId.get(log.purchase_order_id) || [];
                current.push(log);
                logsByOrderId.set(log.purchase_order_id, current);
            }

            const profileMap = new Map<string, ProfileRow>(
                ((profilesRes.data || []) as ProfileRow[]).map((item) => [item.id, item])
            );
            const supplierMap = new Map<string, SupplierRow>(supplierRows.map((item) => [item.id, item]));

            const ordersView = orderRows.map<PurchaseOrderView>((order) => ({
                ...order,
                items: itemsByOrderId.get(order.id) || [],
                emailLogs: logsByOrderId.get(order.id) || [],
                supplier: supplierMap.get(order.supplier_id) || null,
                createdByProfile: profileMap.get(order.created_by) || null,
                sentByProfile: order.sent_by ? (profileMap.get(order.sent_by) || null) : null,
            }));

            setSuppliers(supplierRows);
            setInventoryItems(inventoryRows);
            setPurchaseOrders(ordersView);
            setSelectedPurchaseOrder((current) =>
                current ? ordersView.find((item) => item.id === current.id) || null : null
            );
        } catch (error: any) {
            console.error('Error loading purchase orders module:', error);
            alert(`Error cargando órdenes de compra: ${error.message}`);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void fetchModuleData();
    }, [fetchModuleData]);

    useEffect(() => {
        setActiveTab(defaultTabFromRoute);
    }, [defaultTabFromRoute]);

    const activeSuppliers = useMemo(
        () => suppliers.filter((supplier) => supplier.status === 'active'),
        [suppliers]
    );

    const inventoryMap = useMemo(
        () => new Map(inventoryItems.map((item) => [item.id, item])),
        [inventoryItems]
    );

    const selectedSupplier = useMemo(
        () => suppliers.find((supplier) => supplier.id === orderForm.supplierId) || null,
        [suppliers, orderForm.supplierId]
    );
    const availableInventoryItems = useMemo(() => {
        if (!selectedSupplier) return inventoryItems;
        return inventoryItems.filter((item) => item.supplier_id === selectedSupplier.id);
    }, [inventoryItems, selectedSupplier]);

    useEffect(() => {
        if (selectedSupplier?.preferred_currency && !showOrderModal) {
            return;
        }

        if (selectedSupplier?.preferred_currency && showOrderModal) {
            setOrderForm((current) => ({
                ...current,
                currency: selectedSupplier.preferred_currency as 'CLP' | 'USD',
            }));
        }
    }, [selectedSupplier?.preferred_currency, showOrderModal]);

    const filteredSuppliers = useMemo(() => {
        const normalizedSearch = supplierSearch.trim().toLowerCase();
        return suppliers.filter((supplier) => {
            if (!normalizedSearch) return true;
            return [
                supplier.name,
                supplier.email,
                supplier.contact_name,
                supplier.tax_id,
                supplier.city,
                supplier.country,
            ]
                .map((value) => String(value || '').toLowerCase())
                .some((value) => value.includes(normalizedSearch));
        });
    }, [supplierSearch, suppliers]);

    const filteredPurchaseOrders = useMemo(() => {
        const normalizedSearch = orderSearch.trim().toLowerCase();
        return purchaseOrders.filter((order) => {
            if (orderStatusFilter !== 'all' && order.status !== orderStatusFilter) return false;
            if (orderCurrencyFilter !== 'all' && order.currency !== orderCurrencyFilter) return false;
            if (orderSupplierFilter !== 'all' && order.supplier_id !== orderSupplierFilter) return false;

            if (!normalizedSearch) return true;

            const searchTargets = [
                formatFolio(order.folio),
                order.supplier_name_snapshot,
                order.supplier_email_snapshot,
                getUserLabel(order.createdByProfile),
                ...order.items.flatMap((item) => [item.sku_snapshot, item.product_name_snapshot]),
            ].map((value) => String(value || '').toLowerCase());

            return searchTargets.some((value) => value.includes(normalizedSearch));
        });
    }, [orderCurrencyFilter, orderSearch, orderStatusFilter, orderSupplierFilter, purchaseOrders]);

    const orderMetrics = useMemo(() => {
        const total = purchaseOrders.length;
        const sent = purchaseOrders.filter((order) => order.status === 'sent').length;
        const failed = purchaseOrders.filter((order) => order.status === 'send_failed').length;
        const totalAmount = purchaseOrders.reduce((acc, order) => acc + Number(order.total_amount || 0), 0);
        return { total, sent, failed, totalAmount };
    }, [purchaseOrders]);

    const supplierMetrics = useMemo(() => ({
        total: suppliers.length,
        active: suppliers.filter((supplier) => supplier.status === 'active').length,
    }), [suppliers]);

    const pageTitle = activeTab === 'suppliers' ? 'Proveedores' : 'Órdenes de Compra';
    const pageDescription = activeTab === 'suppliers'
        ? 'Administra la base de proveedores para abastecimiento y futuras órdenes de compra.'
        : 'Gestiona proveedores y emite OC formales desde abastecimiento con envío directo por Gmail.';

    const orderLineDetails = useMemo(() => orderForm.lines.map((line) => {
        const product = inventoryMap.get(line.inventoryId) || null;
        const gross = line.qty * line.unitPrice;
        const discount = Math.max(0, line.discountAmount);
        const lineTotal = Math.max(0, gross - discount);
        return {
            ...line,
            product,
            sku: product?.sku?.trim() || 'SIN-SKU',
            name: product?.name?.trim() || 'Producto sin seleccionar',
            lineTotal,
        };
    }), [inventoryMap, orderForm.lines]);

    const orderFormTotals = useMemo(() => {
        const subtotal = orderLineDetails.reduce((acc, line) => acc + (line.qty * line.unitPrice), 0);
        const totalDiscount = orderLineDetails.reduce((acc, line) => acc + Math.max(0, line.discountAmount), 0);
        return {
            subtotal,
            totalDiscount,
            totalAmount: subtotal - totalDiscount,
        };
    }, [orderLineDetails]);

    const resetSupplierModal = () => {
        setEditingSupplierId(null);
        setSupplierForm(createEmptySupplierForm());
        setShowSupplierModal(false);
    };

    const resetOrderModal = () => {
        setOrderForm(createEmptyOrderForm());
        setShowOrderModal(false);
    };

    const openCreateSupplierModal = () => {
        setEditingSupplierId(null);
        setSupplierForm(createEmptySupplierForm());
        setShowSupplierModal(true);
    };

    const openEditSupplierModal = (supplier: SupplierRow) => {
        setEditingSupplierId(supplier.id);
        setSupplierForm({
            id: supplier.id,
            name: supplier.name,
            email: supplier.email,
            contact_name: supplier.contact_name || '',
            phone: supplier.phone || '',
            tax_id: supplier.tax_id || '',
            country: supplier.country || '',
            city: supplier.city || '',
            address: supplier.address || '',
            preferred_currency: (supplier.preferred_currency as '' | 'CLP' | 'USD') || '',
            notes: supplier.notes || '',
            status: supplier.status as 'active' | 'inactive',
        });
        setShowSupplierModal(true);
    };

    const openCreateOrderModal = () => {
        setOrderForm(createEmptyOrderForm());
        setShowOrderModal(true);
    };

    const handleSupplierSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!profile?.id) {
            alert('No se pudo identificar al usuario creador.');
            return;
        }

        const name = supplierForm.name.trim();
        const email = supplierForm.email.trim().toLowerCase();
        if (!name || !email) {
            alert('Proveedor y correo principal son obligatorios.');
            return;
        }

        setSubmitting(true);
        try {
            const payload: Database['public']['Tables']['suppliers']['Insert'] = {
                name,
                email,
                contact_name: supplierForm.contact_name.trim() || null,
                phone: supplierForm.phone.trim() || null,
                tax_id: supplierForm.tax_id.trim() || null,
                country: supplierForm.country.trim() || null,
                city: supplierForm.city.trim() || null,
                address: supplierForm.address.trim() || null,
                preferred_currency: supplierForm.preferred_currency || null,
                notes: supplierForm.notes.trim() || null,
                status: supplierForm.status,
                created_by: profile.id,
                updated_at: new Date().toISOString(),
            };

            if (editingSupplierId) {
                const { error } = await supabase
                    .from('suppliers')
                    .update({
                        ...payload,
                        created_by: undefined,
                    } as Database['public']['Tables']['suppliers']['Update'])
                    .eq('id', editingSupplierId);
                if (error) throw error;
                alert('Proveedor actualizado correctamente.');
            } else {
                const { error } = await supabase.from('suppliers').insert(payload);
                if (error) throw error;
                alert('Proveedor creado correctamente.');
            }

            resetSupplierModal();
            await fetchModuleData(false);
        } catch (error: any) {
            console.error('Error saving supplier:', error);
            alert(`No se pudo guardar el proveedor: ${error.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeleteSupplier = async (supplier: SupplierRow) => {
        if (!window.confirm(`¿Eliminar el proveedor ${supplier.name}?`)) return;

        try {
            const { error } = await supabase.from('suppliers').delete().eq('id', supplier.id);
            if (error) throw error;
            await fetchModuleData(false);
        } catch (error: any) {
            console.error('Error deleting supplier:', error);
            alert(`No se pudo eliminar el proveedor. Si ya tiene OCs asociadas, déjalo inactivo. Detalle: ${error.message}`);
        }
    };

    const updateOrderLine = (localId: string, field: keyof PurchaseOrderLineForm, value: string | number) => {
        setOrderForm((current) => ({
            ...current,
            lines: current.lines.map((line) => {
                if (line.localId !== localId) return line;
                const nextLine = { ...line, [field]: value } as PurchaseOrderLineForm;
                if (field === 'inventoryId') {
                    const product = inventoryMap.get(String(value));
                    if (product) {
                        nextLine.productSearch = `${product.sku?.trim() || 'SIN-SKU'} · ${product.name}`;
                        nextLine.unitPrice = Number(product.price || 0);
                    }
                }
                return nextLine;
            }),
        }));
    };

    const addOrderLine = () => {
        setOrderForm((current) => ({
            ...current,
            lines: [...current.lines, createEmptyOrderLine()],
        }));
    };

    const removeOrderLine = (localId: string) => {
        setOrderForm((current) => ({
            ...current,
            lines: current.lines.length === 1
                ? current.lines
                : current.lines.filter((line) => line.localId !== localId),
        }));
    };

    const buildPurchaseOrderPdfData = useCallback((
        order: PurchaseOrderRow,
        items: PurchaseOrderItemRow[],
        supplier: SupplierRow | null,
        createdByProfile: ProfileRow | null
    ): PurchaseOrderPdfData => ({
        folio: order.folio,
        formattedFolio: formatFolio(order.folio),
        issuedDate: formatDate(order.issued_at),
        neededByDate: order.needed_by_date ? formatDate(order.needed_by_date) : null,
        supplierName: order.supplier_name_snapshot,
        supplierEmail: order.supplier_email_snapshot,
        supplierContact: supplier?.contact_name || null,
        supplierPhone: supplier?.phone || null,
        supplierTaxId: supplier?.tax_id || null,
        supplierAddress: supplier?.address || null,
        supplierCity: supplier?.city || null,
        supplierCountry: supplier?.country || null,
        currency: order.currency as 'CLP' | 'USD',
        createdByName: getUserLabel(createdByProfile),
        createdByEmail: createdByProfile?.email || null,
        items: items.map((item) => ({
            sku: item.sku_snapshot || 'SIN-SKU',
            productName: item.product_name_snapshot,
            qty: Number(item.qty || 0),
            unitPrice: Number(item.unit_price || 0),
            discountAmount: Number(item.discount_amount || 0),
            lineTotal: Number(item.line_total || 0),
            lineNotes: item.line_notes || null,
        })),
        subtotal: Number(order.subtotal || 0),
        totalDiscount: Number(order.total_discount || 0),
        totalAmount: Number(order.total_amount || 0),
        generalNotes: order.general_notes || null,
    }), []);

    const handleCreatePurchaseOrder = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!selectedSupplier) {
            alert('Debes seleccionar un proveedor activo.');
            return;
        }

        const normalizedLines = orderLineDetails.filter((line) => line.inventoryId);
        if (normalizedLines.length === 0) {
            alert('Debes agregar al menos una línea válida.');
            return;
        }

        for (const line of normalizedLines) {
            if (!line.product) {
                alert('Todas las líneas deben tener un producto de inventario válido.');
                return;
            }
            if (line.qty <= 0) {
                alert('La cantidad debe ser mayor a 0.');
                return;
            }
            if (line.unitPrice < 0) {
                alert('El precio unitario no puede ser negativo.');
                return;
            }
            if (line.discountAmount < 0 || line.discountAmount > line.qty * line.unitPrice) {
                alert('El descuento de una línea no puede superar su total bruto.');
                return;
            }
        }

        setSubmitting(true);
        try {
            const rpcPayload = {
                supplierId: selectedSupplier.id,
                currency: orderForm.currency,
                neededByDate: orderForm.neededByDate || null,
                generalNotes: orderForm.generalNotes.trim() || null,
                lines: normalizedLines.map((line) => ({
                    inventoryId: line.inventoryId,
                    qty: line.qty,
                    unitPrice: line.unitPrice,
                    discountAmount: line.discountAmount,
                    lineNotes: line.lineNotes.trim() || null,
                })),
            };

            const { data, error } = await supabase.rpc('create_purchase_order', {
                p_payload: rpcPayload as unknown as Database['public']['Functions']['create_purchase_order']['Args']['p_payload'],
            });
            if (error) throw error;

            const result = data as { purchase_order_id?: string; folio?: number };
            const purchaseOrderId = result?.purchase_order_id;
            const folio = Number(result?.folio || 0);
            if (!purchaseOrderId || !folio) {
                throw new Error('La OC se creó sin respuesta válida de folio.');
            }

            const createdOrder: PurchaseOrderRow = {
                id: purchaseOrderId,
                supplier_id: selectedSupplier.id,
                supplier_name_snapshot: selectedSupplier.name,
                supplier_email_snapshot: selectedSupplier.email,
                currency: orderForm.currency,
                issued_at: new Date().toISOString(),
                needed_by_date: orderForm.neededByDate || null,
                status: 'draft',
                subtotal: orderFormTotals.subtotal,
                total_discount: orderFormTotals.totalDiscount,
                total_amount: orderFormTotals.totalAmount,
                general_notes: orderForm.generalNotes.trim() || null,
                created_by: profile?.id || '',
                sent_by: null,
                sent_at: null,
                email_status: 'pending',
                email_error: null,
                pdf_storage_path: null,
                folio,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            const createdItems: PurchaseOrderItemRow[] = normalizedLines.map((line) => ({
                id: crypto.randomUUID(),
                purchase_order_id: purchaseOrderId,
                inventory_id: line.inventoryId,
                sku_snapshot: line.sku,
                product_name_snapshot: line.name,
                qty: line.qty,
                unit_price: line.unitPrice,
                discount_amount: line.discountAmount,
                line_notes: line.lineNotes.trim() || null,
                line_total: line.lineTotal,
            }));

            const pdfData = buildPurchaseOrderPdfData(createdOrder, createdItems, selectedSupplier, profile as ProfileRow | null);
            const pdfFile = await generatePurchaseOrderPdfFile(pdfData);
            const pdfStoragePath = `${purchaseOrderId}/${formatFolio(folio)}.pdf`;

            try {
                await uploadFileToStorage({
                    bucket: PURCHASE_ORDER_PDF_BUCKET,
                    path: pdfStoragePath,
                    file: pdfFile,
                    upsert: true,
                });

                await supabase
                    .from('purchase_orders')
                    .update({
                        pdf_storage_path: pdfStoragePath,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', purchaseOrderId);
            } catch (uploadError: any) {
                console.warn('Purchase order PDF upload failed:', uploadError);
            }

            try {
                await sendPurchaseOrderNotificationEmail({
                    purchaseOrderId,
                    requestSource: 'creation',
                    pdfAttachment: pdfFile,
                });
                alert(`OC ${formatFolio(folio)} generada y enviada correctamente.`);
            } catch (emailError: any) {
                console.error('Purchase order email failed:', emailError);
                alert(`OC ${formatFolio(folio)} generada, pero el correo falló.\n\nDetalle: ${emailError.message}`);
            }

            resetOrderModal();
            await fetchModuleData(false);
        } catch (error: any) {
            console.error('Error creating purchase order:', error);
            alert(`No se pudo crear la orden de compra: ${error.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    const handleOpenPurchaseOrderPdf = async (order: PurchaseOrderView) => {
        try {
            const pdfData = buildPurchaseOrderPdfData(order, order.items, order.supplier, order.createdByProfile);
            const pdfFile = await generatePurchaseOrderPdfFile(pdfData);
            const blobUrl = URL.createObjectURL(pdfFile);
            window.open(blobUrl, '_blank', 'noopener,noreferrer');
            window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        } catch (error: any) {
            console.error('Error opening purchase order PDF:', error);
            alert(`No se pudo abrir el PDF de la OC: ${error.message}`);
        }
    };

    const handleResendPurchaseOrder = async (order: PurchaseOrderView) => {
        if (order.status === 'cancelled') {
            alert('No se puede reenviar una OC cancelada.');
            return;
        }

        setResendingOrderId(order.id);
        try {
            const pdfData = buildPurchaseOrderPdfData(order, order.items, order.supplier, order.createdByProfile);
            const pdfFile = await generatePurchaseOrderPdfFile(pdfData);

            if (!order.pdf_storage_path) {
                const pdfStoragePath = `${order.id}/${formatFolio(order.folio)}.pdf`;
                await uploadFileToStorage({
                    bucket: PURCHASE_ORDER_PDF_BUCKET,
                    path: pdfStoragePath,
                    file: pdfFile,
                    upsert: true,
                });
                await supabase
                    .from('purchase_orders')
                    .update({
                        pdf_storage_path: pdfStoragePath,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', order.id);
            }

            await sendPurchaseOrderNotificationEmail({
                purchaseOrderId: order.id,
                requestSource: 'manual_resend',
                pdfAttachment: pdfFile,
            });

            alert(`OC ${formatFolio(order.folio)} reenviada correctamente.`);
            await fetchModuleData(false);
        } catch (error: any) {
            console.error('Error resending purchase order:', error);
            alert(`No se pudo reenviar la OC: ${error.message}`);
        } finally {
            setResendingOrderId(null);
        }
    };

    const handleCancelPurchaseOrder = async (order: PurchaseOrderView) => {
        if (order.status === 'cancelled') return;
        if (!window.confirm(`¿Cancelar la OC ${formatFolio(order.folio)}?`)) return;

        try {
            const { error } = await supabase
                .from('purchase_orders')
                .update({
                    status: 'cancelled',
                    email_status: order.email_status === 'sent' ? order.email_status : 'not_sent',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', order.id);
            if (error) throw error;
            await fetchModuleData(false);
        } catch (error: any) {
            console.error('Error cancelling purchase order:', error);
            alert(`No se pudo cancelar la OC: ${error.message}`);
        }
    };

    if (loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-dental-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-12">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.35em] text-slate-400">Abastecimiento</p>
                    <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-900">{pageTitle}</h1>
                    <p className="mt-2 text-lg font-medium text-slate-500">
                        {pageDescription}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => void fetchModuleData(false)}
                        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                    >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        Actualizar
                    </button>
                    {canManage && (
                        <>
                            <button
                                type="button"
                                onClick={openCreateSupplierModal}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                            >
                                <Users size={16} />
                                Nuevo Proveedor
                            </button>
                            <button
                                type="button"
                                onClick={openCreateOrderModal}
                                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-black"
                            >
                                <FilePlus2 size={16} />
                                Nueva OC
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Total OCs</p>
                    <p className="mt-3 text-5xl font-black tracking-tight text-slate-900">{orderMetrics.total}</p>
                </div>
                <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-sm">
                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-emerald-500">Enviadas</p>
                    <p className="mt-3 text-5xl font-black tracking-tight text-emerald-600">{orderMetrics.sent}</p>
                </div>
                <div className="rounded-[2rem] border border-rose-100 bg-white p-6 shadow-sm">
                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-rose-500">Fallidas</p>
                    <p className="mt-3 text-5xl font-black tracking-tight text-rose-600">{orderMetrics.failed}</p>
                </div>
                <div className="rounded-[2rem] border border-indigo-100 bg-white p-6 shadow-sm">
                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-indigo-500">Proveedores Activos</p>
                    <p className="mt-3 text-5xl font-black tracking-tight text-indigo-600">{supplierMetrics.active}</p>
                </div>
            </div>

            <div className="rounded-[2.5rem] border border-slate-100 bg-white p-4 shadow-xl shadow-slate-100/60">
                <div className="flex flex-wrap items-center gap-3 rounded-[1.6rem] bg-slate-50 p-2">
                    <button
                        type="button"
                        onClick={() => {
                            setActiveTab('orders');
                            navigate('/purchase-orders');
                        }}
                        className={`rounded-[1.2rem] px-5 py-3 text-sm font-black transition ${activeTab === 'orders' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        Órdenes
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setActiveTab('suppliers');
                            navigate('/suppliers');
                        }}
                        className={`rounded-[1.2rem] px-5 py-3 text-sm font-black transition ${activeTab === 'suppliers' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                        Proveedores
                    </button>
                </div>

                {activeTab === 'orders' ? (
                    <div className="mt-6 space-y-6">
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(360px,1fr)]">
                            <div className="rounded-[2rem] border border-slate-100 bg-slate-50/70 p-6">
                                <div className="grid gap-4 lg:grid-cols-4">
                                    <div className="lg:col-span-2">
                                        <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">
                                            Buscar OC
                                        </label>
                                        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-inner">
                                            <Search size={18} className="text-slate-400" />
                                            <input
                                                value={orderSearch}
                                                onChange={(event) => setOrderSearch(event.target.value)}
                                                placeholder="Folio, proveedor, correo, SKU o producto..."
                                                className="w-full bg-transparent text-sm font-medium text-slate-700 outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">
                                            Estado
                                        </label>
                                        <select
                                            value={orderStatusFilter}
                                            onChange={(event) => setOrderStatusFilter(event.target.value as 'all' | PurchaseOrderStatus)}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                        >
                                            <option value="all">Todos</option>
                                            <option value="draft">Borrador</option>
                                            <option value="sent">Enviada</option>
                                            <option value="send_failed">Error envío</option>
                                            <option value="cancelled">Cancelada</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">
                                            Moneda
                                        </label>
                                        <select
                                            value={orderCurrencyFilter}
                                            onChange={(event) => setOrderCurrencyFilter(event.target.value as 'all' | PurchaseOrderCurrency)}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                        >
                                            <option value="all">Todas</option>
                                            <option value="CLP">CLP</option>
                                            <option value="USD">USD</option>
                                        </select>
                                    </div>
                                    <div className="lg:col-span-2">
                                        <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">
                                            Proveedor
                                        </label>
                                        <select
                                            value={orderSupplierFilter}
                                            onChange={(event) => setOrderSupplierFilter(event.target.value)}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                        >
                                            <option value="all">Todos los proveedores</option>
                                            {suppliers.map((supplier) => (
                                                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
                                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Resumen Filtrado</p>
                                <div className="mt-5 space-y-4">
                                    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                                        <span className="text-sm font-bold text-slate-500">OC visibles</span>
                                        <span className="text-lg font-black text-slate-900">{filteredPurchaseOrders.length}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                                        <span className="text-sm font-bold text-slate-500">Monto visible</span>
                                        <span className="text-lg font-black text-slate-900">
                                            {formatCurrency(
                                                filteredPurchaseOrders.reduce((acc, order) => acc + Number(order.total_amount || 0), 0),
                                                orderCurrencyFilter === 'USD' ? 'USD' : 'CLP'
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-[2rem] border border-slate-100">
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-slate-100">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">OC</th>
                                            <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Proveedor</th>
                                            <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Fecha</th>
                                            <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Creador</th>
                                            <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Estado</th>
                                            <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Correo</th>
                                            <th className="px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Total</th>
                                            <th className="px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {filteredPurchaseOrders.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="px-6 py-16 text-center">
                                                    <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
                                                        <div className="rounded-full bg-slate-100 p-4 text-slate-400">
                                                            <ShoppingBag size={28} />
                                                        </div>
                                                        <p className="text-lg font-black text-slate-900">No hay órdenes de compra para este filtro.</p>
                                                        <p className="text-sm font-medium text-slate-500">Ajusta la búsqueda o crea la primera OC desde logística.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredPurchaseOrders.map((order) => (
                                                <tr key={order.id} className="hover:bg-slate-50/60">
                                                    <td className="px-6 py-5">
                                                        <div>
                                                            <p className="font-black text-slate-900">{formatFolio(order.folio)}</p>
                                                            <p className="text-xs font-bold text-slate-400">{order.currency}</p>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <div>
                                                            <p className="font-bold text-slate-900">{order.supplier_name_snapshot}</p>
                                                            <p className="text-xs font-medium text-slate-500 lowercase">{order.supplier_email_snapshot}</p>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 text-sm font-medium text-slate-600">{formatDate(order.issued_at)}</td>
                                                    <td className="px-6 py-5 text-sm font-medium text-slate-600">{getUserLabel(order.createdByProfile)}</td>
                                                    <td className="px-6 py-5">
                                                        <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${statusStyleMap[order.status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                                            {statusLabelMap[order.status] || order.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${emailStatusStyleMap[order.email_status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                                            {emailStatusLabelMap[order.email_status] || order.email_status}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-5 text-right text-sm font-black text-slate-900">
                                                        {formatCurrency(Number(order.total_amount || 0), order.currency as 'CLP' | 'USD')}
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setSelectedPurchaseOrder(order)}
                                                                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                                                                title="Ver detalle"
                                                            >
                                                                <Eye size={16} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => void handleOpenPurchaseOrderPdf(order)}
                                                                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                                                                title="Ver PDF"
                                                            >
                                                                <Package size={16} />
                                                            </button>
                                                            {canManage && (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleResendPurchaseOrder(order)}
                                                                        disabled={resendingOrderId === order.id || order.status === 'cancelled'}
                                                                        className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50"
                                                                        title="Reenviar"
                                                                    >
                                                                        <Mail size={16} className={resendingOrderId === order.id ? 'animate-pulse' : ''} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => void handleCancelPurchaseOrder(order)}
                                                                        disabled={order.status === 'cancelled'}
                                                                        className="rounded-xl border border-amber-200 p-2 text-amber-600 transition hover:bg-amber-50 disabled:opacity-40"
                                                                        title="Cancelar"
                                                                    >
                                                                        <AlertTriangle size={16} />
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6 space-y-6">
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(360px,1fr)]">
                            <div className="rounded-[2rem] border border-slate-100 bg-slate-50/70 p-6">
                                <label className="mb-2 block text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">
                                    Buscar proveedor
                                </label>
                                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-inner">
                                    <Search size={18} className="text-slate-400" />
                                    <input
                                        value={supplierSearch}
                                        onChange={(event) => setSupplierSearch(event.target.value)}
                                        placeholder="Nombre, correo, contacto, ciudad, RUT..."
                                        className="w-full bg-transparent text-sm font-medium text-slate-700 outline-none"
                                    />
                                </div>
                            </div>
                            <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
                                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Resumen Proveedores</p>
                                <div className="mt-5 space-y-4">
                                    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                                        <span className="text-sm font-bold text-slate-500">Total registrados</span>
                                        <span className="text-lg font-black text-slate-900">{supplierMetrics.total}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                                        <span className="text-sm font-bold text-slate-500">Activos</span>
                                        <span className="text-lg font-black text-emerald-600">{supplierMetrics.active}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {filteredSuppliers.map((supplier) => (
                                <div key={supplier.id} className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <p className="text-lg font-black text-slate-900">{supplier.name}</p>
                                            <p className="mt-1 text-sm font-medium lowercase text-slate-500">{supplier.email}</p>
                                        </div>
                                        <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${supplier.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                            {supplier.status === 'active' ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </div>

                                    <div className="mt-5 space-y-2 text-sm text-slate-600">
                                        <p><span className="font-black text-slate-500">Contacto:</span> {supplier.contact_name || 'Sin contacto'}</p>
                                        <p><span className="font-black text-slate-500">Teléfono:</span> {supplier.phone || 'Sin teléfono'}</p>
                                        <p><span className="font-black text-slate-500">Ubicación:</span> {[supplier.city, supplier.country].filter(Boolean).join(', ') || 'Sin ubicación'}</p>
                                        <p><span className="font-black text-slate-500">Moneda:</span> {supplier.preferred_currency || 'No definida'}</p>
                                        {supplier.tax_id && <p><span className="font-black text-slate-500">RUT / Tax ID:</span> {supplier.tax_id}</p>}
                                    </div>

                                    <div className="mt-6 flex items-center justify-between gap-3">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOrderForm({
                                                    ...createEmptyOrderForm(),
                                                    supplierId: supplier.id,
                                                    currency: (supplier.preferred_currency as 'CLP' | 'USD') || 'CLP',
                                                });
                                                setShowOrderModal(true);
                                            }}
                                            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-white transition hover:bg-black"
                                        >
                                            <Truck size={14} />
                                            Crear OC
                                        </button>
                                        {canManage && (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => openEditSupplierModal(supplier)}
                                                    className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
                                                >
                                                    <Pencil size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDeleteSupplier(supplier)}
                                                    className="rounded-xl border border-rose-200 p-2 text-rose-500 transition hover:bg-rose-50"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {showSupplierModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-3xl rounded-[2rem] bg-white p-8 shadow-2xl">
                        <div className="mb-6 flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Proveedor</p>
                                <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                                    {editingSupplierId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                                </h3>
                            </div>
                            <button onClick={resetSupplierModal} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSupplierSubmit} className="space-y-5">
                            <div className="grid gap-4 md:grid-cols-2">
                                <input value={supplierForm.name} onChange={(event) => setSupplierForm((current) => ({ ...current, name: event.target.value }))} placeholder="Razón social / proveedor *" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />
                                <input value={supplierForm.email} onChange={(event) => setSupplierForm((current) => ({ ...current, email: event.target.value }))} placeholder="Correo principal *" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />
                                <input value={supplierForm.contact_name} onChange={(event) => setSupplierForm((current) => ({ ...current, contact_name: event.target.value }))} placeholder="Contacto principal" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />
                                <input value={supplierForm.phone} onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Teléfono" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />
                                <input value={supplierForm.tax_id} onChange={(event) => setSupplierForm((current) => ({ ...current, tax_id: event.target.value }))} placeholder="RUT / Tax ID" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />
                                <select value={supplierForm.preferred_currency} onChange={(event) => setSupplierForm((current) => ({ ...current, preferred_currency: event.target.value as '' | 'CLP' | 'USD' }))} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 outline-none">
                                    <option value="">Moneda preferida</option>
                                    <option value="CLP">CLP</option>
                                    <option value="USD">USD</option>
                                </select>
                                <input value={supplierForm.country} onChange={(event) => setSupplierForm((current) => ({ ...current, country: event.target.value }))} placeholder="País" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />
                                <input value={supplierForm.city} onChange={(event) => setSupplierForm((current) => ({ ...current, city: event.target.value }))} placeholder="Ciudad" className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />
                            </div>

                            <input value={supplierForm.address} onChange={(event) => setSupplierForm((current) => ({ ...current, address: event.target.value }))} placeholder="Dirección comercial" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />

                            <textarea value={supplierForm.notes} onChange={(event) => setSupplierForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Notas internas" rows={3} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium outline-none focus:border-slate-400" />

                            <div className="flex items-center justify-between gap-4">
                                <select value={supplierForm.status} onChange={(event) => setSupplierForm((current) => ({ ...current, status: event.target.value as 'active' | 'inactive' }))} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 outline-none">
                                    <option value="active">Activo</option>
                                    <option value="inactive">Inactivo</option>
                                </select>
                                <div className="flex items-center gap-3">
                                    <button type="button" onClick={resetSupplierModal} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50">Cancelar</button>
                                    <button type="submit" disabled={submitting} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-black disabled:opacity-50">
                                        {submitting ? 'Guardando...' : editingSupplierId ? 'Actualizar Proveedor' : 'Crear Proveedor'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showOrderModal && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
                    <div className="mx-auto w-full max-w-6xl rounded-[2rem] bg-white p-8 shadow-2xl">
                        <div className="mb-6 flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Orden de Compra</p>
                                <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Generar y enviar OC</h3>
                                <p className="mt-2 text-sm font-medium text-slate-500">La OC se crea, se guarda el PDF y luego se envía desde tu cuenta Google.</p>
                            </div>
                            <button onClick={resetOrderModal} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleCreatePurchaseOrder} className="space-y-6">
                            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
                                <div className="rounded-[2rem] border border-slate-100 bg-slate-50/70 p-6">
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div className="space-y-2">
                                            <select
                                                value={orderForm.supplierId}
                                                onChange={(event) => setOrderForm((current) => ({ ...current, supplierId: event.target.value }))}
                                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                            >
                                                <option value="">Selecciona proveedor *</option>
                                                {activeSuppliers.map((supplier) => (
                                                    <option key={supplier.id} value={supplier.id}>
                                                        {supplier.name} · {supplier.email}
                                                    </option>
                                                ))}
                                            </select>
                                            {selectedSupplier && (
                                                <p className="text-xs font-bold text-slate-500">
                                                    Se mostrarán solo productos asignados a este proveedor.
                                                </p>
                                            )}
                                        </div>
                                        <select
                                            value={orderForm.currency}
                                            onChange={(event) => setOrderForm((current) => ({ ...current, currency: event.target.value as 'CLP' | 'USD' }))}
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                        >
                                            <option value="CLP">CLP</option>
                                            <option value="USD">USD</option>
                                        </select>
                                        <input
                                            type="date"
                                            value={orderForm.neededByDate}
                                            onChange={(event) => setOrderForm((current) => ({ ...current, neededByDate: event.target.value }))}
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                                        />
                                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
                                            {selectedSupplier ? (
                                                <>
                                                    <p className="font-black text-slate-900">{selectedSupplier.name}</p>
                                                    <p className="text-xs lowercase">{selectedSupplier.email}</p>
                                                </>
                                            ) : (
                                                'Selecciona un proveedor activo'
                                            )}
                                        </div>
                                    </div>

                                    <textarea
                                        value={orderForm.generalNotes}
                                        onChange={(event) => setOrderForm((current) => ({ ...current, generalNotes: event.target.value }))}
                                        placeholder="Observaciones generales para el proveedor"
                                        rows={4}
                                        className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                                    />
                                </div>

                                <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
                                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Resumen Documento</p>
                                    <div className="mt-5 space-y-4">
                                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                                            <span className="text-sm font-bold text-slate-500">Subtotal</span>
                                            <span className="text-base font-black text-slate-900">{formatCurrency(orderFormTotals.subtotal, orderForm.currency)}</span>
                                        </div>
                                        <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                                            <span className="text-sm font-bold text-slate-500">Descuento</span>
                                            <span className="text-base font-black text-slate-900">{formatCurrency(orderFormTotals.totalDiscount, orderForm.currency)}</span>
                                        </div>
                                        <div className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-4">
                                            <span className="text-sm font-black uppercase tracking-[0.2em] text-white/70">Total</span>
                                            <span className="text-xl font-black text-white">{formatCurrency(orderFormTotals.totalAmount, orderForm.currency)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Líneas</p>
                                        <h4 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Productos de la OC</h4>
                                        {selectedSupplier && availableInventoryItems.length === 0 && (
                                            <p className="mt-2 text-sm font-bold text-amber-600">
                                                Este proveedor aún no tiene productos asignados en inventario.
                                            </p>
                                        )}
                                    </div>
                                    <button type="button" onClick={addOrderLine} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-slate-700 transition hover:bg-slate-50">
                                        <Plus size={14} />
                                        Agregar Línea
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {orderLineDetails.map((line, index) => {
                                        const normalizedProductSearch = line.productSearch.trim().toLowerCase();
                                        const filteredInventoryItems = normalizedProductSearch
                                            ? availableInventoryItems.filter((item) =>
                                                item.id === line.inventoryId || `${item.sku || 'SIN-SKU'} ${item.name} ${item.category || ''}`
                                                    .toLowerCase()
                                                    .includes(normalizedProductSearch)
                                            )
                                            : availableInventoryItems;

                                        return (
                                        <div key={line.localId} className="rounded-[1.6rem] border border-slate-100 bg-slate-50/60 p-4">
                                            <div className="grid gap-3 xl:grid-cols-[minmax(0,2.2fr)_110px_160px_160px_minmax(0,1.2fr)_auto]">
                                                <div className="space-y-2">
                                                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                        Producto
                                                    </label>
                                                    <div className="relative">
                                                        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                                        <input
                                                            value={line.productSearch}
                                                            onChange={(event) => updateOrderLine(line.localId, 'productSearch', event.target.value)}
                                                            placeholder="Buscar por SKU o nombre"
                                                            className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-medium text-slate-700 outline-none"
                                                        />
                                                    </div>
                                                    <select
                                                        value={line.inventoryId}
                                                        onChange={(event) => updateOrderLine(line.localId, 'inventoryId', event.target.value)}
                                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                                    >
                                                        <option value="">Producto de inventario *</option>
                                                        {filteredInventoryItems.map((item) => (
                                                            <option key={item.id} value={item.id}>
                                                                {(item.sku || 'SIN-SKU')} · {item.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    {normalizedProductSearch && filteredInventoryItems.length === 0 && (
                                                        <p className="text-xs font-bold text-amber-600">
                                                            No hay productos que coincidan con la búsqueda.
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                        Cantidad
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={line.qty}
                                                        onChange={(event) => updateOrderLine(line.localId, 'qty', Number(event.target.value || 0))}
                                                        placeholder="Cant."
                                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                        Precio Unitario
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={orderForm.currency === 'CLP' ? 1 : 0.01}
                                                        value={line.unitPrice}
                                                        onChange={(event) => updateOrderLine(line.localId, 'unitPrice', Number(event.target.value || 0))}
                                                        placeholder="Precio"
                                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                        Descuento
                                                    </label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={orderForm.currency === 'CLP' ? 1 : 0.01}
                                                        value={line.discountAmount}
                                                        onChange={(event) => updateOrderLine(line.localId, 'discountAmount', Number(event.target.value || 0))}
                                                        placeholder="Descuento"
                                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                        Observación
                                                    </label>
                                                    <input
                                                        value={line.lineNotes}
                                                        onChange={(event) => updateOrderLine(line.localId, 'lineNotes', event.target.value)}
                                                        placeholder="Observación línea"
                                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="block text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                        Total
                                                    </label>
                                                    <div className="flex items-center justify-end gap-2">
                                                        <div className="rounded-2xl bg-white px-4 py-3 text-right text-sm font-black text-slate-900 shadow-inner">
                                                            {formatCurrency(line.lineTotal, orderForm.currency)}
                                                        </div>
                                                        <button type="button" onClick={() => removeOrderLine(line.localId)} disabled={orderForm.lines.length === 1} className="rounded-xl border border-rose-200 p-3 text-rose-500 transition hover:bg-rose-50 disabled:opacity-40">
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
                                                <span className="rounded-full bg-white px-3 py-1">Línea {index + 1}</span>
                                                <span className="rounded-full bg-white px-3 py-1">SKU: {line.sku}</span>
                                                <span className="rounded-full bg-white px-3 py-1">Producto: {line.name}</span>
                                                {line.product && (
                                                    <span className="rounded-full bg-white px-3 py-1">
                                                        Stock actual: {Number(line.product.stock_qty || 0).toLocaleString('es-CL')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3">
                                <button type="button" onClick={resetOrderModal} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50">Cancelar</button>
                                <button type="submit" disabled={submitting} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition hover:bg-black disabled:opacity-50">
                                    {submitting ? 'Generando...' : 'Generar y enviar OC'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {selectedPurchaseOrder && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
                    <div className="mx-auto w-full max-w-5xl rounded-[2rem] bg-white p-8 shadow-2xl">
                        <div className="mb-6 flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Detalle OC</p>
                                <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-900">{formatFolio(selectedPurchaseOrder.folio)}</h3>
                                <p className="mt-2 text-sm font-medium text-slate-500">{selectedPurchaseOrder.supplier_name_snapshot} · {selectedPurchaseOrder.currency}</p>
                            </div>
                            <button onClick={() => setSelectedPurchaseOrder(null)} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
                            <div className="space-y-6">
                                <div className="rounded-[1.6rem] border border-slate-100 bg-slate-50/70 p-6">
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Proveedor</p>
                                            <p className="mt-2 text-lg font-black text-slate-900">{selectedPurchaseOrder.supplier_name_snapshot}</p>
                                            <p className="text-sm font-medium lowercase text-slate-500">{selectedPurchaseOrder.supplier_email_snapshot}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Emisión</p>
                                            <p className="mt-2 text-sm font-black text-slate-900">{formatDateTime(selectedPurchaseOrder.issued_at)}</p>
                                            <p className="text-sm font-medium text-slate-500">Creador: {getUserLabel(selectedPurchaseOrder.createdByProfile)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Estado</p>
                                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${statusStyleMap[selectedPurchaseOrder.status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                                    {statusLabelMap[selectedPurchaseOrder.status] || selectedPurchaseOrder.status}
                                                </span>
                                                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${emailStatusStyleMap[selectedPurchaseOrder.email_status] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                                    {emailStatusLabelMap[selectedPurchaseOrder.email_status] || selectedPurchaseOrder.email_status}
                                                </span>
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Fecha requerida</p>
                                            <p className="mt-2 text-sm font-black text-slate-900">{selectedPurchaseOrder.needed_by_date ? formatDate(selectedPurchaseOrder.needed_by_date) : 'Sin fecha'}</p>
                                            <p className="text-sm font-medium text-slate-500">Enviado por: {getUserLabel(selectedPurchaseOrder.sentByProfile)}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-[1.6rem] border border-slate-100 bg-white shadow-sm">
                                    <div className="border-b border-slate-100 px-6 py-4">
                                        <p className="text-lg font-black text-slate-900">Productos</p>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-100">
                                            <thead className="bg-slate-50">
                                                <tr>
                                                    <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">SKU</th>
                                                    <th className="px-6 py-4 text-left text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Producto</th>
                                                    <th className="px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Cant.</th>
                                                    <th className="px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">P. Unitario</th>
                                                    <th className="px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Descuento</th>
                                                    <th className="px-6 py-4 text-right text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Total</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {selectedPurchaseOrder.items.map((item) => (
                                                    <tr key={item.id}>
                                                        <td className="px-6 py-4 text-sm font-black text-slate-700">{item.sku_snapshot}</td>
                                                        <td className="px-6 py-4">
                                                            <p className="font-bold text-slate-900">{item.product_name_snapshot}</p>
                                                            {item.line_notes && <p className="text-xs font-medium text-slate-500">{item.line_notes}</p>}
                                                        </td>
                                                        <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{item.qty}</td>
                                                        <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(item.unit_price, selectedPurchaseOrder.currency as 'CLP' | 'USD')}</td>
                                                        <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(item.discount_amount, selectedPurchaseOrder.currency as 'CLP' | 'USD')}</td>
                                                        <td className="px-6 py-4 text-right text-sm font-black text-slate-900">{formatCurrency(item.line_total, selectedPurchaseOrder.currency as 'CLP' | 'USD')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="rounded-[1.6rem] border border-slate-100 bg-white p-6 shadow-sm">
                                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Totales</p>
                                    <div className="mt-5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold text-slate-500">Subtotal</span>
                                            <span className="text-sm font-black text-slate-900">{formatCurrency(selectedPurchaseOrder.subtotal, selectedPurchaseOrder.currency as 'CLP' | 'USD')}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold text-slate-500">Descuento</span>
                                            <span className="text-sm font-black text-slate-900">{formatCurrency(selectedPurchaseOrder.total_discount, selectedPurchaseOrder.currency as 'CLP' | 'USD')}</span>
                                        </div>
                                        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                                            <span className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Total</span>
                                            <span className="text-xl font-black text-slate-900">{formatCurrency(selectedPurchaseOrder.total_amount, selectedPurchaseOrder.currency as 'CLP' | 'USD')}</span>
                                        </div>
                                    </div>

                                    {selectedPurchaseOrder.general_notes && (
                                        <div className="mt-6 rounded-2xl bg-slate-50 p-4">
                                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Observaciones</p>
                                            <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-slate-600">{selectedPurchaseOrder.general_notes}</p>
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-[1.6rem] border border-slate-100 bg-white p-6 shadow-sm">
                                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">Envíos</p>
                                    <div className="mt-4 space-y-3">
                                        {selectedPurchaseOrder.emailLogs.length === 0 ? (
                                            <div className="rounded-2xl bg-slate-50 px-4 py-5 text-sm font-medium text-slate-500">
                                                Aún no hay eventos de envío registrados.
                                            </div>
                                        ) : (
                                            selectedPurchaseOrder.emailLogs.map((log) => (
                                                <div key={log.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${log.status === 'sent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                                            {log.status === 'sent' ? 'Enviado' : 'Fallido'}
                                                        </span>
                                                        <span className="text-xs font-bold text-slate-400">{formatDateTime(log.sent_at || log.created_at)}</span>
                                                    </div>
                                                    <p className="mt-2 text-xs font-bold text-slate-600">Desde: {log.sender_email}</p>
                                                    <p className="mt-1 text-xs font-medium text-slate-500">Para: {log.to_recipients.join(', ')}</p>
                                                    {log.error_message && (
                                                        <p className="mt-2 text-xs font-bold text-rose-600">{log.error_message}</p>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-3">
                                    <button type="button" onClick={() => void handleOpenPurchaseOrderPdf(selectedPurchaseOrder)} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50">
                                        Ver PDF
                                    </button>
                                    {canManage && (
                                        <button type="button" onClick={() => void handleResendPurchaseOrder(selectedPurchaseOrder)} disabled={resendingOrderId === selectedPurchaseOrder.id || selectedPurchaseOrder.status === 'cancelled'} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-black disabled:opacity-50">
                                            {resendingOrderId === selectedPurchaseOrder.id ? 'Reenviando...' : 'Reenviar OC'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PurchaseOrders;
