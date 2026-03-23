import React, { useEffect, useMemo, useState } from 'react';
import { read, utils } from 'xlsx';
import {
    Building2,
    CalendarClock,
    Camera,
    CheckCircle2,
    ChevronRight,
    Download,
    FileSpreadsheet,
    Hash,
    History as HistoryIcon,
    MapPin,
    PackageCheck,
    RotateCcw,
    Truck,
    Upload,
    User,
    X
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

type DispatchTab = 'upload' | 'queue' | 'routes' | 'history';

type DispatchImportRow = {
    row_number: number;
    invoice_number: string;
    client_rut: string;
    crm_order_number: string;
};

type DispatchImportError = {
    row_number: number;
    invoice_number: string;
    client_rut: string;
    crm_order_number: string;
    reason: string;
};

type ProfileLite = {
    id: string;
    email: string | null;
    role: string | null;
    full_name?: string | null;
};

type DispatchBatch = {
    id: string;
    file_name: string;
    uploaded_by: string;
    row_count: number;
    created_at: string;
};

type DispatchQueueItem = {
    id: string;
    batch_id: string;
    order_id: string;
    client_id: string;
    seller_id: string | null;
    route_id: string | null;
    assigned_driver_id: string | null;
    invoice_number: string;
    client_rut_input: string;
    client_rut_normalized: string;
    order_folio_input: string;
    client_name_snapshot: string;
    client_address_snapshot: string | null;
    client_comuna_snapshot: string | null;
    client_office_snapshot: string | null;
    client_phone_snapshot: string | null;
    client_lat_snapshot: number | null;
    client_lng_snapshot: number | null;
    seller_name_snapshot: string | null;
    seller_email_snapshot: string | null;
    order_total_snapshot: number | null;
    status: 'queued' | 'routed' | 'delivered' | 'cancelled';
    imported_at: string;
    routed_at: string | null;
    delivered_at: string | null;
    cancelled_at: string | null;
    notes: string | null;
};

type DeliveryRouteSummary = {
    id: string;
    name: string;
    driver_id: string | null;
    status: string;
    created_at: string;
    order_count: number;
    pending_count: number;
    completed_count: number;
};

type RouteDetailItem = {
    id: string;
    order_id: string;
    sequence_order: number;
    status: string;
    delivered_at: string | null;
    proof_photo_url: string | null;
    order_folio: number | null;
    client_name: string;
    client_address: string;
    client_office: string | null;
    invoice_number: string | null;
    seller_name: string | null;
};

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeInvoice = (value: unknown) => normalizeText(value);
const normalizeRut = (value: unknown) => normalizeText(value).replace(/[^0-9kK]/g, '').toUpperCase();
const normalizeOrderNumber = (value: unknown) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    if (/^\d+(\.0+)?$/.test(raw)) {
        return String(Math.trunc(Number(raw)));
    }
    return raw.replace(/\s+/g, '');
};
const cleanComparableText = (value: unknown) =>
    normalizeText(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

const getValueByAliases = (row: Record<string, any>, aliases: string[]) => {
    const keyMap = new Map<string, string>();
    Object.keys(row || {}).forEach((key) => keyMap.set(cleanComparableText(key), key));
    for (const alias of aliases) {
        const matchedKey = keyMap.get(cleanComparableText(alias));
        if (matchedKey) return row[matchedKey];
    }
    return undefined;
};

const isImportRowEmpty = (row: DispatchImportRow) =>
    !row.invoice_number && !row.client_rut && !row.crm_order_number;

const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString('es-CL');
    } catch {
        return '—';
    }
};

const formatCurrency = (value: number | null | undefined) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
};

const queueStatusLabel: Record<DispatchQueueItem['status'], string> = {
    queued: 'Pendiente',
    routed: 'En Ruta',
    delivered: 'Entregado',
    cancelled: 'Cancelado'
};

const queueStatusClass: Record<DispatchQueueItem['status'], string> = {
    queued: 'bg-amber-50 text-amber-700 border-amber-100',
    routed: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    cancelled: 'bg-red-50 text-red-700 border-red-100'
};

const routeStatusLabel = (status: string) => {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === 'completed') return 'Completada';
    if (normalized === 'draft' || normalized === 'planning') return 'Planificación';
    return 'Activa';
};

const routeStatusClass = (status: string) => {
    const normalized = normalizeText(status).toLowerCase();
    if (normalized === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    if (normalized === 'draft' || normalized === 'planning') return 'bg-amber-50 text-amber-700 border-amber-100';
    return 'bg-indigo-50 text-indigo-700 border-indigo-100';
};

const parseRpcValidationErrors = (error: any): DispatchImportError[] | null => {
    const rawMessage = String(error?.message || '').trim();
    if (!rawMessage) return null;

    const candidates = [rawMessage];
    const jsonStart = rawMessage.indexOf('{');
    const jsonEnd = rawMessage.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
        candidates.push(rawMessage.slice(jsonStart, jsonEnd + 1));
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed?.type === 'validation' && Array.isArray(parsed.errors)) {
                return parsed.errors.map((item: any) => ({
                    row_number: Number(item?.row_number || 0),
                    invoice_number: normalizeText(item?.invoice_number),
                    client_rut: normalizeText(item?.client_rut),
                    crm_order_number: normalizeText(item?.crm_order_number),
                    reason: normalizeText(item?.reason) || 'Error de validación'
                }));
            }
        } catch {
            // ignore
        }
    }

    return null;
};

