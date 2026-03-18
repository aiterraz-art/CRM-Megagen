import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardList,
    Filter,
    Link2,
    Package,
    Plane,
    Plus,
    Search,
    ShipWheel,
    X
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Database } from '../types/supabase';

type InventoryItem = Database['public']['Tables']['inventory']['Row'];
type ProductRequestRow = Database['public']['Tables']['product_requests']['Row'];
type ShipmentRow = Database['public']['Tables']['inbound_shipments']['Row'];
type ShipmentItemRow = Database['public']['Tables']['inbound_shipment_items']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type RequestReason = ProductRequestRow['reason_type'];
type RequestPriority = ProductRequestRow['priority'];
type RequestStatus = ProductRequestRow['status'];
type ShipmentStatus = ShipmentRow['status'];
type ShipmentMode = ShipmentRow['transport_mode'];
type ProcurementTab = 'requests' | 'shipments';

type ProcurementLocationState = {
    activeTab?: ProcurementTab;
    openRequestModal?: boolean;
    prefillProduct?: {
        id: string;
        sku: string | null;
        name: string;
        stock_qty: number | null;
    };
} | null;

type ShipmentItemFormRow = {
    localId: string;
    productId: string;
    skuSnapshot: string;
    productNameSnapshot: string;
    qty: number;
};

const REQUEST_REASON_LABELS: Record<RequestReason, string> = {
    low_stock: 'Stock Bajo',
    no_stock: 'Sin Stock',
    planned_large_sale: 'Venta Grande',
    other: 'Otro'
};

const REQUEST_PRIORITY_STYLES: Record<RequestPriority, string> = {
    low: 'bg-slate-100 text-slate-700 border-slate-200',
    normal: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    high: 'bg-rose-50 text-rose-700 border-rose-200'
};

const REQUEST_PRIORITY_LABELS: Record<RequestPriority, string> = {
    low: 'Baja',
    normal: 'Normal',
    high: 'Alta'
};

const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    in_purchase: 'bg-sky-50 text-sky-700 border-sky-200',
    included: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    closed: 'bg-slate-100 text-slate-600 border-slate-200'
};

const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
    pending: 'Pendiente',
    in_purchase: 'En Compra',
    included: 'Incluida',
    closed: 'Cerrada'
};

const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
    in_transit: 'En Tránsito',
    arrived_chile: 'Llegó a Chile',
    received: 'Recibida',
    in_warehouse: 'En Bodega'
};

const SHIPMENT_STATUS_STYLES: Record<ShipmentStatus, string> = {
    in_transit: 'bg-sky-50 text-sky-700 border-sky-200',
    arrived_chile: 'bg-amber-50 text-amber-700 border-amber-200',
    received: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    in_warehouse: 'bg-slate-900 text-white border-slate-900'
};

const createEmptyRequestForm = () => ({
    productId: '',
    requestedQty: 1,
    reasonType: 'low_stock' as RequestReason,
    priority: 'normal' as RequestPriority,
    neededByDate: '',
    requestNote: ''
});