const Dispatch: React.FC = () => {
    const { effectiveRole, hasPermission } = useUser();
    const canManageDispatch = hasPermission('MANAGE_DISPATCH') || effectiveRole === 'admin' || effectiveRole === 'facturador';

    const [activeTab, setActiveTab] = useState<DispatchTab>('queue');
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [batches, setBatches] = useState<DispatchBatch[]>([]);
    const [queueItems, setQueueItems] = useState<DispatchQueueItem[]>([]);
    const [routes, setRoutes] = useState<DeliveryRouteSummary[]>([]);
    const [drivers, setDrivers] = useState<ProfileLite[]>([]);
    const [driverMap, setDriverMap] = useState<Record<string, ProfileLite>>({});
    const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
    const [bulkDriverId, setBulkDriverId] = useState('');
    const [queueSearch, setQueueSearch] = useState('');
    const [historySearch, setHistorySearch] = useState('');
    const [importErrors, setImportErrors] = useState<DispatchImportError[]>([]);
    const [selectedRoute, setSelectedRoute] = useState<DeliveryRouteSummary | null>(null);
    const [routeDetails, setRouteDetails] = useState<RouteDetailItem[] | null>(null);
    const [proofViewerUrl, setProofViewerUrl] = useState<string | null>(null);

    const fetchDrivers = async () => {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, email, role, full_name')
            .eq('role', 'driver')
            .order('full_name', { ascending: true });

        if (error) throw error;
        const rows = (data || []) as ProfileLite[];
        setDrivers(rows);
        setDriverMap(rows.reduce<Record<string, ProfileLite>>((acc, item) => {
            acc[item.id] = item;
            return acc;
        }, {}));
    };

    const fetchBatches = async () => {
        const { data, error } = await supabase
            .from('dispatch_import_batches')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        const rows = (data || []) as DispatchBatch[];
        setBatches(rows);
    };

    const fetchQueueItems = async () => {
        const { data, error } = await supabase
            .from('dispatch_queue_items')
            .select('*')
            .order('imported_at', { ascending: false })
            .limit(1000);

        if (error) throw error;
        setQueueItems((data || []) as DispatchQueueItem[]);
    };

    const fetchRoutes = async () => {
        const { data: routesData, error: routesError } = await supabase
            .from('delivery_routes')
            .select('*')
            .eq('status', 'in_progress')
            .order('created_at', { ascending: false });

        if (routesError) throw routesError;

        const routeRows = (routesData || []) as Array<{ id: string; name: string; driver_id: string | null; status: string; created_at: string }>;
        if (routeRows.length === 0) {
            setRoutes([]);
            return;
        }

        const routeIds = routeRows.map((route) => route.id);
        const { data: itemRows, error: itemError } = await supabase
            .from('route_items')
            .select('route_id, status')
            .in('route_id', routeIds);

        if (itemError) throw itemError;

        const itemsByRoute = new Map<string, Array<{ route_id: string | null; status: string }>>();
        (itemRows || []).forEach((item: any) => {
            if (!item.route_id) return;
            if (!itemsByRoute.has(item.route_id)) itemsByRoute.set(item.route_id, []);
            itemsByRoute.get(item.route_id)!.push(item);
        });

        const summaries: DeliveryRouteSummary[] = routeRows.map((route) => {
            const routeItems = itemsByRoute.get(route.id) || [];
            const pendingCount = routeItems.filter((item) => ['pending', 'rescheduled', 'failed'].includes(normalizeText(item.status).toLowerCase())).length;
            const completedCount = routeItems.filter((item) => normalizeText(item.status).toLowerCase() === 'delivered').length;
            return {
                id: route.id,
                name: route.name,
                driver_id: route.driver_id,
                status: route.status,
                created_at: route.created_at,
                order_count: routeItems.length,
                pending_count: pendingCount,
                completed_count: completedCount
            };
        });

        setRoutes(summaries);
    };

    const refreshAll = async () => {
        setLoading(true);
        try {
            await Promise.all([fetchDrivers(), fetchBatches(), fetchQueueItems(), fetchRoutes()]);
        } catch (error: any) {
            console.error('Error loading dispatch module:', error);
            alert(`Error cargando despacho: ${error?.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!canManageDispatch) return;
        refreshAll();
    }, [canManageDispatch]);

    const queuedItems = useMemo(() => queueItems.filter((item) => item.status === 'queued'), [queueItems]);
    const routedItems = useMemo(() => queueItems.filter((item) => item.status === 'routed'), [queueItems]);
    const historyItems = useMemo(() => queueItems.filter((item) => item.status === 'delivered' || item.status === 'cancelled'), [queueItems]);

    const filteredQueueItems = useMemo(() => {
        const term = cleanComparableText(queueSearch);
        if (!term) return queuedItems;
        return queuedItems.filter((item) => {
            const driver = item.assigned_driver_id ? driverMap[item.assigned_driver_id] : null;
            return [
                item.invoice_number,
                item.order_folio_input,
                item.client_rut_input,
                item.client_name_snapshot,
                item.client_address_snapshot,
                item.client_comuna_snapshot,
                item.seller_name_snapshot,
                item.seller_email_snapshot,
                driver?.full_name,
                driver?.email
            ].some((value) => cleanComparableText(value).includes(term));
        });
    }, [queuedItems, queueSearch, driverMap]);

    const filteredHistoryItems = useMemo(() => {
        const term = cleanComparableText(historySearch);
        if (!term) return historyItems;
        return historyItems.filter((item) => {
            const driver = item.assigned_driver_id ? driverMap[item.assigned_driver_id] : null;
            return [
                item.invoice_number,
                item.order_folio_input,
                item.client_rut_input,
                item.client_name_snapshot,
                item.seller_name_snapshot,
                driver?.full_name,
                driver?.email,
                item.notes
            ].some((value) => cleanComparableText(value).includes(term));
        });
    }, [historyItems, historySearch, driverMap]);

    const latestBatch = batches[0] || null;

    const handleDownloadImportTemplate = () => {
        const headers = ['numero_factura', 'rut_cliente', 'numero_pedido_crm'];
        const example = ['FAC-100234', '76.123.456-7', '100234'];
        const csv = [headers.join(','), example.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'formato_despacho_facturas.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleDownloadImportErrors = () => {
        if (importErrors.length === 0) return;
        const rows = [
            ['fila', 'numero_factura', 'rut_cliente', 'numero_pedido_crm', 'error'],
            ...importErrors.map((item) => [item.row_number, item.invoice_number, item.client_rut, item.crm_order_number, item.reason])
        ];
        const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'errores_importacion_despacho.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setImportErrors([]);

        try {
            const data = await file.arrayBuffer();
            const workbook = read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rawRows: Record<string, any>[] = utils.sheet_to_json(worksheet, { defval: '' });

            const parsedRows: DispatchImportRow[] = rawRows
                .map((row, index) => ({
                    row_number: index + 2,
                    invoice_number: normalizeInvoice(getValueByAliases(row, ['numero_factura', 'factura', 'nro_factura', 'folio_factura'])),
                    client_rut: normalizeText(getValueByAliases(row, ['rut_cliente', 'rut'])),
                    crm_order_number: normalizeOrderNumber(getValueByAliases(row, ['numero_pedido_crm', 'pedido', 'pedido_crm', 'folio_pedido']))
                }))
                .filter((row) => !isImportRowEmpty(row));

            if (parsedRows.length === 0) {
                throw new Error('El archivo no contiene filas con numero_factura, rut_cliente y numero_pedido_crm.');
            }

            const { error } = await supabase.rpc('import_dispatch_invoice_batch', {
                p_rows: parsedRows,
                p_file_name: file.name
            });

            if (error) {
                const validationErrors = parseRpcValidationErrors(error);
                if (validationErrors) {
                    setImportErrors(validationErrors);
                    setActiveTab('upload');
                    return;
                }
                throw error;
            }

            alert(`Carga realizada correctamente. Se agregaron ${parsedRows.length} filas a la cola de despacho.`);
            setSelectedQueueIds(new Set());
            setBulkDriverId('');
            setActiveTab('queue');
            await refreshAll();
        } catch (error: any) {
            console.error('Error importing dispatch file:', error);
            alert(`Error al importar despacho: ${error?.message || 'desconocido'}`);
        } finally {
            setUploading(false);
            event.target.value = '';
        }
    };

    const toggleQueueSelection = (queueItemId: string) => {
        setSelectedQueueIds((prev) => {
            const next = new Set(prev);
            if (next.has(queueItemId)) next.delete(queueItemId);
            else next.add(queueItemId);
            return next;
        });
    };

    const handleSelectAllQueue = (checked: boolean) => {
        if (checked) {
            setSelectedQueueIds(new Set(filteredQueueItems.map((item) => item.id)));
            return;
        }
        setSelectedQueueIds(new Set());
    };

    const persistAssignedDriver = async (queueItemId: string, driverId: string) => {
        try {
            const { error } = await supabase
                .from('dispatch_queue_items')
                .update({ assigned_driver_id: driverId || null })
                .eq('id', queueItemId)
                .eq('status', 'queued');
            if (error) throw error;
            setQueueItems((prev) => prev.map((item) => item.id === queueItemId ? { ...item, assigned_driver_id: driverId || null } : item));
        } catch (error: any) {
            console.error('Error assigning driver:', error);
            alert(`No se pudo asignar repartidor: ${error?.message || 'desconocido'}`);
        }
    };

    const handleBulkAssignDriver = async () => {
        if (!bulkDriverId || selectedQueueIds.size === 0) return;
        try {
            const selectedIds = Array.from(selectedQueueIds);
            const { error } = await supabase
                .from('dispatch_queue_items')
                .update({ assigned_driver_id: bulkDriverId })
                .in('id', selectedIds)
                .eq('status', 'queued');
            if (error) throw error;
            setQueueItems((prev) => prev.map((item) => selectedQueueIds.has(item.id) ? { ...item, assigned_driver_id: bulkDriverId } : item));
            setBulkDriverId('');
        } catch (error: any) {
            console.error('Error bulk assigning driver:', error);
            alert(`No se pudo asignar repartidor masivamente: ${error?.message || 'desconocido'}`);
        }
    };

    const handleCancelQueueItem = async (item: DispatchQueueItem) => {
        if (!window.confirm(`¿Cancelar el despacho pendiente de la factura ${item.invoice_number}?`)) return;
        try {
            const { error } = await supabase
                .from('dispatch_queue_items')
                .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
                .eq('id', item.id)
                .eq('status', 'queued');
            if (error) throw error;
            setQueueItems((prev) => prev.map((row) => row.id === item.id ? { ...row, status: 'cancelled', cancelled_at: new Date().toISOString() } : row));
            setSelectedQueueIds((prev) => {
                const next = new Set(prev);
                next.delete(item.id);
                return next;
            });
        } catch (error: any) {
            console.error('Error cancelling queue item:', error);
            alert(`No se pudo cancelar el item de despacho: ${error?.message || 'desconocido'}`);
        }
    };

    const handleCreateRoutes = async () => {
        const selectedItems = filteredQueueItems.filter((item) => selectedQueueIds.has(item.id));
        if (selectedItems.length === 0) {
            alert('Selecciona al menos un item de la cola para crear rutas.');
            return;
        }

        const missingDriver = selectedItems.filter((item) => !item.assigned_driver_id);
        if (missingDriver.length > 0) {
            const sample = missingDriver.slice(0, 5).map((item) => `Factura ${item.invoice_number}`).join(', ');
            alert(`Faltan repartidores asignados en ${missingDriver.length} item(s): ${sample}`);
            return;
        }

        setSubmitting(true);
        try {
            const payload = selectedItems.map((item) => ({
                queue_item_id: item.id,
                driver_id: item.assigned_driver_id
            }));
            const { error } = await supabase.rpc('create_dispatch_routes_from_queue', { p_items: payload });
            if (error) throw error;
            alert('Rutas creadas correctamente.');
            setSelectedQueueIds(new Set());
            setActiveTab('routes');
            await refreshAll();
        } catch (error: any) {
            console.error('Error creating dispatch routes:', error);
            alert(`No se pudieron crear las rutas: ${error?.message || 'desconocido'}`);
        } finally {
            setSubmitting(false);
        }
    };

    const fetchRouteDetails = async (route: DeliveryRouteSummary) => {
        setSelectedRoute(route);
        setRouteDetails(null);
        try {
            const { data: routeItemRows, error: routeItemsError } = await supabase
                .from('route_items')
                .select(`
                    id,
                    route_id,
                    order_id,
                    sequence_order,
                    status,
                    delivered_at,
                    proof_photo_url,
                    order:orders (
                        id,
                        folio,
                        client:clients (
                            name,
                            address,
                            office
                        )
                    )
                `)
                .eq('route_id', route.id)
                .order('sequence_order', { ascending: true });

            if (routeItemsError) throw routeItemsError;

            const orderIds = (routeItemRows || []).map((row: any) => row.order_id).filter(Boolean);
            const { data: queueRows, error: queueError } = orderIds.length === 0
                ? { data: [], error: null }
                : await supabase
                    .from('dispatch_queue_items')
                    .select('order_id, invoice_number, seller_name_snapshot, seller_email_snapshot')
                    .in('order_id', orderIds);

            if (queueError) throw queueError;

            const queueByOrderId = new Map<string, { invoice_number: string; seller_name_snapshot: string | null; seller_email_snapshot: string | null }>();
            (queueRows || []).forEach((row: any) => {
                queueByOrderId.set(row.order_id, row);
            });

            const mappedDetails: RouteDetailItem[] = (routeItemRows || []).map((item: any) => {
                const queue = queueByOrderId.get(item.order_id);
                return {
                    id: item.id,
                    order_id: item.order_id,
                    sequence_order: item.sequence_order || 0,
                    status: item.status || 'pending',
                    delivered_at: item.delivered_at,
                    proof_photo_url: item.proof_photo_url,
                    order_folio: item.order?.folio || null,
                    client_name: item.order?.client?.name || 'Cliente sin nombre',
                    client_address: item.order?.client?.address || 'Sin dirección registrada',
                    client_office: item.order?.client?.office || null,
                    invoice_number: queue?.invoice_number || null,
                    seller_name: queue?.seller_name_snapshot || queue?.seller_email_snapshot || null
                };
            });

            setRouteDetails(mappedDetails);
        } catch (error: any) {
            console.error('Error fetching route details:', error);
            alert(`No se pudieron cargar los detalles de la ruta: ${error?.message || 'desconocido'}`);
            setSelectedRoute(null);
            setRouteDetails([]);
        }
    };

    const handleDownloadImage = async (url: string, filename: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || 'entrega.jpg';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error('Error downloading image:', error);
            alert('No se pudo descargar la imagen.');
        }
    };

    if (!canManageDispatch) {
        return <div className="p-10 text-center font-bold text-gray-500">Acceso denegado. Este módulo es solo para Admin y Facturador.</div>;
    }

    if (loading) {
        return <div className="p-10 text-center font-bold text-gray-500">Cargando centro de despacho...</div>;
    }

    return (
        <div className="space-y-8 w-full mx-auto">
            <div className="space-y-4">
                <div className="flex flex-col lg:flex-row justify-between gap-4 lg:items-end">
                    <div>
                        <h2 className="text-4xl font-black text-gray-900 tracking-tight">Centro de Despacho</h2>
                        <p className="text-gray-400 font-medium mt-1 text-lg">Carga facturas, valida pedidos CRM y arma rutas desde una cola controlada</p>
                    </div>

                    <div className="inline-flex bg-gray-100 p-1 rounded-2xl self-start lg:self-auto flex-wrap gap-1">
                        <button onClick={() => setActiveTab('upload')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeTab === 'upload' ? 'bg-slate-900 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>Carga</button>
                        <button onClick={() => setActiveTab('queue')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeTab === 'queue' ? 'bg-slate-900 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>Cola pendiente</button>
                        <button onClick={() => setActiveTab('routes')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeTab === 'routes' ? 'bg-slate-900 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>Rutas activas</button>
                        <button onClick={() => setActiveTab('history')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${activeTab === 'history' ? 'bg-slate-900 text-white shadow' : 'text-gray-500 hover:text-gray-700'}`}>Historial</button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase font-black text-gray-400 tracking-widest">Lotes</p>
                            <p className="text-3xl font-black text-gray-900">{batches.length}</p>
                        </div>
                        <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-500"><FileSpreadsheet size={24} /></div>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-amber-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase font-black text-amber-400 tracking-widest">En cola</p>
                            <p className="text-3xl font-black text-amber-600">{queuedItems.length}</p>
                        </div>
                        <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500"><PackageCheck size={24} /></div>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase font-black text-indigo-400 tracking-widest">En ruta</p>
                            <p className="text-3xl font-black text-indigo-600">{routedItems.length}</p>
                        </div>
                        <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500"><Truck size={24} /></div>
                    </div>
                    <div className="bg-white p-6 rounded-3xl border border-emerald-100 shadow-sm flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase font-black text-emerald-400 tracking-widest">Cerrados</p>
                            <p className="text-3xl font-black text-emerald-600">{historyItems.length}</p>
                        </div>
                        <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-500"><CheckCircle2 size={24} /></div>
                    </div>
                </div>
            </div>

            {activeTab === 'upload' && (
                <div className="space-y-6">
                    <div className="bg-white border border-gray-100 rounded-[2rem] p-6 shadow-sm">
                        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Importación oficial</p>
                                <h3 className="text-2xl font-black text-gray-900 mt-1">Cargar facturas para liberar despacho</h3>
                                <p className="text-sm font-medium text-gray-500 mt-2">Columnas esperadas: <span className="font-black text-gray-700">numero_factura</span>, <span className="font-black text-gray-700">rut_cliente</span>, <span className="font-black text-gray-700">numero_pedido_crm</span>.</p>
                                <p className="text-xs font-bold text-red-500 mt-2">Si una fila falla, se cancela la carga completa.</p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative">
                                    <input
                                        type="file"
                                        accept=".xlsx,.xls,.csv"
                                        onChange={handleFileUpload}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        disabled={uploading || submitting}
                                    />
                                    <button className={`px-5 py-2.5 rounded-xl text-sm font-black flex items-center transition-all ${uploading ? 'bg-gray-200 text-gray-400' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}`}>
                                        <Upload size={16} className="mr-2" />
                                        {uploading ? 'Validando...' : 'Subir Excel'}
                                    </button>
                                </div>
                                <button onClick={handleDownloadImportTemplate} className="bg-white text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center border border-gray-200 hover:bg-gray-50 transition-all">
                                    <Download size={16} className="mr-2" /> Plantilla
                                </button>
                                <button onClick={refreshAll} className="bg-white text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center border border-gray-200 hover:bg-gray-50 transition-all">
                                    <RotateCcw size={16} className="mr-2" /> Actualizar
                                </button>
                            </div>
                        </div>
                    </div>

                    {latestBatch && (
                        <div className="bg-indigo-50 border border-indigo-100 rounded-[2rem] p-6">
                            <p className="text-[10px] uppercase tracking-widest font-black text-indigo-400">Última carga exitosa</p>
                            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-4 text-sm font-bold text-slate-700">
                                <div>
                                    <p className="text-xs text-slate-400 uppercase tracking-widest">Archivo</p>
                                    <p className="mt-1 break-all">{latestBatch.file_name}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase tracking-widest">Filas</p>
                                    <p className="mt-1">{latestBatch.row_count}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase tracking-widest">Fecha</p>
                                    <p className="mt-1">{formatDateTime(latestBatch.created_at)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 uppercase tracking-widest">Lote</p>
                                    <p className="mt-1">{latestBatch.id.slice(0, 8)}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {importErrors.length > 0 && (
                        <div className="bg-red-50 border border-red-100 rounded-[2rem] p-6 space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                    <h4 className="font-black text-red-700">Errores de importación</h4>
                                    <p className="text-sm font-medium text-red-500">No se guardó ninguna fila. Corrige el archivo y vuelve a subirlo.</p>
                                </div>
                                <button onClick={handleDownloadImportErrors} className="self-start bg-white text-red-600 px-4 py-2 rounded-xl text-sm font-bold border border-red-200 hover:bg-red-50 transition-all">
                                    Descargar errores CSV
                                </button>
                            </div>
                            <div className="overflow-x-auto rounded-2xl border border-red-100 bg-white">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-red-50 text-red-600 uppercase text-[10px] tracking-widest font-black">
                                        <tr>
                                            <th className="px-4 py-3 text-left">Fila</th>
                                            <th className="px-4 py-3 text-left">Factura</th>
                                            <th className="px-4 py-3 text-left">RUT</th>
                                            <th className="px-4 py-3 text-left">Pedido CRM</th>
                                            <th className="px-4 py-3 text-left">Motivo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {importErrors.map((errorItem, index) => (
                                            <tr key={`${errorItem.row_number}-${index}`} className="border-t border-red-50 text-slate-700">
                                                <td className="px-4 py-3 font-black">{errorItem.row_number}</td>
                                                <td className="px-4 py-3">{errorItem.invoice_number || '—'}</td>
                                                <td className="px-4 py-3">{errorItem.client_rut || '—'}</td>
                                                <td className="px-4 py-3">{errorItem.crm_order_number || '—'}</td>
                                                <td className="px-4 py-3 text-red-600 font-bold">{errorItem.reason}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'queue' && (
                <div className="space-y-6">
                    <div className="bg-white border border-gray-100 rounded-[2rem] p-5 shadow-sm">
                        <div className="flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
                            <div className="flex-1">
                                <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Cola pendiente</p>
                                <p className="text-sm font-bold text-gray-700 mt-1">Items importados, validados y listos para asignar a repartidor.</p>
                            </div>
                            <div className="flex flex-col md:flex-row gap-2 w-full xl:w-auto">
                                <input
                                    value={queueSearch}
                                    onChange={(event) => setQueueSearch(event.target.value)}
                                    placeholder="Buscar por factura, pedido, RUT, cliente, vendedor o repartidor"
                                    className="min-w-[320px] rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium outline-none focus:border-indigo-300"
                                />
                                <select
                                    value={bulkDriverId}
                                    onChange={(event) => setBulkDriverId(event.target.value)}
                                    className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-300"
                                >
                                    <option value="">Asignar repartidor a seleccionados</option>
                                    {drivers.map((driver) => (
                                        <option key={driver.id} value={driver.id}>{driver.full_name || driver.email}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={handleBulkAssignDriver}
                                    disabled={!bulkDriverId || selectedQueueIds.size === 0}
                                    className={`rounded-xl px-4 py-3 text-sm font-black transition-all ${!bulkDriverId || selectedQueueIds.size === 0 ? 'bg-gray-200 text-gray-400' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                                >
                                    Aplicar
                                </button>
                            </div>
                        </div>
                    </div>

                    {filteredQueueItems.length > 0 && (
                        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between gap-4 md:items-center sticky bottom-6 z-20">
                            <label className="flex items-center gap-3 text-sm font-bold text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={filteredQueueItems.length > 0 && selectedQueueIds.size === filteredQueueItems.length}
                                    onChange={(event) => handleSelectAllQueue(event.target.checked)}
                                    className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                Seleccionar visibles ({filteredQueueItems.length})
                            </label>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-black text-indigo-600">{selectedQueueIds.size} seleccionados</span>
                                <button
                                    onClick={handleCreateRoutes}
                                    disabled={submitting || selectedQueueIds.size === 0}
                                    className={`px-6 py-3 rounded-xl text-sm font-black transition-all ${submitting || selectedQueueIds.size === 0 ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 shadow-lg'}`}
                                >
                                    {submitting ? 'Creando rutas...' : 'Crear rutas'}
                                </button>
                            </div>
                        </div>
                    )}

                    {filteredQueueItems.length === 0 ? (
                        <div className="bg-white border border-gray-100 rounded-[2rem] p-10 text-center text-gray-400 font-bold">
                            No hay items pendientes en la cola de despacho.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {filteredQueueItems.map((item) => {
                                const assignedDriver = item.assigned_driver_id ? driverMap[item.assigned_driver_id] : null;
                                return (
                                    <div key={item.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
                                        <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                                            <div className="flex items-start gap-4 flex-1">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedQueueIds.has(item.id)}
                                                    onChange={() => toggleQueueSelection(item.id)}
                                                    className="mt-1 w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <div className="space-y-3 flex-1 min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">Factura {item.invoice_number}</span>
                                                        <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-widest">Pedido #{item.order_folio_input}</span>
                                                        <span className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${queueStatusClass[item.status]}`}>{queueStatusLabel[item.status]}</span>
                                                        <span className="px-2 py-1 rounded-lg bg-gray-50 text-gray-500 text-[10px] font-black uppercase tracking-widest">Lote {item.batch_id.slice(0, 8)}</span>
                                                    </div>

                                                    <div>
                                                        <h3 className="text-xl font-black text-slate-900 break-words">{item.client_name_snapshot}</h3>
                                                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm text-slate-600 font-medium">
                                                            <p className="flex items-start gap-2"><Hash size={15} className="mt-0.5 text-slate-400" /> RUT: <span className="font-black text-slate-800">{item.client_rut_input}</span></p>
                                                            <p className="flex items-start gap-2"><Building2 size={15} className="mt-0.5 text-slate-400" /> Vendedor: <span className="font-black text-slate-800">{item.seller_name_snapshot || item.seller_email_snapshot || 'Sin vendedor'}</span></p>
                                                            <p className="flex items-start gap-2"><MapPin size={15} className="mt-0.5 text-slate-400" /> {item.client_address_snapshot || 'Sin dirección'}{item.client_office_snapshot ? ` (${item.client_office_snapshot})` : ''}</p>
                                                            <p className="flex items-start gap-2"><CalendarClock size={15} className="mt-0.5 text-slate-400" /> Cargado: <span className="font-black text-slate-800">{formatDateTime(item.imported_at)}</span></p>
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
                                                        <span>Total pedido: <span className="text-slate-900">{formatCurrency(item.order_total_snapshot)}</span></span>
                                                        <span>Comuna: <span className="text-slate-900">{item.client_comuna_snapshot || '—'}</span></span>
                                                        <span>Teléfono: <span className="text-slate-900">{item.client_phone_snapshot || '—'}</span></span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="w-full xl:w-[320px] space-y-3 shrink-0">
                                                <div>
                                                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400 mb-2">Repartidor</p>
                                                    <select
                                                        value={item.assigned_driver_id || ''}
                                                        onChange={(event) => persistAssignedDriver(item.id, event.target.value)}
                                                        className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold outline-none focus:border-indigo-300"
                                                    >
                                                        <option value="">Seleccionar repartidor...</option>
                                                        {drivers.map((driver) => (
                                                            <option key={driver.id} value={driver.id}>{driver.full_name || driver.email}</option>
                                                        ))}
                                                    </select>
                                                    <p className="mt-1 text-xs text-gray-400 font-medium">{assignedDriver ? `Asignado a ${assignedDriver.full_name || assignedDriver.email}` : 'Aún no asignado'}</p>
                                                </div>

                                                <button
                                                    onClick={() => handleCancelQueueItem(item)}
                                                    className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-600 hover:bg-red-100 transition-all"
                                                >
                                                    Cancelar item
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'routes' && (
                <div className="space-y-6">
                    <div className="bg-white border border-gray-100 rounded-[2rem] p-5 shadow-sm flex items-center justify-between gap-4">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Rutas activas</p>
                            <p className="text-sm font-bold text-gray-700 mt-1">Rutas ya generadas desde la cola validada de despacho.</p>
                        </div>
                        <button onClick={fetchRoutes} className="bg-white text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center border border-gray-200 hover:bg-gray-50 transition-all">
                            <RotateCcw size={16} className="mr-2" /> Actualizar
                        </button>
                    </div>

                    {routes.length === 0 ? (
                        <div className="bg-white rounded-[2rem] p-10 border border-gray-100 text-center text-gray-400 font-bold">No hay rutas activas en este momento.</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {routes.map((route) => {
                                const driver = route.driver_id ? driverMap[route.driver_id] : null;
                                return (
                                    <button
                                        key={route.id}
                                        type="button"
                                        onClick={() => fetchRouteDetails(route)}
                                        className="text-left bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-lg hover:border-indigo-100 transition-all"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-widest font-black text-indigo-400">Ruta</p>
                                                <h3 className="text-xl font-black text-slate-900 mt-1">{route.name}</h3>
                                                <p className="text-sm font-bold text-indigo-600 mt-2">{driver?.full_name || driver?.email || 'Sin repartidor'}</p>
                                                <p className="text-xs text-gray-500 font-medium mt-1">{formatDateTime(route.created_at)}</p>
                                            </div>
                                            <span className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${routeStatusClass(route.status)}`}>{routeStatusLabel(route.status)}</span>
                                        </div>
                                        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                                            <div className="bg-slate-50 rounded-2xl px-3 py-4">
                                                <p className="text-[10px] uppercase tracking-widest font-black text-slate-400">Total</p>
                                                <p className="text-2xl font-black text-slate-900 mt-1">{route.order_count}</p>
                                            </div>
                                            <div className="bg-amber-50 rounded-2xl px-3 py-4">
                                                <p className="text-[10px] uppercase tracking-widest font-black text-amber-400">Pendientes</p>
                                                <p className="text-2xl font-black text-amber-600 mt-1">{route.pending_count}</p>
                                            </div>
                                            <div className="bg-emerald-50 rounded-2xl px-3 py-4">
                                                <p className="text-[10px] uppercase tracking-widest font-black text-emerald-400">Entregados</p>
                                                <p className="text-2xl font-black text-emerald-600 mt-1">{route.completed_count}</p>
                                            </div>
                                        </div>
                                        <div className="mt-4 flex items-center gap-1 text-[10px] font-black text-indigo-500 uppercase tracking-widest">
                                            Ver detalle <ChevronRight size={12} />
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'history' && (
                <div className="space-y-6">
                    <div className="bg-white border border-gray-100 rounded-[2rem] p-5 shadow-sm">
                        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Historial</p>
                                <p className="text-sm font-bold text-gray-700 mt-1">Revisa lotes subidos y despachos ya cerrados o cancelados.</p>
                            </div>
                            <input
                                value={historySearch}
                                onChange={(event) => setHistorySearch(event.target.value)}
                                placeholder="Buscar por factura, pedido, RUT, cliente, vendedor o repartidor"
                                className="min-w-[320px] rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium outline-none focus:border-indigo-300"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
                        <div className="bg-white border border-gray-100 rounded-[2rem] p-6 shadow-sm space-y-4">
                            <div className="flex items-center gap-2 text-slate-900 font-black">
                                <HistoryIcon size={18} /> Lotes importados
                            </div>
                            {batches.length === 0 ? (
                                <p className="text-sm text-gray-400 font-bold">Aún no hay lotes registrados.</p>
                            ) : (
                                <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                                    {batches.map((batch) => (
                                        <div key={batch.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                            <p className="text-xs font-black text-slate-900 break-all">{batch.file_name}</p>
                                            <div className="mt-2 text-xs font-medium text-slate-500 space-y-1">
                                                <p>Filas: <span className="font-black text-slate-700">{batch.row_count}</span></p>
                                                <p>Fecha: <span className="font-black text-slate-700">{formatDateTime(batch.created_at)}</span></p>
                                                <p>Lote: <span className="font-black text-slate-700">{batch.id.slice(0, 8)}</span></p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="bg-white border border-gray-100 rounded-[2rem] p-6 shadow-sm">
                            <div className="flex items-center gap-2 text-slate-900 font-black mb-4">
                                <CheckCircle2 size={18} /> Despachos cerrados o cancelados
                            </div>
                            {filteredHistoryItems.length === 0 ? (
                                <p className="text-sm text-gray-400 font-bold">No hay items de historial para mostrar.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="min-w-full text-sm">
                                        <thead className="text-[10px] uppercase tracking-widest font-black text-gray-400">
                                            <tr>
                                                <th className="text-left py-3 pr-4">Factura</th>
                                                <th className="text-left py-3 pr-4">Pedido</th>
                                                <th className="text-left py-3 pr-4">Cliente</th>
                                                <th className="text-left py-3 pr-4">Vendedor</th>
                                                <th className="text-left py-3 pr-4">Repartidor</th>
                                                <th className="text-left py-3 pr-4">Estado</th>
                                                <th className="text-left py-3 pr-4">Fecha</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredHistoryItems.map((item) => {
                                                const driver = item.assigned_driver_id ? driverMap[item.assigned_driver_id] : null;
                                                const effectiveDate = item.delivered_at || item.cancelled_at || item.routed_at || item.imported_at;
                                                return (
                                                    <tr key={item.id} className="border-t border-gray-100">
                                                        <td className="py-3 pr-4 font-black text-slate-900">{item.invoice_number}</td>
                                                        <td className="py-3 pr-4 text-slate-600">#{item.order_folio_input}</td>
                                                        <td className="py-3 pr-4 text-slate-600">{item.client_name_snapshot}</td>
                                                        <td className="py-3 pr-4 text-slate-600">{item.seller_name_snapshot || item.seller_email_snapshot || '—'}</td>
                                                        <td className="py-3 pr-4 text-slate-600">{driver?.full_name || driver?.email || '—'}</td>
                                                        <td className="py-3 pr-4"><span className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${queueStatusClass[item.status]}`}>{queueStatusLabel[item.status]}</span></td>
                                                        <td className="py-3 pr-4 text-slate-600">{formatDateTime(effectiveDate)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {selectedRoute && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedRoute(null)} />
                    <div className="relative z-10 w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-[2.5rem] bg-white shadow-2xl flex flex-col">
                        <div className="bg-slate-900 p-8 text-white flex justify-between items-center shrink-0">
                            <div>
                                <h3 className="text-2xl font-black italic">{selectedRoute.name}</h3>
                                <p className="text-slate-400 text-sm font-bold mt-1">{selectedRoute.driver_id ? (driverMap[selectedRoute.driver_id]?.full_name || driverMap[selectedRoute.driver_id]?.email || 'Repartidor') : 'Sin repartidor'}</p>
                            </div>
                            <button onClick={() => setSelectedRoute(null)} className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-all">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 bg-gray-50/50">
                            {routeDetails === null ? (
                                <div className="text-center py-20">
                                    <div className="animate-spin w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                                    <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Cargando detalle de la ruta...</p>
                                </div>
                            ) : routeDetails.length === 0 ? (
                                <div className="text-center py-20 text-gray-400 font-bold">Esta ruta no tiene pedidos visibles.</div>
                            ) : (
                                <div className="space-y-4">
                                    {routeDetails.map((item) => (
                                        <div key={item.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col xl:flex-row gap-4 xl:items-center xl:justify-between">
                                            <div className="flex items-start gap-4 flex-1 min-w-0">
                                                <div className="w-11 h-11 rounded-2xl bg-slate-50 text-slate-400 font-black flex items-center justify-center shrink-0">{item.sequence_order}</div>
                                                <div className="min-w-0 space-y-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="px-2 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest">Factura {item.invoice_number || '—'}</span>
                                                        <span className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black uppercase tracking-widest">Pedido #{item.order_folio || item.order_id.slice(0, 8)}</span>
                                                        <span className={`px-2 py-1 rounded-lg border text-[10px] font-black uppercase tracking-widest ${normalizeText(item.status).toLowerCase() === 'delivered' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{normalizeText(item.status).toLowerCase() === 'delivered' ? 'Entregado' : 'Pendiente'}</span>
                                                    </div>
                                                    <h4 className="font-black text-slate-900 text-lg">{item.client_name}</h4>
                                                    <p className="text-sm text-slate-500 font-medium flex items-start gap-2"><MapPin size={15} className="mt-0.5 shrink-0" /> {item.client_address}{item.client_office ? ` (${item.client_office})` : ''}</p>
                                                    <p className="text-xs font-bold text-slate-500 flex items-center gap-2"><User size={13} /> {item.seller_name || 'Sin vendedor'}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4 shrink-0">
                                                <div className="text-right">
                                                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Entregado</p>
                                                    <p className="text-xs font-bold text-gray-700 mt-1">{formatDateTime(item.delivered_at)}</p>
                                                </div>
                                                {item.proof_photo_url ? (
                                                    <div className="relative group/proof">
                                                        <img
                                                            src={item.proof_photo_url}
                                                            alt="Prueba de entrega"
                                                            className="w-20 h-20 object-cover rounded-2xl cursor-zoom-in border border-gray-100 shadow-sm"
                                                            onClick={() => setProofViewerUrl(item.proof_photo_url)}
                                                        />
                                                        <button
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                handleDownloadImage(item.proof_photo_url!, `entrega_factura_${item.invoice_number || item.order_folio || item.id}.jpg`);
                                                            }}
                                                            className="absolute top-1 right-1 w-7 h-7 bg-white/90 rounded-lg flex items-center justify-center text-indigo-600 opacity-0 group-hover/proof:opacity-100 transition-opacity shadow-lg"
                                                            title="Descargar foto"
                                                        >
                                                            <Download size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="w-20 h-20 bg-gray-50 rounded-2xl border border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-300 gap-1">
                                                        <Camera size={16} />
                                                        <span className="text-[8px] font-black">SIN FOTO</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {proofViewerUrl && (
                <div className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center p-4">
                    <div className="absolute top-8 right-8 flex gap-4">
                        <button
                            onClick={() => handleDownloadImage(proofViewerUrl, 'prueba_entrega.jpg')}
                            className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all z-10"
                            title="Descargar"
                        >
                            <Download size={24} />
                        </button>
                        <button
                            onClick={() => setProofViewerUrl(null)}
                            className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all z-10"
                        >
                            <X size={24} />
                        </button>
                    </div>
                    <img src={proofViewerUrl} alt="Prueba de entrega" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
                </div>
            )}
        </div>
    );
};

export default Dispatch;