const createEmptyShipmentForm = () => ({
    supplierName: '',
    originCountry: '',
    originCity: '',
    transportMode: 'sea' as ShipmentMode,
    departureDate: '',
    etaDate: '',
    status: 'in_transit' as ShipmentStatus,
    notes: '',
    items: [{ localId: crypto.randomUUID(), productId: '', skuSnapshot: '', productNameSnapshot: '', qty: 1 }] as ShipmentItemFormRow[]
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

const getUserLabel = (profile?: ProfileRow | null) => {
    if (!profile) return 'Sin responsable';
    if (profile.full_name?.trim()) return profile.full_name.trim();
    return profile.email?.split('@')[0] || 'Sin nombre';
};

const getShipmentProgress = (shipment: ShipmentRow) => {
    if (!shipment.departure_date || !shipment.eta_date) return 0.5;

    const start = new Date(shipment.departure_date).getTime();
    const end = new Date(shipment.eta_date).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0.5;

    const now = Date.now();
    if (shipment.status === 'received' || shipment.status === 'in_warehouse') return 1;
    if (shipment.status === 'arrived_chile') return 0.9;

    return Math.min(1, Math.max(0, (now - start) / (end - start)));
};

const ShipmentProgressTrack: React.FC<{ shipment: ShipmentRow }> = ({ shipment }) => {
    const progress = getShipmentProgress(shipment);
    const VehicleIcon = shipment.transport_mode === 'air' ? Plane : ShipWheel;

    return (
        <div className="rounded-3xl border border-slate-100 bg-slate-50/80 p-4">
            <div className="mb-3 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
                <span>{shipment.origin_city}, {shipment.origin_country}</span>
                <span>Chile</span>
            </div>
            <div className="relative h-12">
                <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-200" />
                <div
                    className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-sky-400 via-indigo-500 to-emerald-400"
                    style={{ width: `${Math.max(6, progress * 100)}%` }}
                />
                <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border border-white bg-white p-2 shadow-lg"
                    style={{ left: `${Math.max(4, Math.min(96, progress * 100))}%` }}
                >
                    <VehicleIcon size={18} className={shipment.transport_mode === 'air' ? 'text-sky-600' : 'text-indigo-600'} />
                </div>
                <div className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-slate-300 shadow" />
                <div className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500 shadow" />
            </div>
        </div>
    );
};

const Procurement: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { profile, hasPermission, effectiveRole } = useUser();
    const canViewProcurement = hasPermission('VIEW_PROCUREMENT');
    const canRequestProducts = hasPermission('REQUEST_PRODUCTS');
    const canManageProcurement = hasPermission('MANAGE_PROCUREMENT');
    const isAdmin = effectiveRole === 'admin';

    const [activeTab, setActiveTab] = useState<ProcurementTab>('shipments');
    const [loading, setLoading] = useState(true);
    const [savingRequest, setSavingRequest] = useState(false);
    const [savingShipment, setSavingShipment] = useState(false);
    const [managingRequest, setManagingRequest] = useState(false);
    const [requests, setRequests] = useState<ProductRequestRow[]>([]);
    const [shipments, setShipments] = useState<ShipmentRow[]>([]);
    const [shipmentItems, setShipmentItems] = useState<ShipmentItemRow[]>([]);
    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [profiles, setProfiles] = useState<ProfileRow[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | RequestStatus>('all');
    const [reasonFilter, setReasonFilter] = useState<'all' | RequestReason>('all');
    const [priorityFilter, setPriorityFilter] = useState<'all' | RequestPriority>('all');
    const [requesterFilter, setRequesterFilter] = useState<'all' | string>('all');
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [showShipmentModal, setShowShipmentModal] = useState(false);
    const [selectedShipment, setSelectedShipment] = useState<ShipmentRow | null>(null);
    const [editingRequest, setEditingRequest] = useState<ProductRequestRow | null>(null);
    const [editingShipment, setEditingShipment] = useState<ShipmentRow | null>(null);
    const [requestToManage, setRequestToManage] = useState<ProductRequestRow | null>(null);
    const [requestForm, setRequestForm] = useState(createEmptyRequestForm);
    const [shipmentForm, setShipmentForm] = useState(createEmptyShipmentForm);
    const [requestProductSearch, setRequestProductSearch] = useState('');
    const [shipmentPasteInput, setShipmentPasteInput] = useState('');
    const [requestManagementForm, setRequestManagementForm] = useState({
        status: 'pending' as RequestStatus,
        linkedShipmentId: '',
        managerNote: ''
    });

    const profilesById = useMemo(() => new Map(profiles.map((row) => [row.id, row])), [profiles]);
    const shipmentsById = useMemo(() => new Map(shipments.map((row) => [row.id, row])), [shipments]);
    const inventoryById = useMemo(() => new Map(inventory.map((row) => [row.id, row])), [inventory]);
    const filteredInventoryForRequest = useMemo(() => {
        const term = requestProductSearch.trim().toLowerCase();
        if (!term) return inventory;
        return inventory.filter((item) => {
            const sku = (item.sku || '').toLowerCase();
            const name = (item.name || '').toLowerCase();
            return sku.includes(term) || name.includes(term);
        });
    }, [inventory, requestProductSearch]);

    const fetchProcurementData = async () => {
        setLoading(true);
        try {
            const [requestsRes, shipmentsRes, shipmentItemsRes, inventoryRes, profilesRes] = await Promise.all([
                supabase.from('product_requests').select('*').order('created_at', { ascending: false }),
                supabase.from('inbound_shipments').select('*').order('eta_date', { ascending: true }),
                supabase.from('inbound_shipment_items').select('*'),
                supabase.from('inventory').select('id, sku, name, stock_qty, category, price, created_at').order('name'),
                supabase.from('profiles').select('id, full_name, email, role, status').order('full_name')
            ]);

            if (requestsRes.error) throw requestsRes.error;
            if (shipmentsRes.error) throw shipmentsRes.error;
            if (shipmentItemsRes.error) throw shipmentItemsRes.error;
            if (inventoryRes.error) throw inventoryRes.error;
            if (profilesRes.error) throw profilesRes.error;

            setRequests((requestsRes.data || []) as ProductRequestRow[]);
            setShipments((shipmentsRes.data || []) as ShipmentRow[]);
            setShipmentItems((shipmentItemsRes.data || []) as ShipmentItemRow[]);
            setInventory((inventoryRes.data || []) as InventoryItem[]);
            setProfiles((profilesRes.data || []) as ProfileRow[]);
        } catch (error: any) {
            console.error('Error loading procurement module:', error);
            alert(`Error cargando módulo de compras: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (canViewProcurement) {
            void fetchProcurementData();
        }
    }, [canViewProcurement]);

    useEffect(() => {
        const state = location.state as ProcurementLocationState;
        if (!state) return;

        if (state.activeTab) {
            setActiveTab(state.activeTab);
        }

        if (state.openRequestModal && state.prefillProduct) {
            setActiveTab('requests');
            setEditingRequest(null);
            setRequestForm({
                productId: state.prefillProduct.id,
                requestedQty: 1,
                reasonType: (state.prefillProduct.stock_qty || 0) <= 0 ? 'no_stock' : 'low_stock',
                priority: (state.prefillProduct.stock_qty || 0) <= 0 ? 'high' : 'normal',
                neededByDate: '',
                requestNote: ''
            });
            setRequestProductSearch(`${state.prefillProduct.sku || ''} ${state.prefillProduct.name}`.trim());
            setShowRequestModal(true);
        }

        navigate(location.pathname, { replace: true, state: null });
    }, [location.pathname, location.state, navigate]);

    const activeShipments = useMemo(
        () => shipments.filter((shipment) => shipment.status !== 'in_warehouse'),
        [shipments]
    );

    const closedShipments = useMemo(
        () => shipments.filter((shipment) => shipment.status === 'in_warehouse'),
        [shipments]
    );

    const filteredRequests = useMemo(() => {
        return requests.filter((request) => {
            const requester = profilesById.get(request.requester_id);
            const requesterName = getUserLabel(requester).toLowerCase();
            const shipment = request.linked_shipment_id ? shipmentsById.get(request.linked_shipment_id) : null;
            const haystack = [
                request.sku_snapshot,
                request.product_name_snapshot,
                request.request_note,
                request.manager_note,
                requesterName,
                shipment?.supplier_name
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false;
            if (statusFilter !== 'all' && request.status !== statusFilter) return false;
            if (reasonFilter !== 'all' && request.reason_type !== reasonFilter) return false;
            if (priorityFilter !== 'all' && request.priority !== priorityFilter) return false;
            if (requesterFilter !== 'all' && request.requester_id !== requesterFilter) return false;
            return true;
        });
    }, [priorityFilter, profilesById, reasonFilter, requests, requesterFilter, search, shipmentsById, statusFilter]);

    const openCreateRequestModal = () => {
        setEditingRequest(null);
        setRequestForm(createEmptyRequestForm());
        setRequestProductSearch('');
        setShowRequestModal(true);
    };

    const openEditRequestModal = (request: ProductRequestRow) => {
        setEditingRequest(request);
        setRequestForm({
            productId: request.product_id || '',
            requestedQty: request.requested_qty,
            reasonType: request.reason_type as RequestReason,
            priority: request.priority as RequestPriority,
            neededByDate: request.needed_by_date || '',
            requestNote: request.request_note || ''
        });
        setRequestProductSearch(`${request.sku_snapshot || ''} ${request.product_name_snapshot}`.trim());
        setShowRequestModal(true);
    };

    const openShipmentModal = (shipment?: ShipmentRow) => {
        if (shipment) {
            const existingItems = shipmentItems
                .filter((item) => item.shipment_id === shipment.id)
                .map((item) => ({
                    localId: item.id,
                    productId: item.product_id || '',
                    skuSnapshot: item.sku_snapshot || '',
                    productNameSnapshot: item.product_name_snapshot || '',
                    qty: item.qty
                }));

            setEditingShipment(shipment);
            setShipmentForm({
                supplierName: shipment.supplier_name,
                originCountry: shipment.origin_country,
                originCity: shipment.origin_city,
                transportMode: shipment.transport_mode as ShipmentMode,
                departureDate: shipment.departure_date || '',
                etaDate: shipment.eta_date || '',
                status: shipment.status as ShipmentStatus,
                notes: shipment.notes || '',
                items: existingItems.length > 0 ? existingItems : [{ localId: crypto.randomUUID(), productId: '', skuSnapshot: '', productNameSnapshot: '', qty: 1 }]
            });
        } else {
            setEditingShipment(null);
            setShipmentForm(createEmptyShipmentForm());
        }
        setShipmentPasteInput('');
        setShowShipmentModal(true);
    };

    const handleSaveRequest = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!profile?.id || !canRequestProducts) {
            alert('No tienes permisos para crear solicitudes.');
            return;
        }

        const product = inventoryById.get(requestForm.productId);
        if (!product) {
            alert('Debes seleccionar un producto válido.');
            return;
        }

        if (!requestForm.requestedQty || requestForm.requestedQty <= 0) {
            alert('La cantidad solicitada debe ser mayor a 0.');
            return;
        }

        setSavingRequest(true);
        try {
            const payload: Database['public']['Tables']['product_requests']['Insert'] = {
                product_id: product.id,
                sku_snapshot: product.sku || 'SIN-SKU',
                product_name_snapshot: product.name,
                current_stock_snapshot: product.stock_qty || 0,
                requested_qty: Math.trunc(requestForm.requestedQty),
                reason_type: requestForm.reasonType,
                priority: requestForm.priority,
                needed_by_date: requestForm.neededByDate || null,
                request_note: requestForm.requestNote.trim() || null,
                requester_id: profile.id
            };

            if (editingRequest) {
                const { error } = await supabase
                    .from('product_requests')
                    .update(payload)
                    .eq('id', editingRequest.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('product_requests')
                    .insert(payload);
                if (error) throw error;
            }

            setShowRequestModal(false);
            setEditingRequest(null);
            setRequestForm(createEmptyRequestForm());
            await fetchProcurementData();
        } catch (error: any) {
            console.error('Error saving product request:', error);
            alert(`Error guardando solicitud: ${error.message}`);
        } finally {
            setSavingRequest(false);
        }
    };

    const handleCloseRequest = async (request: ProductRequestRow) => {
        const confirmClose = window.confirm(`¿Cerrar la solicitud de ${request.product_name_snapshot}?`);
        if (!confirmClose) return;

        try {
            const { error } = await supabase
                .from('product_requests')
                .update({ status: 'closed' })
                .eq('id', request.id);

            if (error) throw error;
            await fetchProcurementData();
        } catch (error: any) {
            console.error('Error closing request:', error);
            alert(`Error cerrando solicitud: ${error.message}`);
        }
    };

    const handleApplyShipmentPaste = () => {
        const lines = shipmentPasteInput
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        if (lines.length === 0) {
            alert('Pega al menos una línea con productos.');
            return;
        }

        const parsedRows: ShipmentItemFormRow[] = [];

        for (const line of lines) {
            const parts = line
                .split(/\t|;|,/)
                .map((part) => part.trim())
                .filter((part) => part !== '');

            if (parts.length < 2) {
                continue;
            }

            let skuSnapshot = '';
            let productNameSnapshot = '';
            let qty = 1;

            if (parts.length >= 3) {
                skuSnapshot = parts[0];
                productNameSnapshot = parts[1];
                qty = Math.max(1, Number(parts[2] || 1));
            } else {
                productNameSnapshot = parts[0];
                qty = Math.max(1, Number(parts[1] || 1));
            }

            if (!productNameSnapshot) continue;

            const matchedInventory = inventory.find((item) => {
                const sku = (item.sku || '').toLowerCase();
                const name = (item.name || '').toLowerCase();
                return (
                    (!!skuSnapshot && sku === skuSnapshot.toLowerCase()) ||
                    name === productNameSnapshot.toLowerCase()
                );
            });

            parsedRows.push({
                localId: crypto.randomUUID(),
                productId: matchedInventory?.id || '',
                skuSnapshot: matchedInventory?.sku || skuSnapshot,
                productNameSnapshot: matchedInventory?.name || productNameSnapshot,
                qty: Number.isFinite(qty) ? qty : 1
            });
        }

        if (parsedRows.length === 0) {
            alert('No se pudieron interpretar las líneas pegadas. Usa formato SKU, Producto, Cantidad o Producto, Cantidad.');
            return;
        }

        setShipmentForm((current) => ({
            ...current,
            items: [...current.items.filter((item) => item.productId || item.skuSnapshot || item.productNameSnapshot), ...parsedRows]
        }));
        setShipmentPasteInput('');
    };

    const handleSaveShipment = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!profile?.id || !canManageProcurement) {
            alert('No tienes permisos para gestionar importaciones.');
            return;
        }

        const validItems = shipmentForm.items.filter((item) => {
            const hasReference = item.productId || item.skuSnapshot.trim() || item.productNameSnapshot.trim();
            return hasReference && item.qty > 0;
        });
        if (!shipmentForm.supplierName.trim() || !shipmentForm.originCountry.trim() || !shipmentForm.originCity.trim()) {
            alert('Proveedor, país y ciudad de origen son obligatorios.');
            return;
        }

        setSavingShipment(true);
        try {
            const shipmentPayload: Database['public']['Tables']['inbound_shipments']['Insert'] = {
                supplier_name: shipmentForm.supplierName.trim(),
                origin_country: shipmentForm.originCountry.trim(),
                origin_city: shipmentForm.originCity.trim(),
                transport_mode: shipmentForm.transportMode,
                departure_date: shipmentForm.departureDate || null,
                eta_date: shipmentForm.etaDate || null,
                status: shipmentForm.status,
                notes: shipmentForm.notes.trim() || null,
                created_by: editingShipment?.created_by || profile.id
            };

            let shipmentId = editingShipment?.id || '';

            if (editingShipment) {
                const { error } = await supabase
                    .from('inbound_shipments')
                    .update(shipmentPayload)
                    .eq('id', editingShipment.id);
                if (error) throw error;

                const { error: deleteItemsError } = await supabase
                    .from('inbound_shipment_items')
                    .delete()
                    .eq('shipment_id', editingShipment.id);
                if (deleteItemsError) throw deleteItemsError;
            } else {
                const { data, error } = await supabase
                    .from('inbound_shipments')
                    .insert(shipmentPayload)
                    .select('id')
                    .single();
                if (error) throw error;
                shipmentId = data.id;
            }

            if (!shipmentId && editingShipment) {
                shipmentId = editingShipment.id;
            }

            const itemsPayload: Database['public']['Tables']['inbound_shipment_items']['Insert'][] = validItems.map((item) => {
                const inventoryItem = item.productId ? inventoryById.get(item.productId) : null;
                return {
                    shipment_id: shipmentId,
                    product_id: inventoryItem?.id || null,
                    sku_snapshot: (inventoryItem?.sku || item.skuSnapshot || 'SIN-SKU').trim(),
                    product_name_snapshot: (inventoryItem?.name || item.productNameSnapshot || 'Producto sin nombre').trim(),
                    qty: Math.trunc(item.qty)
                };
            });

            if (itemsPayload.length > 0) {
                const { error: insertItemsError } = await supabase
                    .from('inbound_shipment_items')
                    .insert(itemsPayload);
                if (insertItemsError) throw insertItemsError;
            }

            setShowShipmentModal(false);
            setEditingShipment(null);
            setShipmentForm(createEmptyShipmentForm());
            setShipmentPasteInput('');
            await fetchProcurementData();
        } catch (error: any) {
            console.error('Error saving inbound shipment:', error);
            alert(`Error guardando importación: ${error.message}`);
        } finally {
            setSavingShipment(false);
        }
    };

    const openManageRequestModal = (request: ProductRequestRow) => {
        setRequestToManage(request);
        setRequestManagementForm({
            status: request.status as RequestStatus,
            linkedShipmentId: request.linked_shipment_id || '',
            managerNote: request.manager_note || ''
        });
    };

    const handleSaveManagedRequest = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!requestToManage || !canManageProcurement) {
            return;
        }

        const nextShipmentId = requestManagementForm.linkedShipmentId || null;
        const nextStatus =
            nextShipmentId && requestManagementForm.status !== 'closed'
                ? 'included'
                : requestManagementForm.status;

        if (requestManagementForm.status === 'included' && !nextShipmentId) {
            alert('Para marcar una solicitud como incluida debes vincularla a una importación.');
            return;
        }

        setManagingRequest(true);
        try {
            const { error } = await supabase
                .from('product_requests')
                .update({
                    status: nextStatus,
                    linked_shipment_id: nextShipmentId,
                    manager_note: requestManagementForm.managerNote.trim() || null
                })
                .eq('id', requestToManage.id);

            if (error) throw error;

            setRequestToManage(null);
            await fetchProcurementData();
        } catch (error: any) {
            console.error('Error managing request:', error);
            alert(`Error actualizando solicitud: ${error.message}`);
        } finally {
            setManagingRequest(false);
        }
    };

    const handleMarkShipmentInWarehouse = async (shipment: ShipmentRow) => {
        if (!canManageProcurement) return;

        const confirmed = window.confirm(`¿Marcar ${shipment.supplier_name} como importación en bodega y cerrar el flujo?`);
        if (!confirmed) return;

        try {
            const { error } = await supabase
                .from('inbound_shipments')
                .update({ status: 'in_warehouse' })
                .eq('id', shipment.id);

            if (error) throw error;

            if (selectedShipment?.id === shipment.id) {
                setSelectedShipment({ ...shipment, status: 'in_warehouse' });
            }

            await fetchProcurementData();
        } catch (error: any) {
            console.error('Error marking shipment in warehouse:', error);
            alert(`Error marcando importación en bodega: ${error.message}`);
        }
    };

    const handleMarkShipmentReceived = async (shipment: ShipmentRow) => {
        if (!isAdmin) return;

        const confirmed = window.confirm(`¿Marcar ${shipment.supplier_name} como importación recibida?`);
        if (!confirmed) return;

        try {
            const { error } = await supabase
                .from('inbound_shipments')
                .update({ status: 'received' })
                .eq('id', shipment.id);

            if (error) throw error;

            if (selectedShipment?.id === shipment.id) {
                setSelectedShipment({ ...shipment, status: 'received' });
            }

            await fetchProcurementData();
        } catch (error: any) {
            console.error('Error marking shipment received:', error);
            alert(`Error marcando importación recibida: ${error.message}`);
        }
    };

    const shipmentDetailItems = useMemo(() => {
        if (!selectedShipment) return [];
        return shipmentItems.filter((item) => item.shipment_id === selectedShipment.id);
    }, [selectedShipment, shipmentItems]);

    const linkedRequests = useMemo(() => {
        if (!selectedShipment) return [];
        return requests.filter((request) => request.linked_shipment_id === selectedShipment.id);
    }, [requests, selectedShipment]);

    if (!canViewProcurement) {
        return (
            <div className="max-w-3xl mx-auto premium-card p-10 text-center">
                <AlertTriangle className="mx-auto mb-4 text-amber-500" size={36} />
                <h2 className="text-2xl font-black text-slate-900 mb-2">Sin acceso al módulo de compras</h2>
                <p className="text-slate-500 font-medium">Tu perfil no tiene permisos para ver solicitudes ni embarques.</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500 mb-2">Módulo de Compras</p>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900">Solicitudes e importaciones en tránsito</h1>
                    <p className="text-slate-500 font-medium mt-2">
                        Planificación comercial y visibilidad de compras sin alterar stock automáticamente.
                    </p>
                </div>
                <div className="flex flex-wrap gap-3">
                    {canRequestProducts && (
                        <button
                            onClick={openCreateRequestModal}
                            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 font-black text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700"
                        >
                            <Plus size={18} />
                            Nueva Solicitud
                        </button>
                    )}
                    {canManageProcurement && (
                        <button
                            onClick={() => openShipmentModal()}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 font-black text-slate-800 shadow-sm transition-all hover:bg-slate-50"
                        >
                            <ShipWheel size={18} />
                            Nueva Importación
                        </button>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="premium-card border-l-4 border-l-indigo-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Solicitudes Activas</p>
                            <h3 className="text-3xl font-black text-slate-900">{requests.filter((item) => item.status !== 'closed').length}</h3>
                        </div>
                        <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
                            <ClipboardList size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card border-l-4 border-l-sky-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Importaciones Activas</p>
                            <h3 className="text-3xl font-black text-slate-900">{activeShipments.length}</h3>
                        </div>
                        <div className="rounded-2xl bg-sky-50 p-3 text-sky-600">
                            <Plane size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card border-l-4 border-l-emerald-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Solicitudes Urgentes</p>
                            <h3 className="text-3xl font-black text-slate-900">{requests.filter((item) => item.priority === 'high' && item.status !== 'closed').length}</h3>
                        </div>
                        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                            <CheckCircle2 size={24} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => setActiveTab('shipments')}
                        className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'shipments' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        Importaciones en Tránsito
                    </button>
                    <button
                        onClick={() => setActiveTab('requests')}
                        className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'requests' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        Solicitudes de Productos
                    </button>
                </div>
            </div>

            {activeTab === 'requests' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-6">
                        <div className="relative xl:col-span-2">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar por SKU, producto, nota o solicitante..."
                                className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | RequestStatus)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300">
                            <option value="all">Todos los estados</option>
                            {Object.entries(REQUEST_STATUS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                        <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value as 'all' | RequestReason)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300">
                            <option value="all">Todos los motivos</option>
                            {Object.entries(REQUEST_REASON_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as 'all' | RequestPriority)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300">
                            <option value="all">Todas las prioridades</option>
                            {Object.entries(REQUEST_PRIORITY_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </select>
                        <select value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300">
                            <option value="all">Todos los solicitantes</option>
                            {profiles.map((requester) => (
                                <option key={requester.id} value={requester.id}>{getUserLabel(requester)}</option>
                            ))}
                        </select>
                    </div>

                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((index) => (
                                <div key={index} className="premium-card h-40 animate-pulse bg-slate-50" />
                            ))}
                        </div>
                    ) : (
                        <>
                            <div className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:block">
                                <div className="grid grid-cols-[1.5fr_1fr_0.9fr_0.9fr_1fr_1.1fr_0.9fr] gap-4 border-b border-slate-100 px-6 py-4 text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
                                    <span>Producto</span>
                                    <span>Solicitante</span>
                                    <span>Motivo</span>
                                    <span>Prioridad</span>
                                    <span>Necesidad</span>
                                    <span>Estado</span>
                                    <span className="text-right">Acciones</span>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {filteredRequests.map((request) => {
                                        const requester = profilesById.get(request.requester_id);
                                        const linkedShipment = request.linked_shipment_id ? shipmentsById.get(request.linked_shipment_id) : null;
                                        const canEditOwnRequest = canRequestProducts && request.requester_id === profile?.id && request.status === 'pending';

                                        return (
                                            <div key={request.id} className="grid grid-cols-[1.5fr_1fr_0.9fr_0.9fr_1fr_1.1fr_0.9fr] gap-4 px-6 py-5 text-sm">
                                                <div>
                                                    <p className="font-black text-slate-900">{request.product_name_snapshot}</p>
                                                    <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">{request.sku_snapshot}</p>
                                                    <p className="mt-2 text-xs text-slate-500">
                                                        Stock snapshot: <span className="font-bold">{request.current_stock_snapshot}</span> | Cantidad pedida: <span className="font-bold">{request.requested_qty}</span>
                                                    </p>
                                                    {request.request_note && (
                                                        <p className="mt-2 line-clamp-2 text-xs text-slate-500">{request.request_note}</p>
                                                    )}
                                                    {linkedShipment && (
                                                        <p className="mt-2 text-xs font-bold text-indigo-600">
                                                            Vinculada a {linkedShipment.supplier_name} · ETA {formatDate(linkedShipment.eta_date)}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="text-slate-600">
                                                    <p className="font-bold text-slate-800">{getUserLabel(requester)}</p>
                                                    <p className="mt-1 text-xs text-slate-400">{formatDateTime(request.created_at)}</p>
                                                </div>
                                                <div>
                                                    <span className="inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-700">
                                                        {REQUEST_REASON_LABELS[request.reason_type as RequestReason]}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${REQUEST_PRIORITY_STYLES[request.priority as RequestPriority]}`}>
                                                        {REQUEST_PRIORITY_LABELS[request.priority as RequestPriority]}
                                                    </span>
                                                </div>
                                                <div className="text-slate-600">
                                                    <p className="font-bold">{request.needed_by_date ? formatDate(request.needed_by_date) : 'Sin fecha'}</p>
                                                    {request.manager_note && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{request.manager_note}</p>}
                                                </div>
                                                <div>
                                                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${REQUEST_STATUS_STYLES[request.status as RequestStatus]}`}>
                                                        {REQUEST_STATUS_LABELS[request.status as RequestStatus]}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    {canEditOwnRequest && (
                                                        <>
                                                            <button onClick={() => openEditRequestModal(request)} className="text-xs font-black text-indigo-600 hover:text-indigo-700">
                                                                Editar
                                                            </button>
                                                            <button onClick={() => handleCloseRequest(request)} className="text-xs font-black text-rose-600 hover:text-rose-700">
                                                                Cerrar
                                                            </button>
                                                        </>
                                                    )}
                                                    {canManageProcurement && (
                                                        <button onClick={() => openManageRequestModal(request)} className="text-xs font-black text-slate-800 hover:text-slate-950">
                                                            Gestionar
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 lg:hidden">
                                {filteredRequests.map((request) => {
                                    const requester = profilesById.get(request.requester_id);
                                    const linkedShipment = request.linked_shipment_id ? shipmentsById.get(request.linked_shipment_id) : null;
                                    const canEditOwnRequest = canRequestProducts && request.requester_id === profile?.id && request.status === 'pending';

                                    return (
                                        <div key={request.id} className="premium-card space-y-4 p-5">
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <p className="text-lg font-black text-slate-900">{request.product_name_snapshot}</p>
                                                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-400">{request.sku_snapshot}</p>
                                                </div>
                                                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${REQUEST_STATUS_STYLES[request.status as RequestStatus]}`}>
                                                    {REQUEST_STATUS_LABELS[request.status as RequestStatus]}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3 text-sm text-slate-600">
                                                <div className="rounded-2xl bg-slate-50 p-3">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Solicitante</p>
                                                    <p className="mt-1 font-bold text-slate-800">{getUserLabel(requester)}</p>
                                                </div>
                                                <div className="rounded-2xl bg-slate-50 p-3">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Necesidad</p>
                                                    <p className="mt-1 font-bold text-slate-800">{request.needed_by_date ? formatDate(request.needed_by_date) : 'Sin fecha'}</p>
                                                </div>
                                                <div className="rounded-2xl bg-slate-50 p-3">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Motivo</p>
                                                    <p className="mt-1 font-bold text-slate-800">{REQUEST_REASON_LABELS[request.reason_type as RequestReason]}</p>
                                                </div>
                                                <div className="rounded-2xl bg-slate-50 p-3">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Prioridad</p>
                                                    <span className={`mt-1 inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${REQUEST_PRIORITY_STYLES[request.priority as RequestPriority]}`}>
                                                        {REQUEST_PRIORITY_LABELS[request.priority as RequestPriority]}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="rounded-2xl bg-indigo-50/60 p-4">
                                                <p className="text-xs font-bold text-slate-500">
                                                    Stock snapshot: <span className="text-slate-800">{request.current_stock_snapshot}</span> · Cantidad pedida: <span className="text-slate-800">{request.requested_qty}</span>
                                                </p>
                                                <p className="mt-2 text-sm text-slate-600">{request.request_note || 'Sin nota del solicitante.'}</p>
                                                {request.manager_note && (
                                                    <p className="mt-2 text-sm font-medium text-slate-700">Gestión: {request.manager_note}</p>
                                                )}
                                                {linkedShipment && (
                                                    <p className="mt-2 text-sm font-bold text-indigo-700">
                                                        Vinculada a {linkedShipment.supplier_name} · ETA {formatDate(linkedShipment.eta_date)}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {canEditOwnRequest && (
                                                    <>
                                                        <button onClick={() => openEditRequestModal(request)} className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700">
                                                            Editar
                                                        </button>
                                                        <button onClick={() => handleCloseRequest(request)} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700">
                                                            Cerrar
                                                        </button>
                                                    </>
                                                )}
                                                {canManageProcurement && (
                                                    <button onClick={() => openManageRequestModal(request)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-800">
                                                        Gestionar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {filteredRequests.length === 0 && (
                                <div className="premium-card p-10 text-center">
                                    <Filter className="mx-auto mb-4 text-slate-300" size={36} />
                                    <h3 className="text-xl font-black text-slate-900 mb-2">No hay solicitudes para los filtros actuales</h3>
                                    <p className="text-slate-500 font-medium">Prueba cambiando estado, prioridad o texto de búsqueda.</p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {activeTab === 'shipments' && (
                <div className="space-y-8">
                    {loading ? (
                        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            {[1, 2].map((index) => (
                                <div key={index} className="premium-card h-64 animate-pulse bg-slate-50" />
                            ))}
                        </div>
                    ) : (
                        <>
                            <div>
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <h2 className="text-2xl font-black text-slate-900">Importaciones activas</h2>
                                        <p className="text-slate-500 font-medium">Seguimiento visual de embarques y vuelos en camino a Chile.</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                    {activeShipments.map((shipment) => {
                                        const VehicleIcon = shipment.transport_mode === 'air' ? Plane : ShipWheel;
                                        const relatedItemsCount = shipmentItems.filter((item) => item.shipment_id === shipment.id).length;

                                        return (
                                            <button
                                                key={shipment.id}
                                                onClick={() => setSelectedShipment(shipment)}
                                                className="premium-card group w-full space-y-4 p-6 text-left transition-all hover:-translate-y-1 hover:shadow-2xl"
                                            >
                                                <div className="flex items-start justify-between gap-4">
                                                    <div>
                                                        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">{shipment.origin_city}, {shipment.origin_country}</p>
                                                        <h3 className="mt-2 text-2xl font-black text-slate-900">{shipment.supplier_name}</h3>
                                                    </div>
                                                    <div className={`rounded-3xl p-4 ${shipment.transport_mode === 'air' ? 'bg-sky-50 text-sky-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                                        <VehicleIcon size={28} />
                                                    </div>
                                                </div>
                                                <ShipmentProgressTrack shipment={shipment} />
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="rounded-2xl bg-slate-50 p-4">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">ETA</p>
                                                        <p className="mt-1 font-bold text-slate-900">{formatDate(shipment.eta_date)}</p>
                                                    </div>
                                                    <div className="rounded-2xl bg-slate-50 p-4">
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Productos</p>
                                                        <p className="mt-1 font-bold text-slate-900">{relatedItemsCount}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${SHIPMENT_STATUS_STYLES[shipment.status as ShipmentStatus]}`}>
                                                            {SHIPMENT_STATUS_LABELS[shipment.status as ShipmentStatus]}
                                                        </span>
                                                        {isAdmin && shipment.status !== 'received' && shipment.status !== 'in_warehouse' && (
                                                            <button
                                                                type="button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    void handleMarkShipmentReceived(shipment);
                                                                }}
                                                                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-700 transition-all hover:bg-emerald-100"
                                                            >
                                                                Marcar Recibida
                                                            </button>
                                                        )}
                                                    </div>
                                                    <span className="text-xs font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600">
                                                        Ver detalle
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {activeShipments.length === 0 && (
                                    <div className="premium-card mt-4 p-10 text-center">
                                        <ShipWheel className="mx-auto mb-4 text-slate-300" size={36} />
                                        <h3 className="text-xl font-black text-slate-900 mb-2">No hay importaciones activas</h3>
                                        <p className="text-slate-500 font-medium">Cuando compras registre un embarque o vuelo, aparecerá aquí.</p>
                                    </div>
                                )}
                            </div>

                            <div>
                                <h2 className="text-2xl font-black text-slate-900">Historial cerrado</h2>
                                <p className="text-slate-500 font-medium mb-4">Importaciones que ya fueron marcadas en bodega y cerraron su flujo, sin mover stock automáticamente.</p>
                                <div className="space-y-3">
                                    {closedShipments.map((shipment) => (
                                        <button
                                            key={shipment.id}
                                            onClick={() => setSelectedShipment(shipment)}
                                            className="w-full rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-emerald-200 hover:bg-emerald-50/40"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div>
                                                    <p className="text-sm font-black text-slate-900">{shipment.supplier_name}</p>
                                                    <p className="mt-1 text-xs font-medium text-slate-500">{shipment.origin_city}, {shipment.origin_country} · ETA {formatDate(shipment.eta_date)}</p>
                                                </div>
                                                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wide ${SHIPMENT_STATUS_STYLES[shipment.status as ShipmentStatus]}`}>
                                                    {SHIPMENT_STATUS_LABELS[shipment.status as ShipmentStatus]}
                                                </span>
                                            </div>
                                        </button>
                                    ))}
                                    {closedShipments.length === 0 && (
                                        <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-8 text-center text-sm font-medium text-slate-500">
                                            Todavía no hay importaciones marcadas en bodega.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {showRequestModal && (
                <div className="fixed inset-0 z-[220] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowRequestModal(false)}>
                    <div className="w-full max-w-2xl rounded-[2rem] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-indigo-500">{editingRequest ? 'Editar' : 'Nueva'}</p>
                                <h3 className="text-2xl font-black text-slate-900">Solicitud de producto</h3>
                            </div>
                            <button onClick={() => setShowRequestModal(false)} className="rounded-2xl bg-slate-100 p-3 text-slate-500 transition-all hover:bg-slate-200">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveRequest} className="space-y-5 p-6">
                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Buscar producto</label>
                                <div className="relative mb-3">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        value={requestProductSearch}
                                        onChange={(event) => setRequestProductSearch(event.target.value)}
                                        placeholder="Busca por SKU o nombre..."
                                        className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300"
                                    />
                                </div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Producto</label>
                                <select
                                    value={requestForm.productId}
                                    onChange={(event) => {
                                        const nextProductId = event.target.value;
                                        const selectedProduct = inventoryById.get(nextProductId);
                                        setRequestForm((current) => ({ ...current, productId: nextProductId }));
                                        if (selectedProduct) {
                                            setRequestProductSearch(`${selectedProduct.sku || ''} ${selectedProduct.name}`.trim());
                                        }
                                    }}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                    required
                                >
                                    <option value="">Selecciona un producto</option>
                                    {filteredInventoryForRequest.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {(item.sku || 'SIN-SKU')} · {item.name} · Stock {item.stock_qty || 0}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-2 text-xs text-slate-400">
                                    {filteredInventoryForRequest.length} producto(s) encontrados por SKU o nombre.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Cantidad Solicitada</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={requestForm.requestedQty}
                                        onChange={(event) => setRequestForm((current) => ({ ...current, requestedQty: Math.max(1, Number(event.target.value || 1)) }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Fecha Necesaria</label>
                                    <input
                                        type="date"
                                        value={requestForm.neededByDate}
                                        onChange={(event) => setRequestForm((current) => ({ ...current, neededByDate: event.target.value }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Motivo</label>
                                    <select
                                        value={requestForm.reasonType}
                                        onChange={(event) => setRequestForm((current) => ({ ...current, reasonType: event.target.value as RequestReason }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                    >
                                        {Object.entries(REQUEST_REASON_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Prioridad</label>
                                    <select
                                        value={requestForm.priority}
                                        onChange={(event) => setRequestForm((current) => ({ ...current, priority: event.target.value as RequestPriority }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                    >
                                        {Object.entries(REQUEST_PRIORITY_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Contexto Comercial</label>
                                <textarea
                                    value={requestForm.requestNote}
                                    onChange={(event) => setRequestForm((current) => ({ ...current, requestNote: event.target.value }))}
                                    rows={4}
                                    placeholder="Explica por qué necesitas este producto, volumen esperado o cliente asociado."
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300"
                                />
                            </div>

                            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                                <button type="button" onClick={() => setShowRequestModal(false)} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={savingRequest} className="rounded-2xl bg-indigo-600 px-5 py-3 font-black text-white shadow-lg shadow-indigo-100 disabled:opacity-60">
                                    {savingRequest ? 'Guardando...' : editingRequest ? 'Guardar Cambios' : 'Crear Solicitud'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showShipmentModal && canManageProcurement && (
                <div className="fixed inset-0 z-[225] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowShipmentModal(false)}>
                    <div className="w-full max-w-4xl rounded-[2rem] bg-white shadow-2xl max-h-[92vh] overflow-hidden" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-sky-500">{editingShipment ? 'Editar' : 'Nueva'}</p>
                                <h3 className="text-2xl font-black text-slate-900">Importación en tránsito</h3>
                            </div>
                            <button onClick={() => setShowShipmentModal(false)} className="rounded-2xl bg-slate-100 p-3 text-slate-500 transition-all hover:bg-slate-200">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveShipment} className="flex max-h-[calc(92vh-88px)] flex-col">
                            <div className="space-y-5 overflow-y-auto p-6">
                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Proveedor</label>
                                        <input
                                            value={shipmentForm.supplierName}
                                            onChange={(event) => setShipmentForm((current) => ({ ...current, supplierName: event.target.value }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Vía</label>
                                        <select
                                            value={shipmentForm.transportMode}
                                            onChange={(event) => setShipmentForm((current) => ({ ...current, transportMode: event.target.value as ShipmentMode }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                        >
                                            <option value="sea">Barco</option>
                                            <option value="air">Avión</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">País de origen</label>
                                        <input
                                            value={shipmentForm.originCountry}
                                            onChange={(event) => setShipmentForm((current) => ({ ...current, originCountry: event.target.value }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Ciudad de origen</label>
                                        <input
                                            value={shipmentForm.originCity}
                                            onChange={(event) => setShipmentForm((current) => ({ ...current, originCity: event.target.value }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                    <div>
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Salida</label>
                                        <input
                                            type="date"
                                            value={shipmentForm.departureDate}
                                            onChange={(event) => setShipmentForm((current) => ({ ...current, departureDate: event.target.value }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">ETA Chile</label>
                                        <input
                                            type="date"
                                            value={shipmentForm.etaDate}
                                            onChange={(event) => setShipmentForm((current) => ({ ...current, etaDate: event.target.value }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Estado</label>
                                        <select
                                            value={shipmentForm.status}
                                            onChange={(event) => setShipmentForm((current) => ({ ...current, status: event.target.value as ShipmentStatus }))}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                        >
                                            {Object.entries(SHIPMENT_STATUS_LABELS).map(([value, label]) => (
                                                <option key={value} value={value}>{label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Notas</label>
                                    <textarea
                                        rows={3}
                                        value={shipmentForm.notes}
                                        onChange={(event) => setShipmentForm((current) => ({ ...current, notes: event.target.value }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-medium text-slate-700 outline-none focus:border-indigo-300"
                                    />
                                </div>

                                <div className="space-y-4 rounded-[2rem] border border-slate-100 bg-slate-50/80 p-5">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Productos en la importación</p>
                                            <h4 className="text-xl font-black text-slate-900">Detalle de carga</h4>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShipmentForm((current) => ({ ...current, items: [...current.items, { localId: crypto.randomUUID(), productId: '', skuSnapshot: '', productNameSnapshot: '', qty: 1 }] }))}
                                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-800"
                                        >
                                            Agregar producto
                                        </button>
                                    </div>

                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4">
                                        <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Pegar listado rápido</label>
                                        <textarea
                                            rows={4}
                                            value={shipmentPasteInput}
                                            onChange={(event) => setShipmentPasteInput(event.target.value)}
                                            placeholder={'Una línea por producto.\nFormato: SKU, Producto, Cantidad\nO bien: Producto, Cantidad'}
                                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-medium text-slate-700 outline-none focus:border-indigo-300"
                                        />
                                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <p className="text-xs text-slate-500">
                                                Puedes guardar la importación sin productos y completar el detalle después.
                                            </p>
                                            <button
                                                type="button"
                                                onClick={handleApplyShipmentPaste}
                                                className="rounded-2xl border border-slate-200 bg-slate-900 px-4 py-2 text-xs font-black text-white"
                                            >
                                                Cargar listado pegado
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        {shipmentForm.items.map((item, index) => (
                                            <div key={item.localId} className="grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 md:grid-cols-[1.2fr_0.8fr_1.2fr_0.5fr_auto]">
                                                <select
                                                    value={item.productId}
                                                    onChange={(event) => {
                                                        const nextItems = [...shipmentForm.items];
                                                        const nextProductId = event.target.value;
                                                        const selectedProduct = inventoryById.get(nextProductId);
                                                        nextItems[index] = {
                                                            ...nextItems[index],
                                                            productId: nextProductId,
                                                            skuSnapshot: selectedProduct?.sku || nextItems[index].skuSnapshot,
                                                            productNameSnapshot: selectedProduct?.name || nextItems[index].productNameSnapshot
                                                        };
                                                        setShipmentForm((current) => ({ ...current, items: nextItems }));
                                                    }}
                                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                                >
                                                    <option value="">Tomar desde inventario (opcional)</option>
                                                    {inventory.map((inventoryItem) => (
                                                        <option key={inventoryItem.id} value={inventoryItem.id}>
                                                            {(inventoryItem.sku || 'SIN-SKU')} · {inventoryItem.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <input
                                                    value={item.skuSnapshot}
                                                    onChange={(event) => {
                                                        const nextItems = [...shipmentForm.items];
                                                        nextItems[index] = { ...nextItems[index], skuSnapshot: event.target.value };
                                                        setShipmentForm((current) => ({ ...current, items: nextItems }));
                                                    }}
                                                    placeholder="SKU (opcional)"
                                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                                />
                                                <input
                                                    value={item.productNameSnapshot}
                                                    onChange={(event) => {
                                                        const nextItems = [...shipmentForm.items];
                                                        nextItems[index] = { ...nextItems[index], productNameSnapshot: event.target.value };
                                                        setShipmentForm((current) => ({ ...current, items: nextItems }));
                                                    }}
                                                    placeholder="Nombre del producto"
                                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                                />
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={item.qty}
                                                    onChange={(event) => {
                                                        const nextItems = [...shipmentForm.items];
                                                        nextItems[index] = { ...nextItems[index], qty: Math.max(1, Number(event.target.value || 1)) };
                                                        setShipmentForm((current) => ({ ...current, items: nextItems }));
                                                    }}
                                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShipmentForm((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((row) => row.localId !== item.localId) : current.items }))}
                                                    className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-xs font-black text-rose-700"
                                                >
                                                    Quitar
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:justify-end">
                                <button type="button" onClick={() => setShowShipmentModal(false)} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={savingShipment} className="rounded-2xl bg-slate-900 px-5 py-3 font-black text-white shadow-lg shadow-slate-200 disabled:opacity-60">
                                    {savingShipment ? 'Guardando...' : editingShipment ? 'Guardar Importación' : 'Crear Importación'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {selectedShipment && (
                <div className="fixed inset-0 z-[230] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedShipment(null)}>
                    <div className="w-full max-w-4xl rounded-[2rem] bg-white shadow-2xl max-h-[92vh] overflow-hidden" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-sky-500">Importación</p>
                                <h3 className="text-2xl font-black text-slate-900">{selectedShipment.supplier_name}</h3>
                            </div>
                            <div className="flex items-center gap-3">
                                {canManageProcurement && selectedShipment.status === 'received' && (
                                    <button
                                        onClick={() => handleMarkShipmentInWarehouse(selectedShipment)}
                                        className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-black text-white"
                                    >
                                        Marcar en Bodega
                                    </button>
                                )}
                                {canManageProcurement && (
                                    <button
                                        onClick={() => {
                                            setSelectedShipment(null);
                                            openShipmentModal(selectedShipment);
                                        }}
                                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-800"
                                    >
                                        Editar
                                    </button>
                                )}
                                <button onClick={() => setSelectedShipment(null)} className="rounded-2xl bg-slate-100 p-3 text-slate-500 transition-all hover:bg-slate-200">
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="space-y-6 overflow-y-auto p-6">
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div className="space-y-4">
                                    <ShipmentProgressTrack shipment={selectedShipment} />
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl bg-slate-50 p-4">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Origen</p>
                                            <p className="mt-1 font-bold text-slate-900">{selectedShipment.origin_city}, {selectedShipment.origin_country}</p>
                                        </div>
                                        <div className="rounded-2xl bg-slate-50 p-4">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vía</p>
                                            <p className="mt-1 font-bold text-slate-900">{selectedShipment.transport_mode === 'air' ? 'Avión' : 'Barco'}</p>
                                        </div>
                                        <div className="rounded-2xl bg-slate-50 p-4">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Salida</p>
                                            <p className="mt-1 font-bold text-slate-900">{formatDate(selectedShipment.departure_date)}</p>
                                        </div>
                                        <div className="rounded-2xl bg-slate-50 p-4">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">ETA</p>
                                            <p className="mt-1 font-bold text-slate-900">{formatDate(selectedShipment.eta_date)}</p>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl bg-white border border-slate-200 p-4">
                                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${SHIPMENT_STATUS_STYLES[selectedShipment.status as ShipmentStatus]}`}>
                                            {SHIPMENT_STATUS_LABELS[selectedShipment.status as ShipmentStatus]}
                                        </span>
                                        <p className="mt-3 text-sm text-slate-600">{selectedShipment.notes || 'Sin notas registradas.'}</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-[2rem] border border-slate-100 bg-slate-50/70 p-5">
                                        <div className="mb-4 flex items-center gap-2">
                                            <Package className="text-slate-500" size={18} />
                                            <h4 className="text-lg font-black text-slate-900">Productos que vienen</h4>
                                        </div>
                                        <div className="space-y-3">
                                            {shipmentDetailItems.map((item) => (
                                                <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
                                                    <div className="flex items-start justify-between gap-4">
                                                        <div>
                                                            <p className="font-black text-slate-900">{item.product_name_snapshot}</p>
                                                            <p className="text-xs font-black uppercase tracking-widest text-slate-400">{item.sku_snapshot}</p>
                                                        </div>
                                                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                                                            {item.qty} uds
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                            {shipmentDetailItems.length === 0 && (
                                                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                                                    Esta importación no tiene productos cargados.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-[2rem] border border-slate-100 bg-slate-50/70 p-5">
                                        <div className="mb-4 flex items-center gap-2">
                                            <Link2 className="text-slate-500" size={18} />
                                            <h4 className="text-lg font-black text-slate-900">Solicitudes vinculadas</h4>
                                        </div>
                                        <div className="space-y-3">
                                            {linkedRequests.map((request) => (
                                                <div key={request.id} className="rounded-2xl bg-white p-4 shadow-sm">
                                                    <p className="font-black text-slate-900">{request.product_name_snapshot}</p>
                                                    <p className="mt-1 text-xs text-slate-500">
                                                        {getUserLabel(profilesById.get(request.requester_id))} · {request.requested_qty} uds · {REQUEST_STATUS_LABELS[request.status as RequestStatus]}
                                                    </p>
                                                </div>
                                            ))}
                                            {linkedRequests.length === 0 && (
                                                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                                                    Todavía no hay solicitudes asociadas a esta importación.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {requestToManage && canManageProcurement && (
                <div className="fixed inset-0 z-[235] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setRequestToManage(null)}>
                    <div className="w-full max-w-2xl rounded-[2rem] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-500">Gestión</p>
                                <h3 className="text-2xl font-black text-slate-900">{requestToManage.product_name_snapshot}</h3>
                            </div>
                            <button onClick={() => setRequestToManage(null)} className="rounded-2xl bg-slate-100 p-3 text-slate-500 transition-all hover:bg-slate-200">
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveManagedRequest} className="space-y-5 p-6">
                            <div className="rounded-[2rem] border border-slate-100 bg-slate-50/80 p-5">
                                <p className="text-sm font-bold text-slate-800">
                                    Solicitante: {getUserLabel(profilesById.get(requestToManage.requester_id))}
                                </p>
                                <p className="mt-2 text-sm text-slate-500">
                                    Creada el {formatDateTime(requestToManage.created_at)} · Stock snapshot {requestToManage.current_stock_snapshot} · Cantidad solicitada {requestToManage.requested_qty}
                                </p>
                                <p className="mt-3 text-sm text-slate-600">{requestToManage.request_note || 'Sin nota del solicitante.'}</p>
                            </div>

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Estado</label>
                                    <select
                                        value={requestManagementForm.status}
                                        onChange={(event) => setRequestManagementForm((current) => ({ ...current, status: event.target.value as RequestStatus }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                    >
                                        {Object.entries(REQUEST_STATUS_LABELS).map(([value, label]) => (
                                            <option key={value} value={value}>{label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Importación asociada</label>
                                    <select
                                        value={requestManagementForm.linkedShipmentId}
                                        onChange={(event) => setRequestManagementForm((current) => ({ ...current, linkedShipmentId: event.target.value }))}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                    >
                                        <option value="">Sin vincular</option>
                                        {activeShipments.map((shipment) => (
                                            <option key={shipment.id} value={shipment.id}>
                                                {shipment.supplier_name} · ETA {formatDate(shipment.eta_date)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Nota de gestión</label>
                                <textarea
                                    rows={4}
                                    value={requestManagementForm.managerNote}
                                    onChange={(event) => setRequestManagementForm((current) => ({ ...current, managerNote: event.target.value }))}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-medium text-slate-700 outline-none focus:border-indigo-300"
                                    placeholder="Ej: se incluyó en compra con proveedor X, ETA estimada..."
                                />
                            </div>

                            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                                <button type="button" onClick={() => setRequestToManage(null)} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={managingRequest} className="rounded-2xl bg-emerald-600 px-5 py-3 font-black text-white shadow-lg shadow-emerald-100 disabled:opacity-60">
                                    {managingRequest ? 'Guardando...' : 'Guardar Gestión'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Procurement;
