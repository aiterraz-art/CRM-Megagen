import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    Check,
    ClipboardList,
    Download,
    FileSpreadsheet,
    History,
    Package,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    TrendingUp,
    X
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Database } from '../types/supabase';

type InventoryItem = Database['public']['Tables']['inventory']['Row'] & { sku?: string | null };
type SupplierRow = Database['public']['Tables']['suppliers']['Row'];
type InventoryMovement = Database['public']['Tables']['inventory_movements']['Row'] & {
    inventory?: Pick<InventoryItem, 'id' | 'sku' | 'name' | 'category'> | null;
    profile?: { full_name?: string | null; email?: string | null } | null;
};
type RotationMetric = Database['public']['Functions']['get_inventory_rotation_metrics']['Returns'][number];
type ImportType = 'stock' | 'pricing';
type InventoryTab = 'stock' | 'rotation' | 'movements';
type ImportableShipment = Pick<Database['public']['Tables']['inbound_shipments']['Row'], 'id' | 'supplier_name' | 'status' | 'eta_date'>;
type ImportableShipmentItem = Pick<Database['public']['Tables']['inbound_shipment_items']['Row'], 'id' | 'shipment_id' | 'product_id' | 'product_name_snapshot' | 'sku_snapshot' | 'qty'>;
const MOVEMENTS_PAGE_SIZE = 100;

const MOVEMENT_REASON_OPTIONS = [
    { value: 'stock_count', label: 'Conteo de stock' },
    { value: 'correction', label: 'Corrección' },
    { value: 'damage', label: 'Merma / daño' },
    { value: 'sample_use', label: 'Muestra / uso interno' },
    { value: 'other', label: 'Otro' }
];

const Inventory = () => {
    const navigate = useNavigate();
    const { hasPermission, effectiveRole, profile } = useUser();
    const isSellerReadOnly = effectiveRole === 'seller';
    const canViewAnalytics = effectiveRole === 'admin' || effectiveRole === 'jefe';
    const canManageInventory = !isSellerReadOnly && hasPermission('MANAGE_INVENTORY');
    const canManagePricing = !isSellerReadOnly && hasPermission('MANAGE_PRICING');
    const canManageStocklessOrders = effectiveRole === 'admin' || effectiveRole === 'bodega';
    const canManageStockControls = canManageInventory && canViewAnalytics;
    const canUploadInventory = !isSellerReadOnly && hasPermission('UPLOAD_EXCEL');
    const canRequestProducts = hasPermission('REQUEST_PRODUCTS');
    const canDownloadCatalog = effectiveRole === 'admin' || effectiveRole === 'jefe';
    const canShowActions = canManageInventory || canRequestProducts;

    const [items, setItems] = useState<InventoryItem[]>([]);
    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [movements, setMovements] = useState<InventoryMovement[]>([]);
    const [rotationMetrics, setRotationMetrics] = useState<RotationMetric[]>([]);
    const [activeTab, setActiveTab] = useState<InventoryTab>('stock');
    const [search, setSearch] = useState('');
    const [rotationSearch, setRotationSearch] = useState('');
    const [movementSearch, setMovementSearch] = useState('');
    const [rotationOnlyAlerts, setRotationOnlyAlerts] = useState(false);
    const [rotationAlertFilter, setRotationAlertFilter] = useState<'all' | 'critical' | 'low' | 'warning' | 'healthy'>('all');
    const [rotationCategoryFilter, setRotationCategoryFilter] = useState<'all' | string>('all');
    const [rotationRequestFilter, setRotationRequestFilter] = useState<'all' | 'with_request' | 'without_request'>('all');
    const [movementTypeFilter, setMovementTypeFilter] = useState<'all' | string>('all');
    const [movementOriginFilter, setMovementOriginFilter] = useState<'all' | string>('all');
    const [movementUserFilter, setMovementUserFilter] = useState<'all' | string>('all');
    const [movementDateFrom, setMovementDateFrom] = useState('');
    const [movementDateTo, setMovementDateTo] = useState('');
    const [loading, setLoading] = useState(true);
    const [rotationLoading, setRotationLoading] = useState(false);
    const [movementsLoading, setMovementsLoading] = useState(false);
    const [movementsError, setMovementsError] = useState('');
    const [movementPage, setMovementPage] = useState(1);
    const [movementHasMore, setMovementHasMore] = useState(false);
    const [movementLoadedOnce, setMovementLoadedOnce] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importType, setImportType] = useState<ImportType | null>(null);
    const [showNewProductModal, setShowNewProductModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
    const [editingPriceValue, setEditingPriceValue] = useState('');
    const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
    const [adjustmentItem, setAdjustmentItem] = useState<InventoryItem | null>(null);
    const [adjustmentStockValue, setAdjustmentStockValue] = useState('');
    const [adjustmentReasonCode, setAdjustmentReasonCode] = useState('stock_count');
    const [adjustmentReasonNote, setAdjustmentReasonNote] = useState('');
    const [savingAdjustment, setSavingAdjustment] = useState(false);
    const [minStockItem, setMinStockItem] = useState<InventoryItem | null>(null);
    const [minStockValue, setMinStockValue] = useState('');
    const [savingMinStock, setSavingMinStock] = useState(false);
    const [supplierItem, setSupplierItem] = useState<InventoryItem | null>(null);
    const [supplierValue, setSupplierValue] = useState('');
    const [savingSupplier, setSavingSupplier] = useState(false);
    const [stockPolicyItem, setStockPolicyItem] = useState<InventoryItem | null>(null);
    const [stockPolicyValue, setStockPolicyValue] = useState(false);
    const [savingStockPolicy, setSavingStockPolicy] = useState(false);
    const [receiptItem, setReceiptItem] = useState<InventoryItem | null>(null);
    const [receiptQty, setReceiptQty] = useState('1');
    const [receiptShipmentId, setReceiptShipmentId] = useState('');
    const [receiptShipmentItemId, setReceiptShipmentItemId] = useState('');
    const [receiptReasonNote, setReceiptReasonNote] = useState('');
    const [loadingReceiptSources, setLoadingReceiptSources] = useState(false);
    const [savingReceipt, setSavingReceipt] = useState(false);
    const [receiptShipments, setReceiptShipments] = useState<ImportableShipment[]>([]);
    const [receiptShipmentItems, setReceiptShipmentItems] = useState<ImportableShipmentItem[]>([]);
    const [selectedHistoryItem, setSelectedHistoryItem] = useState<InventoryItem | null>(null);
    const [salesHistoryData, setSalesHistoryData] = useState<any[]>([]);
    const [movementHistoryData, setMovementHistoryData] = useState<InventoryMovement[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [newProduct, setNewProduct] = useState({
        sku: '',
        name: '',
        price: 0,
        stock_qty: 0,
        category: 'General',
        supplier_id: '',
        allow_sale_without_stock: false
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const normalizeHeader = (value: string) =>
        value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');

    const normalizeSku = (value: unknown) => String(value || '').trim().toUpperCase();

    const parseImportedPrice = (value: unknown) => {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? Math.max(0, value) : NaN;
        }

        const raw = String(value ?? '').trim();
        if (!raw) return NaN;

        const cleaned = raw
            .replace(/\s+/g, '')
            .replace(/[^\d,.-]/g, '');

        if (!cleaned) return NaN;

        if (/^-?\d+$/.test(cleaned)) {
            return Math.max(0, Number(cleaned));
        }

        const lastDot = cleaned.lastIndexOf('.');
        const lastComma = cleaned.lastIndexOf(',');
        const lastSeparator = Math.max(lastDot, lastComma);

        if (lastSeparator >= 0) {
            const decimals = cleaned.length - lastSeparator - 1;

            if (decimals === 0 || decimals === 3) {
                const integerLike = Number(cleaned.replace(/[.,]/g, ''));
                return Number.isFinite(integerLike) ? Math.max(0, integerLike) : NaN;
            }

            const normalized =
                lastComma > lastDot
                    ? cleaned.replace(/\./g, '').replace(',', '.')
                    : cleaned.replace(/,/g, '');

            const decimalLike = Number(normalized);
            if (Number.isFinite(decimalLike)) {
                return Math.max(0, decimalLike);
            }
        }

        const digitsOnly = Number(cleaned.replace(/[^\d-]/g, ''));
        return Number.isFinite(digitsOnly) ? Math.max(0, digitsOnly) : NaN;
    };

    const getValueByAliases = (row: Record<string, unknown>, aliases: string[]) => {
        const normalizedAliases = aliases.map(normalizeHeader);
        for (const [key, value] of Object.entries(row)) {
            const normalizedKey = normalizeHeader(key);
            if (normalizedAliases.some((alias) => normalizedKey.includes(alias))) {
                return value;
            }
        }
        return null;
    };

    const getValueByExactAliases = (row: Record<string, unknown>, aliases: string[]) => {
        const normalizedAliases = new Set(aliases.map(normalizeHeader));
        for (const [key, value] of Object.entries(row)) {
            if (normalizedAliases.has(normalizeHeader(key))) {
                return value;
            }
        }
        return null;
    };

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

    const getMovementOriginLabel = (movement: InventoryMovement) => {
        if (movement.shipment_id) return 'Embarque';
        if (movement.order_id) return 'Venta';
        if (movement.source_table === 'inventory_stock_import') return 'Importación masiva';
        if (movement.source_table === 'inventory_manual_receipt') return 'Ingreso manual';
        return 'Ajuste';
    };

    const getMovementUserLabel = (movement: InventoryMovement) => {
        if (movement.profile?.full_name?.trim()) return movement.profile.full_name.trim();
        if (movement.profile?.email) return movement.profile.email.split('@')[0];
        return 'Sistema';
    };

    const inventoryCategories = useMemo(
        () => Array.from(new Set(items.map((item) => item.category || 'General'))).sort(),
        [items]
    );
    const activeSuppliers = useMemo(
        () => suppliers.filter((supplier) => supplier.status === 'active'),
        [suppliers]
    );
    const supplierMap = useMemo(
        () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
        [suppliers]
    );

    const isMissingBackendFeatureError = (error: any) => {
        const message = String(error?.message || error || '').toLowerCase();
        return (
            message.includes('does not exist') ||
            message.includes('could not find the function') ||
            message.includes('schema cache') ||
            message.includes('inventory_movements') ||
            message.includes('supplier_id') ||
            message.includes('allow_sale_without_stock') ||
            message.includes('suppliers') ||
            message.includes('target_coverage_days') ||
            message.includes('last_stock_reviewed') ||
            message.includes('min_stock_alert')
        );
    };

    const fetchSuppliers = async () => {
        try {
            const { data, error } = await supabase
                .from('suppliers')
                .select('id, name, email, status, created_at, created_by, updated_at, address, city, contact_name, country, notes, phone, preferred_currency, tax_id')
                .order('name', { ascending: true });

            if (error) throw error;
            setSuppliers((data || []) as SupplierRow[]);
        } catch (error: any) {
            if (!isMissingBackendFeatureError(error)) {
                console.error('Error fetching suppliers for inventory:', error);
            }
            setSuppliers([]);
        }
    };

    const fetchInventory = async () => {
        setLoading(true);
        try {
            const { data, error } = await (supabase.from('inventory') as any)
                .select('id, sku, name, price, stock_qty, category, created_at, min_stock_alert, target_coverage_days, last_stock_reviewed_at, last_stock_reviewed_by, is_service_item, supplier_id, allow_sale_without_stock')
                .eq('is_service_item', false)
                .order('name');

            if (error) throw error;

            if (data) {
                setItems(data as InventoryItem[]);
            }
        } catch (error: any) {
            if (!isMissingBackendFeatureError(error)) {
                console.error('Error fetching inventory:', error);
                alert(`Error cargando inventario: ${error.message}`);
                setLoading(false);
                return;
            }

            try {
                const { data, error: legacyError } = await (supabase.from('inventory') as any)
                    .select('id, sku, name, price, stock_qty, category, created_at, is_service_item')
                    .eq('is_service_item', false)
                    .order('name');

                if (legacyError) throw legacyError;

                setItems(((data || []) as InventoryItem[]).map((item) => ({
                    ...item,
                    allow_sale_without_stock: false,
                    min_stock_alert: 5,
                    target_coverage_days: 30,
                    last_stock_reviewed_at: null,
                    last_stock_reviewed_by: null,
                    supplier_id: null
                })));
            } catch (legacyError: any) {
                console.error('Error fetching legacy inventory:', legacyError);
                alert(`Error cargando inventario: ${legacyError.message}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const fetchRotationMetrics = async (options?: { search?: string; onlyAlerts?: boolean }) => {
        if (!canViewAnalytics) return;

        setRotationLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_inventory_rotation_metrics', {
                p_days: 30,
                p_search: options?.search ?? (rotationSearch.trim() || null),
                p_only_alerts: options?.onlyAlerts ?? rotationOnlyAlerts
            });

            if (error) throw error;
            setRotationMetrics((data || []) as RotationMetric[]);
        } catch (error: any) {
            if (!isMissingBackendFeatureError(error)) {
                console.error('Error fetching rotation metrics:', error);
                alert(`Error cargando rotación: ${error.message}`);
            }
            setRotationMetrics([]);
        } finally {
            setRotationLoading(false);
        }
    };

    const fetchMovements = async (page = 1) => {
        if (!canViewAnalytics) return;

        setMovementsLoading(true);
        setMovementsError('');
        try {
            const { data, error } = await (supabase.from('inventory_movements') as any)
                .select('id, inventory_id, movement_type, direction, qty, stock_before, stock_after, unit_price_snapshot, reason_code, reason_note, source_table, source_id, shipment_id, order_id, order_item_id, performed_by, created_at')
                .order('created_at', { ascending: false })
                .range((page - 1) * MOVEMENTS_PAGE_SIZE, (page * MOVEMENTS_PAGE_SIZE));

            if (error) throw error;

            const fetchedRows = (data || []) as InventoryMovement[];
            const movementRows = fetchedRows.slice(0, MOVEMENTS_PAGE_SIZE);
            const inventoryIds = Array.from(new Set(movementRows.map((movement) => movement.inventory_id).filter(Boolean)));
            const profileIds = Array.from(new Set(movementRows.map((movement) => movement.performed_by).filter(Boolean)));

            const [inventoryRes, profilesRes] = await Promise.all([
                inventoryIds.length > 0
                    ? (supabase.from('inventory') as any).select('id, sku, name, category').in('id', inventoryIds)
                    : Promise.resolve({ data: [], error: null }),
                profileIds.length > 0
                    ? supabase.from('profiles').select('id, full_name, email').in('id', profileIds as string[])
                    : Promise.resolve({ data: [], error: null })
            ]);

            if (inventoryRes.error) throw inventoryRes.error;
            if (profilesRes.error) throw profilesRes.error;

            const inventoryById = new Map<string, Pick<InventoryItem, 'id' | 'sku' | 'name' | 'category'>>(
                ((inventoryRes.data || []) as Array<Pick<InventoryItem, 'id' | 'sku' | 'name' | 'category'>>).map((item) => [item.id, item])
            );
            const profilesById = new Map((profilesRes.data || []).map((item) => [item.id, item]));

            setMovements(movementRows.map((movement) => ({
                ...movement,
                inventory: inventoryById.get(movement.inventory_id) || null,
                profile: movement.performed_by ? profilesById.get(movement.performed_by) || null : null
            })));
            setMovementHasMore(fetchedRows.length > MOVEMENTS_PAGE_SIZE);
            setMovementLoadedOnce(true);
        } catch (error: any) {
            if (!isMissingBackendFeatureError(error)) {
                console.error('Error fetching inventory movements:', error);
                setMovementsError(error.message || 'No se pudieron cargar los movimientos.');
            }
            setMovements([]);
            setMovementHasMore(false);
        } finally {
            setMovementsLoading(false);
        }
    };

    useEffect(() => {
        void fetchSuppliers();
        void fetchInventory();
        if (canViewAnalytics) {
            void fetchRotationMetrics({ search: '', onlyAlerts: false });
        }
    }, [canViewAnalytics]);

    useEffect(() => {
        if (!canViewAnalytics || activeTab !== 'movements') return;
        void fetchMovements(movementPage);
    }, [activeTab, canViewAnalytics, movementPage]);

    const fetchHistory = async (item: InventoryItem) => {
        setSelectedHistoryItem(item);
        setLoadingHistory(true);
        try {
            const [salesRes, movementsRes] = await Promise.all([
                supabase
                    .from('order_items')
                    .select(`
                        quantity,
                        created_at,
                        orders (
                            created_at,
                            quotations (
                                folio
                            )
                        )
                    `)
                    .eq('product_id', item.id)
                    .order('created_at', { ascending: false }),
                (supabase.from('inventory_movements') as any)
                    .select('id, inventory_id, movement_type, direction, qty, stock_before, stock_after, unit_price_snapshot, reason_code, reason_note, source_table, source_id, shipment_id, order_id, order_item_id, performed_by, created_at')
                    .eq('inventory_id', item.id)
                    .order('created_at', { ascending: false })
            ]);

            if (salesRes.error) throw salesRes.error;
            if (movementsRes.error && !isMissingBackendFeatureError(movementsRes.error)) throw movementsRes.error;

            setSalesHistoryData(salesRes.data || []);
            if (movementsRes.error && isMissingBackendFeatureError(movementsRes.error)) {
                setMovementHistoryData([]);
            } else {
                const movementRows = (movementsRes.data || []) as InventoryMovement[];
                const profileIds = Array.from(new Set(movementRows.map((movement) => movement.performed_by).filter(Boolean)));
                const profilesRes = profileIds.length > 0
                    ? await supabase.from('profiles').select('id, full_name, email').in('id', profileIds as string[])
                    : { data: [], error: null };

                if (profilesRes.error) throw profilesRes.error;

                const profilesById = new Map((profilesRes.data || []).map((profileRow) => [profileRow.id, profileRow]));
                setMovementHistoryData(movementRows.map((movement) => ({
                    ...movement,
                    profile: movement.performed_by ? profilesById.get(movement.performed_by) || null : null
                })));
            }
        } catch (error: any) {
            console.error('Error fetching product history:', error);
            alert(`Error al cargar historial: ${error.message}`);
        } finally {
            setLoadingHistory(false);
        }
    };

    const handleImportClick = (type: ImportType) => {
        if (!canUploadInventory) {
            alert('No tienes permisos para importar datos de inventario.');
            return;
        }
        setImportType(type);
        fileInputRef.current?.click();
    };

    const downloadStockTemplate = () => {
        const rows = [{ SKU: 'SKU-001', Nombre: 'Implante Demo', Cantidad: 25 }];
        const worksheet = XLSX.utils.json_to_sheet(rows, { header: ['SKU', 'Nombre', 'Cantidad'] });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock');
        XLSX.writeFile(workbook, 'plantilla_importador_stock.xlsx');
    };

    const downloadPricingTemplate = () => {
        const rows = [{ SKU: 'SKU-001', 'Precio Neto Venta': 15990 }];
        const worksheet = XLSX.utils.json_to_sheet(rows, { header: ['SKU', 'Precio Neto Venta'] });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Precios');
        XLSX.writeFile(workbook, 'plantilla_importador_precios.xlsx');
    };

    const downloadProductCatalog = async () => {
        const { data, error } = await (supabase.from('inventory_price_catalog') as any)
            .select('sku, product_name, price')
            .order('product_name', { ascending: true });

        if (error) {
            console.error('Error fetching price catalog:', error);
            alert(`No se pudo descargar la lista de precios: ${error.message}`);
            return;
        }

        const rows = (data || []).map((item: any) => ({
            SKU: item.sku || '',
            'Nombre del Producto': item.product_name || '',
            'Precio Neto de Venta': Number(item.price || 0)
        }));

        if (rows.length === 0) {
            alert('No hay precios cargados en la lista permanente.');
            return;
        }

        const worksheet = XLSX.utils.json_to_sheet(rows, {
            header: ['SKU', 'Nombre del Producto', 'Precio Neto de Venta']
        });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Precios');
        XLSX.writeFile(workbook, 'lista_precios_permanente.xlsx');
    };

    const refreshAll = async () => {
        await fetchSuppliers();
        await fetchInventory();
        if (canViewAnalytics) {
            await fetchRotationMetrics();
            if (activeTab === 'movements' || movementLoadedOnce) {
                await fetchMovements(movementPage);
            }
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !importType) return;
        if (!canUploadInventory) {
            alert('No tienes permisos para importar datos de inventario.');
            return;
        }

        setIsImporting(true);

        try {
            const extension = (file.name.split('.').pop() || '').toLowerCase();
            if (!['csv', 'xlsx', 'xls'].includes(extension)) {
                throw new Error('Formato no soportado. Usa .csv, .xlsx o .xls');
            }

            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });

            if (rows.length === 0) {
                throw new Error('El archivo no contiene filas para importar.');
            }

            if (importType === 'stock') {
                const parsedItems = rows
                    .map((row) => ({
                        sku: normalizeSku(getValueByAliases(row, ['sku', 'codigo', 'codigoproducto', 'productoid'])),
                        name: String(getValueByAliases(row, ['nombre', 'producto', 'descripcion', 'detalle', 'name']) || '').trim(),
                        stock_qty: Math.max(0, parseInt(String(getValueByAliases(row, ['cantidad', 'stock', 'saldo', 'unidades', 'qty']) ?? '0'), 10) || 0)
                    }))
                    .filter((item) => item.sku && item.name);

                const dedupedBySku = new Map<string, typeof parsedItems[number]>();
                parsedItems.forEach((item) => dedupedBySku.set(item.sku, item));
                const newItems = Array.from(dedupedBySku.values());

                if (newItems.length === 0) {
                    throw new Error('No se encontraron datos válidos. Este importador requiere columnas: SKU, Nombre y Cantidad.');
                }

                const { data, error } = await supabase.rpc('replace_inventory_stock_import', { p_items: newItems });
                if (error) throw error;

                alert(`Importador de stock completado. ${data?.processed_count || newItems.length} SKU procesados, ${data?.deleted_count || 0} SKU reemplazados y ${data?.preserved_historical_count || 0} SKU históricos conservados con stock 0.`);
            } else {
                const expectedSkuHeaders = ['sku'];
                const expectedPriceHeaders = ['precionetoventa', 'precionetodeventa'];
                const normalizedFileHeaders = new Set(Object.keys(rows[0] || {}).map(normalizeHeader));
                const hasSkuHeader = expectedSkuHeaders.some((header) => normalizedFileHeaders.has(header));
                const hasPriceHeader = expectedPriceHeaders.some((header) => normalizedFileHeaders.has(header));

                if (!hasSkuHeader || !hasPriceHeader) {
                    throw new Error('Formato inválido para importador de precios. Solo se aceptan columnas: SKU y Precio Neto Venta.');
                }

                const parsedPriceRows = rows
                    .map((row) => {
                        const sku = normalizeSku(getValueByExactAliases(row, expectedSkuHeaders));
                        const rawPrice = getValueByExactAliases(row, expectedPriceHeaders);
                        const price = parseImportedPrice(rawPrice);
                        return {
                            sku,
                            price: Number.isFinite(price) ? Math.max(0, price) : NaN
                        };
                    })
                    .filter((row) => row.sku && Number.isFinite(row.price));

                const dedupedPrices = new Map<string, number>();
                parsedPriceRows.forEach((row) => dedupedPrices.set(row.sku, row.price));

                if (dedupedPrices.size === 0) {
                    throw new Error('No se encontraron datos válidos. Este importador requiere columnas: SKU y Precio Neto Venta.');
                }

                const pricingItems = Array.from(dedupedPrices.entries()).map(([sku, price]) => ({ sku, price }));
                const { data, error } = await supabase.rpc('replace_inventory_pricing_import', { p_items: pricingItems });
                if (error) throw error;

                const catalogOnlyCount = Number(data?.catalog_only_count || 0);
                const catalogOnlyMessage = catalogOnlyCount > 0
                    ? ` ${catalogOnlyCount} SKU quedaron guardados solo en la lista de precios porque hoy no están en stock.`
                    : '';

                alert(`Importador de precios completado. ${data?.stored_count || 0} SKU guardados en la lista permanente y ${data?.synced_inventory_count || 0} SKU sincronizados con el stock actual.${catalogOnlyMessage}`);
            }

            await refreshAll();
        } catch (error: any) {
            console.error('Import Error:', error);
            alert(`Error al importar: ${error.message}`);
        } finally {
            setIsImporting(false);
            setImportType(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCreateProduct = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!canManageInventory) {
            alert('No tienes permisos para crear productos.');
            return;
        }

        if (!newProduct.sku || !newProduct.name) {
            alert('SKU y Nombre son obligatorios');
            return;
        }

        setIsSaving(true);
        try {
            const payload: Database['public']['Tables']['inventory']['Insert'] = {
                ...newProduct,
                sku: normalizeSku(newProduct.sku),
                name: String(newProduct.name || '').trim(),
                price: Math.max(0, Number(newProduct.price || 0)),
                stock_qty: Math.max(0, Math.trunc(Number(newProduct.stock_qty || 0))),
                category: String(newProduct.category || 'General').trim() || 'General',
                supplier_id: newProduct.supplier_id || null,
                allow_sale_without_stock: Boolean(newProduct.allow_sale_without_stock),
                min_stock_alert: 5,
                target_coverage_days: 30
            };

            const { error } = await supabase.from('inventory').insert([payload]);
            if (error) throw error;

            alert('Producto creado exitosamente');
            setShowNewProductModal(false);
            setNewProduct({
                sku: '',
                name: '',
                price: 0,
                stock_qty: 0,
                category: 'General',
                supplier_id: '',
                allow_sale_without_stock: false
            });
            await refreshAll();
        } catch (error: any) {
            console.error('Error creating product:', error);
            alert(`Error al crear producto: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const startPriceEdit = (item: InventoryItem) => {
        setEditingPriceId(item.id);
        setEditingPriceValue(String(Math.max(0, Number(item.price || 0))));
    };

    const cancelPriceEdit = () => {
        setEditingPriceId(null);
        setEditingPriceValue('');
        setSavingPriceId(null);
    };

    const saveManualPrice = async (item: InventoryItem) => {
        if (!canManagePricing) return;

        const nextPrice = Math.max(0, Number(editingPriceValue || 0));
        if (!Number.isFinite(nextPrice)) {
            alert('Debes ingresar un precio válido.');
            return;
        }

        setSavingPriceId(item.id);
        try {
            const { error: syncError } = await supabase.rpc('set_inventory_manual_price', {
                p_inventory_id: item.id,
                p_price: nextPrice
            });

            if (syncError) {
                const syncMessage = String(syncError.message || '');

                if (syncMessage.includes('set_inventory_manual_price')) {
                    throw new Error('La base aún no tiene la migración de precios manuales. Debes aplicar la migración 20260625000097_persist_manual_inventory_prices.sql en esta instancia antes de editar precios manualmente.');
                }

                if (!isMissingBackendFeatureError(syncError)) {
                    throw syncError;
                }

                throw syncError;
            }

            await fetchInventory();
            cancelPriceEdit();
            alert('Precio actualizado y guardado en la lista permanente.');
        } catch (error: any) {
            console.error('Error updating inventory price:', error);
            alert(`No se pudo actualizar el precio: ${error.message}`);
            setSavingPriceId(null);
        }
    };

    const openAdjustmentModal = (item: InventoryItem) => {
        setAdjustmentItem(item);
        setAdjustmentStockValue(String(Math.max(0, Math.trunc(Number(item.stock_qty || 0)))));
        setAdjustmentReasonCode('stock_count');
        setAdjustmentReasonNote('');
    };

    const closeAdjustmentModal = () => {
        setAdjustmentItem(null);
        setAdjustmentStockValue('');
        setAdjustmentReasonCode('stock_count');
        setAdjustmentReasonNote('');
        setSavingAdjustment(false);
    };

    const saveManualStock = async () => {
        if (!adjustmentItem) return;

        const parsedStock = Number(adjustmentStockValue || 0);
        const nextStock = Math.max(0, Math.trunc(parsedStock));
        if (!Number.isFinite(parsedStock)) {
            alert('Debes ingresar un stock válido.');
            return;
        }

        setSavingAdjustment(true);
        try {
            const { data, error } = await supabase.rpc('apply_inventory_manual_adjustment', {
                p_inventory_id: adjustmentItem.id,
                p_new_stock_qty: nextStock,
                p_reason_code: adjustmentReasonCode,
                p_reason_note: adjustmentReasonNote.trim() || null
            });

            if (error) throw error;

            const adjustmentResult = (data || null) as { changed?: boolean } | null;

            if (adjustmentResult?.changed === false) {
                alert('No hubo cambios de stock para registrar.');
            } else {
                alert('Stock ajustado y auditado correctamente.');
            }

            closeAdjustmentModal();
            await refreshAll();
        } catch (error: any) {
            console.error('Error updating inventory stock:', error);
            alert(`No se pudo actualizar el stock: ${error.message}`);
            setSavingAdjustment(false);
        }
    };

    const openMinStockModal = (item: InventoryItem) => {
        setMinStockItem(item);
        setMinStockValue(String(Math.max(0, Math.trunc(Number(item.min_stock_alert || 0)))));
    };

    const closeMinStockModal = () => {
        setMinStockItem(null);
        setMinStockValue('');
        setSavingMinStock(false);
    };

    const openSupplierModal = (item: InventoryItem) => {
        setSupplierItem(item);
        setSupplierValue(item.supplier_id || '');
    };

    const closeSupplierModal = () => {
        setSupplierItem(null);
        setSupplierValue('');
        setSavingSupplier(false);
    };

    const saveSupplierAssignment = async () => {
        if (!supplierItem) return;

        setSavingSupplier(true);
        try {
            const { error } = await supabase
                .from('inventory')
                .update({ supplier_id: supplierValue || null })
                .eq('id', supplierItem.id);

            if (error) throw error;

            alert('Proveedor del producto actualizado.');
            closeSupplierModal();
            await refreshAll();
        } catch (error: any) {
            console.error('Error updating inventory supplier:', error);
            alert(`No se pudo actualizar el proveedor: ${error.message}`);
            setSavingSupplier(false);
        }
    };

    const openStockPolicyModal = (item: InventoryItem) => {
        setStockPolicyItem(item);
        setStockPolicyValue(Boolean(item.allow_sale_without_stock));
    };

    const closeStockPolicyModal = () => {
        setStockPolicyItem(null);
        setStockPolicyValue(false);
        setSavingStockPolicy(false);
    };

    const saveStockPolicy = async () => {
        if (!stockPolicyItem) return;

        setSavingStockPolicy(true);
        try {
            const { error } = await supabase
                .from('inventory')
                .update({ allow_sale_without_stock: stockPolicyValue })
                .eq('id', stockPolicyItem.id);

            if (error) throw error;

            alert(stockPolicyValue
                ? 'El producto ya puede convertirse a pedido aunque no tenga stock.'
                : 'El producto volverá a exigir stock disponible para convertirse a pedido.');
            closeStockPolicyModal();
            await refreshAll();
        } catch (error: any) {
            console.error('Error updating stock policy:', error);
            alert(`No se pudo actualizar la política de stock: ${error.message}`);
            setSavingStockPolicy(false);
        }
    };

    const saveMinStock = async () => {
        if (!minStockItem || !profile?.id) return;

        const nextMinStock = Math.max(0, Math.trunc(Number(minStockValue || 0)));
        if (!Number.isFinite(nextMinStock)) {
            alert('Debes ingresar un mínimo válido.');
            return;
        }

        setSavingMinStock(true);
        try {
            const { error } = await supabase
                .from('inventory')
                .update({
                    min_stock_alert: nextMinStock,
                    last_stock_reviewed_at: new Date().toISOString(),
                    last_stock_reviewed_by: profile.id
                })
                .eq('id', minStockItem.id);

            if (error) throw error;

            alert('Mínimo de stock actualizado.');
            closeMinStockModal();
            await refreshAll();
        } catch (error: any) {
            console.error('Error updating min stock alert:', error);
            alert(`No se pudo actualizar el mínimo: ${error.message}`);
            setSavingMinStock(false);
        }
    };

    const loadReceiptSources = async () => {
        setLoadingReceiptSources(true);
        try {
            const [shipmentsRes, itemsRes] = await Promise.all([
                supabase
                    .from('inbound_shipments')
                    .select('id, supplier_name, status, eta_date')
                    .in('status', ['received', 'in_warehouse'])
                    .order('eta_date', { ascending: false }),
                supabase
                    .from('inbound_shipment_items')
                    .select('id, shipment_id, product_id, product_name_snapshot, sku_snapshot, qty')
            ]);

            if (shipmentsRes.error) throw shipmentsRes.error;
            if (itemsRes.error) throw itemsRes.error;

            setReceiptShipments((shipmentsRes.data || []) as ImportableShipment[]);
            setReceiptShipmentItems((itemsRes.data || []) as ImportableShipmentItem[]);
        } catch (error: any) {
            console.error('Error loading receipt sources:', error);
            alert(`No se pudieron cargar embarques recibidos: ${error.message}`);
        } finally {
            setLoadingReceiptSources(false);
        }
    };

    const openReceiptModal = async (item: InventoryItem) => {
        setReceiptItem(item);
        setReceiptQty('1');
        setReceiptShipmentId('');
        setReceiptShipmentItemId('');
        setReceiptReasonNote('');
        await loadReceiptSources();
    };

    const closeReceiptModal = () => {
        setReceiptItem(null);
        setReceiptQty('1');
        setReceiptShipmentId('');
        setReceiptShipmentItemId('');
        setReceiptReasonNote('');
        setSavingReceipt(false);
    };

    const saveReceipt = async () => {
        if (!receiptItem) return;

        const nextQty = Math.max(1, Math.trunc(Number(receiptQty || 0)));
        if (!Number.isFinite(nextQty) || nextQty <= 0) {
            alert('Debes ingresar una cantidad válida.');
            return;
        }

        setSavingReceipt(true);
        try {
            const { error } = await supabase.rpc('apply_inventory_manual_receipt', {
                p_shipment_id: receiptShipmentId || null,
                p_lines: [{
                    inventory_id: receiptItem.id,
                    qty: nextQty,
                    shipment_item_id: receiptShipmentItemId || null
                }],
                p_reason_note: receiptReasonNote.trim() || null
            });

            if (error) throw error;

            alert('Ingreso de stock registrado correctamente.');
            closeReceiptModal();
            await refreshAll();
        } catch (error: any) {
            console.error('Error applying inventory receipt:', error);
            alert(`No se pudo registrar el ingreso: ${error.message}`);
            setSavingReceipt(false);
        }
    };

    const requestSuggestedPurchase = (metric: RotationMetric) => {
        navigate('/procurement', {
            state: {
                activeTab: 'requests',
                openRequestModal: true,
                prefillRequest: {
                    productId: metric.inventory_id,
                    sku: metric.sku || null,
                    name: metric.name,
                    stockQty: metric.stock_qty,
                    requestedQty: Math.max(metric.suggested_reorder_qty, 1),
                    reasonType: metric.stock_qty <= 0 ? 'no_stock' : 'low_stock',
                    priority: metric.alert_level === 'critical' ? 'high' : 'normal',
                    requestNote: `Reposición sugerida desde Inventario. Venta 30 días: ${metric.units_sold_window} uds. Cobertura estimada: ${metric.days_of_coverage ?? 'sin ventas'} días.`
                }
            }
        });
    };

    const filteredItems = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return items;
        return items.filter((item) =>
            (item.name?.toLowerCase() || '').includes(term) ||
            (item.sku?.toLowerCase() || '').includes(term)
        );
    }, [items, search]);

    const filteredRotationMetrics = useMemo(() => {
        return rotationMetrics.filter((metric) => {
            const haystack = [metric.sku, metric.name, metric.category].filter(Boolean).join(' ').toLowerCase();
            if (rotationSearch.trim() && !haystack.includes(rotationSearch.trim().toLowerCase())) return false;
            if (rotationAlertFilter !== 'all' && metric.alert_level !== rotationAlertFilter) return false;
            if (rotationCategoryFilter !== 'all' && (metric.category || 'General') !== rotationCategoryFilter) return false;
            if (rotationRequestFilter === 'with_request' && !metric.has_open_request) return false;
            if (rotationRequestFilter === 'without_request' && metric.has_open_request) return false;
            return true;
        });
    }, [rotationAlertFilter, rotationCategoryFilter, rotationMetrics, rotationRequestFilter, rotationSearch]);

    const filteredMovements = useMemo(() => {
        return movements.filter((movement) => {
            const haystack = [
                movement.inventory?.sku,
                movement.inventory?.name,
                movement.reason_note,
                movement.reason_code,
                movement.movement_type,
                getMovementUserLabel(movement),
                getMovementOriginLabel(movement)
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

            if (movementSearch.trim() && !haystack.includes(movementSearch.trim().toLowerCase())) return false;
            if (movementTypeFilter !== 'all' && movement.movement_type !== movementTypeFilter) return false;
            if (movementOriginFilter !== 'all' && getMovementOriginLabel(movement) !== movementOriginFilter) return false;
            if (movementUserFilter !== 'all' && getMovementUserLabel(movement) !== movementUserFilter) return false;
            if (movementDateFrom && movement.created_at.slice(0, 10) < movementDateFrom) return false;
            if (movementDateTo && movement.created_at.slice(0, 10) > movementDateTo) return false;
            return true;
        });
    }, [movementDateFrom, movementDateTo, movementOriginFilter, movementSearch, movementTypeFilter, movementUserFilter, movements]);

    const lowStockCount = items.filter((item) => (item.stock_qty || 0) <= (item.min_stock_alert || 5)).length;
    const totalUnits = items.reduce((accumulator, item) => accumulator + (item.stock_qty || 0), 0);
    const criticalCount = filteredRotationMetrics.filter((item) => item.alert_level === 'critical').length;
    const warningCount = filteredRotationMetrics.filter((item) => item.alert_level === 'warning').length;
    const totalUnitsSold30d = filteredRotationMetrics.reduce((accumulator, item) => accumulator + (item.units_sold_window || 0), 0);
    const averageCoverage = filteredRotationMetrics
        .filter((item) => typeof item.days_of_coverage === 'number')
        .reduce((accumulator, item, _, list) => accumulator + Number(item.days_of_coverage || 0) / list.length, 0);
    const movementTypes = Array.from(new Set(movements.map((movement) => movement.movement_type))).sort();
    const movementOrigins = Array.from(new Set(movements.map((movement) => getMovementOriginLabel(movement)))).sort();
    const movementUsers = Array.from(new Set(movements.map((movement) => getMovementUserLabel(movement)))).sort();
    const selectedShipmentItems = receiptShipmentId && receiptItem
        ? receiptShipmentItems.filter((item) => {
            if (item.shipment_id !== receiptShipmentId) return false;
            if (item.product_id && item.product_id === receiptItem.id) return true;
            return (item.sku_snapshot || '').trim().toLowerCase() === (receiptItem.sku || '').trim().toLowerCase();
        })
        : [];

    return (
        <div className="mx-auto max-w-7xl space-y-8">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv,.xlsx,.xls"
                className="hidden"
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="premium-card border-l-4 border-l-indigo-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Total SKU</p>
                            <h3 className="text-3xl font-black text-gray-900">{items.length}</h3>
                        </div>
                        <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600">
                            <Package size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card border-l-4 border-l-amber-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Alertas Stock Bajo</p>
                            <h3 className="text-3xl font-black text-gray-900">{lowStockCount}</h3>
                        </div>
                        <div className="rounded-2xl bg-amber-50 p-3 text-amber-600">
                            <AlertTriangle size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card border-l-4 border-l-emerald-500 p-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">{isSellerReadOnly ? 'Unidades Totales' : 'Valor Inventario'}</p>
                            <h3 className="text-3xl font-black text-gray-900">
                                {isSellerReadOnly
                                    ? `${totalUnits.toLocaleString()} uds`
                                    : `$${items.reduce((accumulator, item) => accumulator + (item.price || 0) * (item.stock_qty || 0), 0).toLocaleString()}`}
                            </h3>
                        </div>
                        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                            <TrendingUp size={24} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="mb-1 text-3xl font-extrabold text-gray-900">Gestión de Inventario</h2>
                    <p className="font-medium text-gray-400">
                        {isSellerReadOnly
                            ? 'Consulta de stock disponible por producto'
                            : 'Control de stock, rotación y trazabilidad de inventario'}
                    </p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={() => void refreshAll()}
                        className="flex items-center rounded-2xl border border-gray-100 bg-white px-5 py-3 font-bold text-slate-700 shadow-sm transition-all hover:bg-gray-50"
                    >
                        <RefreshCw size={18} className="mr-2" />
                        Actualizar
                    </button>
                    {!canUploadInventory && canRequestProducts && (
                        <button
                            onClick={() => navigate('/procurement', { state: { activeTab: 'requests' } })}
                            className="flex items-center rounded-2xl border border-gray-100 bg-white px-5 py-3 font-bold text-indigo-600 shadow-sm transition-all hover:bg-gray-50"
                        >
                            <ClipboardList size={18} className="mr-2" />
                            Ver Solicitudes de Compra
                        </button>
                    )}
                </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                <div className={`grid gap-2 ${canViewAnalytics ? 'grid-cols-3' : 'grid-cols-1'}`}>
                    <button
                        onClick={() => setActiveTab('stock')}
                        className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'stock' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        Stock actual
                    </button>
                    {canViewAnalytics && (
                        <>
                            <button
                                onClick={() => setActiveTab('rotation')}
                                className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'rotation' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                Rotación y alertas
                            </button>
                            <button
                                onClick={() => {
                                    setActiveTab('movements');
                                    setMovementPage(1);
                                }}
                                className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${activeTab === 'movements' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                Movimientos
                            </button>
                        </>
                    )}
                </div>
            </div>

            {activeTab === 'stock' && (
                <div className="space-y-4">
                    <div className="space-y-4">
                        <div className="relative w-full md:max-w-4xl">
                            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="text"
                                placeholder="Buscar por SKU o Nombre de producto..."
                                className="min-h-[64px] w-full rounded-[1.75rem] border border-transparent bg-white py-4 pl-14 pr-5 text-base font-medium shadow-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            {canDownloadCatalog && (
                                <button
                                    onClick={downloadProductCatalog}
                                    disabled={loading}
                                    className="flex items-center rounded-2xl border border-gray-100 bg-white px-6 py-4 font-bold text-slate-700 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50"
                                >
                                    <Download size={18} className="mr-2" />
                                    Descargar Lista
                                </button>
                            )}
                            {canUploadInventory && (
                                <>
                                    <button
                                        onClick={() => handleImportClick('stock')}
                                        disabled={isImporting}
                                        className="flex items-center rounded-2xl border border-gray-100 bg-white px-6 py-4 font-bold text-indigo-600 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {isImporting && importType === 'stock'
                                            ? <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                                            : <FileSpreadsheet size={18} className="mr-2" />}
                                        Importar SKU + Nombre + Cantidad
                                    </button>
                                    <button
                                        onClick={downloadStockTemplate}
                                        disabled={isImporting}
                                        className="flex items-center rounded-2xl border border-gray-100 bg-white px-6 py-4 font-bold text-slate-700 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        <Download size={18} className="mr-2" />
                                        Plantilla Stock
                                    </button>
                                    <button
                                        onClick={() => handleImportClick('pricing')}
                                        disabled={isImporting}
                                        className="flex items-center rounded-2xl border border-gray-100 bg-white px-6 py-4 font-bold text-teal-600 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {isImporting && importType === 'pricing'
                                            ? <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
                                            : <TrendingUp size={18} className="mr-2" />}
                                        Importar SKU + Precio Neto
                                    </button>
                                    <button
                                        onClick={downloadPricingTemplate}
                                        disabled={isImporting}
                                        className="flex items-center rounded-2xl border border-gray-100 bg-white px-6 py-4 font-bold text-slate-700 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        <Download size={18} className="mr-2" />
                                        Plantilla Precios
                                    </button>
                                    <button
                                        onClick={() => setShowNewProductModal(true)}
                                        className="flex items-center rounded-2xl bg-indigo-600 px-6 py-4 font-bold text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-95"
                                    >
                                        <Plus size={18} className="mr-2" />
                                        Nuevo Producto
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {loading ? (
                        <div className="space-y-4">
                            {[1, 2, 3, 4].map((index) => (
                                <div key={index} className="premium-card h-20 animate-pulse bg-gray-50/50" />
                            ))}
                        </div>
                    ) : (
                        <div className="premium-card overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-gray-50/50">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400">Producto</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">SKU</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">Stock</th>
                                        {!isSellerReadOnly && <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">Precio</th>}
                                        {canViewAnalytics && <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-gray-400">Mínimo</th>}
                                        {canShowActions && <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-gray-400">Acciones</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {filteredItems.map((item) => (
                                        <tr key={item.id} className="group transition-colors hover:bg-gray-50/30">
                                            <td className="px-6 py-5">
                                                <div className="flex items-center space-x-4">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-100 bg-gray-50">
                                                        <Package size={18} className="text-gray-300" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-gray-900">{item.name}</p>
                                                        <p className="text-[10px] font-medium uppercase text-gray-400">{item.category || 'General'}</p>
                                                        <p className="mt-1 text-[11px] font-bold text-slate-500">
                                                            Proveedor: {supplierMap.get(item.supplier_id || '')?.name || 'Sin proveedor'}
                                                        </p>
                                                        <p className="mt-1">
                                                            <span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${item.allow_sale_without_stock ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                                                {item.allow_sale_without_stock ? 'Permite pedido sin stock' : 'Requiere stock para pedido'}
                                                            </span>
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-center text-sm font-mono text-gray-500">{item.sku || '---'}</td>
                                            <td className="px-6 py-5 text-center">
                                                <span className={`rounded-full border px-3 py-1 text-xs font-bold ${(item.stock_qty || 0) <= (item.min_stock_alert || 5) ? 'border-orange-100 bg-orange-50 text-orange-600' : 'border-green-100 bg-green-50 text-green-600'}`}>
                                                    {item.stock_qty} uds
                                                </span>
                                            </td>
                                            {!isSellerReadOnly && (
                                                <td className="px-6 py-5 text-center text-sm font-bold text-gray-900">
                                                    {canManagePricing && editingPriceId === item.id ? (
                                                        <div className="flex items-center justify-center gap-2">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="1"
                                                                className="w-28 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-center text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                                                value={editingPriceValue}
                                                                onChange={(event) => setEditingPriceValue(event.target.value)}
                                                                onKeyDown={(event) => {
                                                                    if (event.key === 'Enter') {
                                                                        event.preventDefault();
                                                                        void saveManualPrice(item);
                                                                    }
                                                                    if (event.key === 'Escape') {
                                                                        event.preventDefault();
                                                                        cancelPriceEdit();
                                                                    }
                                                                }}
                                                                autoFocus
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => void saveManualPrice(item)}
                                                                disabled={savingPriceId === item.id}
                                                                className="rounded-lg bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                                                                title="Guardar precio"
                                                            >
                                                                <Check size={16} />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={cancelPriceEdit}
                                                                disabled={savingPriceId === item.id}
                                                                className="rounded-lg bg-gray-100 p-2 text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50"
                                                                title="Cancelar edición"
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-center gap-2">
                                                            <span>${item.price?.toLocaleString()}</span>
                                                            {canManagePricing && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => startPriceEdit(item)}
                                                                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                                                                    title="Editar precio manualmente"
                                                                >
                                                                    <Pencil size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            )}
                                            {canViewAnalytics && (
                                                <td className="px-6 py-5 text-center">
                                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">
                                                        {item.min_stock_alert} uds
                                                    </span>
                                                </td>
                                            )}
                                            {canShowActions && (
                                                <td className="px-6 py-5 text-right">
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        {canManageStockControls && (
                                                            <>
                                                                <button
                                                                    onClick={() => openAdjustmentModal(item)}
                                                                    className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-indigo-700 transition-all hover:bg-indigo-100"
                                                                    title="Ajustar stock con auditoría"
                                                                >
                                                                    Ajustar stock
                                                                </button>
                                                                <button
                                                                    onClick={() => openReceiptModal(item)}
                                                                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-emerald-700 transition-all hover:bg-emerald-100"
                                                                    title="Registrar ingreso"
                                                                >
                                                                    Registrar ingreso
                                                                </button>
                                                                <button
                                                                    onClick={() => openMinStockModal(item)}
                                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700 transition-all hover:bg-slate-50"
                                                                    title="Editar mínimo"
                                                                >
                                                                    Editar mínimo
                                                                </button>
                                                            </>
                                                        )}
                                                        {canManageInventory && (
                                                            <>
                                                                <button
                                                                    onClick={() => openSupplierModal(item)}
                                                                    className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-cyan-700 transition-all hover:bg-cyan-100"
                                                                    title="Asignar proveedor"
                                                                >
                                                                    Proveedor
                                                                </button>
                                                            </>
                                                        )}
                                                        {canManageStocklessOrders && (
                                                            <>
                                                                <button
                                                                    onClick={() => openStockPolicyModal(item)}
                                                                    className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-violet-700 transition-all hover:bg-violet-100"
                                                                    title="Configurar si este producto puede venderse sin stock"
                                                                >
                                                                    Sin stock
                                                                </button>
                                                            </>
                                                        )}
                                                        {(canManageInventory || canViewAnalytics) && (
                                                            <button
                                                                onClick={() => void fetchHistory(item)}
                                                                className="rounded-lg p-2 text-gray-400 transition-all hover:bg-indigo-50 hover:text-indigo-600"
                                                                title="Ver historial"
                                                            >
                                                                <History size={18} />
                                                            </button>
                                                        )}
                                                        {canRequestProducts && (
                                                            <button
                                                                onClick={() => navigate('/procurement', {
                                                                    state: {
                                                                        activeTab: 'requests',
                                                                        openRequestModal: true,
                                                                        prefillProduct: {
                                                                            id: item.id,
                                                                            sku: item.sku || null,
                                                                            name: item.name,
                                                                            stock_qty: item.stock_qty || 0
                                                                        }
                                                                    }
                                                                })}
                                                                className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-indigo-700 transition-all hover:bg-indigo-100"
                                                                title="Solicitar producto"
                                                            >
                                                                Solicitar
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'rotation' && canViewAnalytics && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        <div className="premium-card border-l-4 border-l-rose-500 p-6">
                            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Alerta crítica</p>
                            <h3 className="text-3xl font-black text-gray-900">{criticalCount}</h3>
                        </div>
                        <div className="premium-card border-l-4 border-l-amber-500 p-6">
                            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Bajo mínimo</p>
                            <h3 className="text-3xl font-black text-gray-900">{filteredRotationMetrics.filter((item) => item.alert_level === 'low').length}</h3>
                        </div>
                        <div className="premium-card border-l-4 border-l-indigo-500 p-6">
                            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Cobertura promedio</p>
                            <h3 className="text-3xl font-black text-gray-900">{Number.isFinite(averageCoverage) ? `${averageCoverage.toFixed(1)} días` : 'N/A'}</h3>
                        </div>
                        <div className="premium-card border-l-4 border-l-emerald-500 p-6">
                            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Ventas 30 días</p>
                            <h3 className="text-3xl font-black text-gray-900">{totalUnitsSold30d}</h3>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
                        <div className="relative xl:col-span-2">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                value={rotationSearch}
                                onChange={(event) => setRotationSearch(event.target.value)}
                                placeholder="Buscar por SKU, producto o categoría..."
                                className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                        <select
                            value={rotationAlertFilter}
                            onChange={(event) => setRotationAlertFilter(event.target.value as typeof rotationAlertFilter)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300"
                        >
                            <option value="all">Todas las alertas</option>
                            <option value="critical">Crítica</option>
                            <option value="low">Bajo mínimo</option>
                            <option value="warning">Cobertura baja</option>
                            <option value="healthy">Sano</option>
                        </select>
                        <select
                            value={rotationCategoryFilter}
                            onChange={(event) => setRotationCategoryFilter(event.target.value)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300"
                        >
                            <option value="all">Todas las categorías</option>
                            {inventoryCategories.map((category) => (
                                <option key={category} value={category}>{category}</option>
                            ))}
                        </select>
                        <select
                            value={rotationRequestFilter}
                            onChange={(event) => setRotationRequestFilter(event.target.value as typeof rotationRequestFilter)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300"
                        >
                            <option value="all">Todas las solicitudes</option>
                            <option value="with_request">Con solicitud abierta</option>
                            <option value="without_request">Sin solicitud abierta</option>
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => {
                                const nextValue = !rotationOnlyAlerts;
                                setRotationOnlyAlerts(nextValue);
                                void fetchRotationMetrics({ onlyAlerts: nextValue });
                            }}
                            className={`rounded-2xl px-4 py-3 text-sm font-black transition-all ${rotationOnlyAlerts ? 'bg-amber-500 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
                        >
                            Solo alertas
                        </button>
                        <button
                            onClick={() => void fetchRotationMetrics()}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700"
                        >
                            Recalcular rotación
                        </button>
                    </div>

                    {rotationLoading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((index) => (
                                <div key={index} className="premium-card h-24 animate-pulse bg-slate-50" />
                            ))}
                        </div>
                    ) : (
                        <div className="premium-card overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50/70">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Producto</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Stock</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Mínimo</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Venta 30d</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Promedio Diario</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Cobertura</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Sugerido</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Alerta</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Solicitud</th>
                                        <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredRotationMetrics.map((metric) => {
                                        const item = items.find((candidate) => candidate.id === metric.inventory_id) || null;
                                        const alertClass = metric.alert_level === 'critical'
                                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                                            : metric.alert_level === 'low'
                                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                : metric.alert_level === 'warning'
                                                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700';

                                        return (
                                            <tr key={metric.inventory_id} className="transition-colors hover:bg-slate-50/60">
                                                <td className="px-6 py-5">
                                                    <p className="font-black text-slate-900">{metric.name}</p>
                                                    <p className="mt-1 text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{metric.sku || 'SIN-SKU'} · {metric.category || 'General'}</p>
                                                    <p className="mt-2 text-xs text-slate-500">Última venta: {formatDate(metric.last_sale_at)}</p>
                                                </td>
                                                <td className="px-6 py-5 text-center font-bold text-slate-900">{metric.stock_qty}</td>
                                                <td className="px-6 py-5 text-center font-bold text-slate-700">{metric.min_stock_alert}</td>
                                                <td className="px-6 py-5 text-center font-bold text-slate-900">{metric.units_sold_window}</td>
                                                <td className="px-6 py-5 text-center font-bold text-slate-900">{Number(metric.avg_daily_sales || 0).toFixed(2)}</td>
                                                <td className="px-6 py-5 text-center font-bold text-slate-900">{metric.days_of_coverage != null ? `${metric.days_of_coverage} días` : 'Sin ventas'}</td>
                                                <td className="px-6 py-5 text-center font-bold text-indigo-700">{metric.suggested_reorder_qty}</td>
                                                <td className="px-6 py-5 text-center">
                                                    <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${alertClass}`}>
                                                        {metric.alert_level}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5 text-center">
                                                    <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${metric.has_open_request ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                                        {metric.has_open_request ? 'Abierta' : 'Sin solicitud'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-5 text-right">
                                                    <div className="flex flex-wrap justify-end gap-2">
                                                        <button
                                                            onClick={() => requestSuggestedPurchase(metric)}
                                                            className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-indigo-700 transition-all hover:bg-indigo-100"
                                                        >
                                                            Solicitar compra
                                                        </button>
                                                        {item && (
                                                            <>
                                                                <button
                                                                    onClick={() => openMinStockModal(item)}
                                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700 transition-all hover:bg-slate-50"
                                                                >
                                                                    Editar mínimo
                                                                </button>
                                                                <button
                                                                    onClick={() => void fetchHistory(item)}
                                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-700 transition-all hover:bg-slate-50"
                                                                >
                                                                    Ver movimientos
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {filteredRotationMetrics.length === 0 && (
                                <div className="p-10 text-center">
                                    <AlertTriangle className="mx-auto mb-4 text-slate-300" size={36} />
                                    <h3 className="mb-2 text-xl font-black text-slate-900">No hay productos para los filtros actuales</h3>
                                    <p className="font-medium text-slate-500">Prueba cambiando la búsqueda o mostrando todos los niveles de alerta.</p>
                                </div>
                            )}
                        </div>
                    )}
                    {warningCount > 0 && (
                        <p className="text-sm font-medium text-slate-500">
                            {warningCount} SKU tienen cobertura estimada menor o igual a 7 días aunque aún no estén bajo su mínimo.
                        </p>
                    )}
                </div>
            )}

            {activeTab === 'movements' && canViewAnalytics && (
                <div className="space-y-6">
                    {movementsError && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
                            No se pudieron cargar los movimientos en este momento: {movementsError}
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-6">
                        <div className="relative xl:col-span-2">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                            <input
                                value={movementSearch}
                                onChange={(event) => setMovementSearch(event.target.value)}
                                placeholder="Buscar por producto, usuario o motivo..."
                                className="w-full rounded-2xl border border-slate-200 bg-white py-4 pl-12 pr-4 font-medium text-slate-700 outline-none transition-all focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            />
                        </div>
                        <select value={movementTypeFilter} onChange={(event) => setMovementTypeFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300">
                            <option value="all">Todos los tipos</option>
                            {movementTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                        <select value={movementOriginFilter} onChange={(event) => setMovementOriginFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300">
                            <option value="all">Todos los orígenes</option>
                            {movementOrigins.map((origin) => (
                                <option key={origin} value={origin}>{origin}</option>
                            ))}
                        </select>
                        <select value={movementUserFilter} onChange={(event) => setMovementUserFilter(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300">
                            <option value="all">Todos los usuarios</option>
                            {movementUsers.map((user) => (
                                <option key={user} value={user}>{user}</option>
                            ))}
                        </select>
                        <div className="flex gap-3">
                            <input
                                type="date"
                                value={movementDateFrom}
                                onChange={(event) => setMovementDateFrom(event.target.value)}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300"
                            />
                            <input
                                type="date"
                                value={movementDateTo}
                                onChange={(event) => setMovementDateTo(event.target.value)}
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-700 outline-none focus:border-indigo-300"
                            />
                        </div>
                    </div>

                    {movementsLoading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((index) => (
                                <div key={index} className="premium-card h-24 animate-pulse bg-slate-50" />
                            ))}
                        </div>
                    ) : (
                        <div className="premium-card overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50/70">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Producto</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Cantidad</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Antes</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Después</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Motivo</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Usuario</th>
                                        <th className="px-6 py-4 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Origen</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredMovements.map((movement) => (
                                        <tr key={movement.id} className="transition-colors hover:bg-slate-50/60">
                                            <td className="px-6 py-5 text-sm font-bold text-slate-800">{formatDateTime(movement.created_at)}</td>
                                            <td className="px-6 py-5">
                                                <p className="font-black text-slate-900">{movement.inventory?.name || 'Producto no encontrado'}</p>
                                                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">{movement.inventory?.sku || 'SIN-SKU'}</p>
                                            </td>
                                            <td className="px-6 py-5 text-center text-xs font-black uppercase tracking-wide text-slate-700">{movement.movement_type}</td>
                                            <td className={`px-6 py-5 text-center text-sm font-black ${movement.direction === 'out' ? 'text-rose-600' : movement.direction === 'in' ? 'text-emerald-600' : 'text-indigo-600'}`}>
                                                {movement.direction === 'out' ? '-' : '+'}{movement.qty}
                                            </td>
                                            <td className="px-6 py-5 text-center font-bold text-slate-700">{movement.stock_before}</td>
                                            <td className="px-6 py-5 text-center font-bold text-slate-900">{movement.stock_after}</td>
                                            <td className="px-6 py-5 text-center text-sm text-slate-600">
                                                <p className="font-bold">{movement.reason_code}</p>
                                                {movement.reason_note && <p className="mt-1 text-xs text-slate-400">{movement.reason_note}</p>}
                                            </td>
                                            <td className="px-6 py-5 text-center text-sm font-bold text-slate-700">{getMovementUserLabel(movement)}</td>
                                            <td className="px-6 py-5 text-center text-sm font-bold text-slate-700">{getMovementOriginLabel(movement)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredMovements.length === 0 && (
                                <div className="p-10 text-center">
                                    <History className="mx-auto mb-4 text-slate-300" size={36} />
                                    <h3 className="mb-2 text-xl font-black text-slate-900">No hay movimientos para los filtros actuales</h3>
                                    <p className="font-medium text-slate-500">Prueba con otro rango o quitando filtros de tipo y origen.</p>
                                </div>
                            )}
                        </div>
                    )}
                    {!movementsLoading && !movementsError && (
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-bold text-slate-500">
                                Página {movementPage} · mostrando hasta {MOVEMENTS_PAGE_SIZE} movimientos por carga
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setMovementPage((previous) => Math.max(1, previous - 1))}
                                    disabled={movementPage === 1}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Anterior
                                </button>
                                <button
                                    onClick={() => setMovementPage((previous) => previous + 1)}
                                    disabled={!movementHasMore}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Siguiente
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {selectedHistoryItem && (
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between bg-gray-900 p-6 text-white">
                            <div>
                                <h3 className="text-lg font-bold">Historial de producto</h3>
                                <p className="mt-1 text-xs font-mono text-gray-400">{selectedHistoryItem.sku} · {selectedHistoryItem.name}</p>
                            </div>
                            <button onClick={() => setSelectedHistoryItem(null)} className="rounded-full p-2 transition-all hover:bg-white/20">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-6 overflow-y-auto p-6">
                            {loadingHistory ? (
                                <div className="space-y-3">
                                    {[1, 2, 3].map((index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-50" />)}
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <div className="mb-3 flex items-center gap-2">
                                            <ClipboardList size={18} className="text-indigo-600" />
                                            <h4 className="text-lg font-black text-slate-900">Ventas</h4>
                                        </div>
                                        {salesHistoryData.length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-medium text-slate-500">
                                                No hay ventas registradas para este producto.
                                            </div>
                                        ) : (
                                            <table className="w-full text-left">
                                                <thead>
                                                    <tr className="border-b border-slate-100">
                                                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha</th>
                                                        <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Tipo</th>
                                                        <th className="pb-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Cotización</th>
                                                        <th className="pb-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Cantidad</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {salesHistoryData.map((record: any, index) => (
                                                        <tr key={index}>
                                                            <td className="py-4 text-xs font-bold text-slate-700">
                                                                {formatDate(record.created_at)} <span className="ml-1 text-[10px] font-medium text-slate-400">{new Date(record.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                            </td>
                                                            <td className="py-4">
                                                                <span className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-600">
                                                                    Venta
                                                                </span>
                                                            </td>
                                                            <td className="py-4 text-center">
                                                                <span className="font-mono text-xs font-bold text-indigo-600">
                                                                    #{record.orders?.quotations?.folio || 'N/A'}
                                                                </span>
                                                            </td>
                                                            <td className="py-4 text-right">
                                                                <span className="font-bold text-red-600">-{record.quantity}</span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>

                                    <div>
                                        <div className="mb-3 flex items-center gap-2">
                                            <History size={18} className="text-emerald-600" />
                                            <h4 className="text-lg font-black text-slate-900">Movimientos auditados</h4>
                                        </div>
                                        {movementHistoryData.length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm font-medium text-slate-500">
                                                No hay movimientos auditados registrados todavía para este producto.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {movementHistoryData.map((movement) => (
                                                    <div key={movement.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                                            <div>
                                                                <p className="font-black text-slate-900">{movement.movement_type}</p>
                                                                <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">
                                                                    {movement.reason_code} · {formatDateTime(movement.created_at)}
                                                                </p>
                                                                {movement.reason_note && <p className="mt-2 text-sm text-slate-600">{movement.reason_note}</p>}
                                                            </div>
                                                            <div className="grid grid-cols-3 gap-3 text-center text-sm font-bold text-slate-700">
                                                                <div className="rounded-xl bg-white px-3 py-2">Antes<br />{movement.stock_before}</div>
                                                                <div className="rounded-xl bg-white px-3 py-2">Cantidad<br />{movement.direction === 'out' ? '-' : '+'}{movement.qty}</div>
                                                                <div className="rounded-xl bg-white px-3 py-2">Después<br />{movement.stock_after}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showNewProductModal && canManageInventory && (
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between bg-indigo-600 p-6 text-white">
                            <h3 className="text-lg font-bold">Nuevo Producto</h3>
                            <button onClick={() => setShowNewProductModal(false)} className="rounded-full p-2 transition-all hover:bg-white/20">
                                <Plus size={20} className="rotate-45" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateProduct} className="space-y-4 p-6">
                            <div>
                                <label className="mb-1 block text-xs font-bold uppercase text-gray-400">Código SKU</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={newProduct.sku}
                                    onChange={(event) => setNewProduct({ ...newProduct, sku: event.target.value })}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold uppercase text-gray-400">Nombre del Producto</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={newProduct.name}
                                    onChange={(event) => setNewProduct({ ...newProduct, name: event.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="mb-1 block text-xs font-bold uppercase text-gray-400">Precio</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={newProduct.price}
                                        onChange={(event) => setNewProduct({ ...newProduct, price: Number(event.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-bold uppercase text-gray-400">Stock</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={newProduct.stock_qty}
                                        onChange={(event) => setNewProduct({ ...newProduct, stock_qty: Number(event.target.value) })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold uppercase text-gray-400">Categoría</label>
                                <input
                                    type="text"
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={newProduct.category}
                                    onChange={(event) => setNewProduct({ ...newProduct, category: event.target.value })}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold uppercase text-gray-400">Proveedor</label>
                                <select
                                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500"
                                    value={newProduct.supplier_id}
                                    onChange={(event) => setNewProduct({ ...newProduct, supplier_id: event.target.value })}
                                >
                                    <option value="">Sin proveedor asignado</option>
                                    {activeSuppliers.map((supplier) => (
                                        <option key={supplier.id} value={supplier.id}>
                                            {supplier.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {canManageStocklessOrders && (
                                <label className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-4">
                                    <input
                                        type="checkbox"
                                        checked={newProduct.allow_sale_without_stock}
                                        onChange={(event) => setNewProduct({ ...newProduct, allow_sale_without_stock: event.target.checked })}
                                        className="mt-1 h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                                    />
                                    <div>
                                        <p className="text-sm font-black text-violet-900">Permitir convertir a pedido sin stock</p>
                                        <p className="mt-1 text-xs font-medium text-violet-700">
                                            Si lo marcas, este producto podrá generar pedidos aunque el stock disponible sea insuficiente. El stock podrá quedar negativo.
                                        </p>
                                    </div>
                                </label>
                            )}
                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setShowNewProductModal(false)} className="rounded-2xl border border-gray-200 px-5 py-3 font-bold text-slate-700">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={isSaving} className="rounded-2xl bg-indigo-600 px-5 py-3 font-bold text-white shadow-lg shadow-indigo-100 disabled:opacity-60">
                                    {isSaving ? 'Guardando...' : 'Crear Producto'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {supplierItem && canManageInventory && (
                <div className="fixed inset-0 z-[2005] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between bg-cyan-600 p-6 text-white">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-cyan-100">Proveedor del Producto</p>
                                <h3 className="text-xl font-black">{supplierItem.name}</h3>
                            </div>
                            <button onClick={closeSupplierModal} className="rounded-full p-2 transition-all hover:bg-white/20">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-5 p-6">
                            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                <p className="text-sm font-bold text-slate-800">SKU: {supplierItem.sku || 'SIN-SKU'}</p>
                                <p className="mt-1 text-xs text-slate-500">Asigna el proveedor principal para filtrar productos al crear órdenes de compra.</p>
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Proveedor asignado</label>
                                <select
                                    value={supplierValue}
                                    onChange={(event) => setSupplierValue(event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-cyan-300"
                                >
                                    <option value="">Sin proveedor asignado</option>
                                    {activeSuppliers.map((supplier) => (
                                        <option key={supplier.id} value={supplier.id}>
                                            {supplier.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button onClick={closeSupplierModal} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button onClick={() => void saveSupplierAssignment()} disabled={savingSupplier} className="rounded-2xl bg-cyan-600 px-5 py-3 font-black text-white shadow-lg shadow-cyan-100 disabled:opacity-60">
                                    {savingSupplier ? 'Guardando...' : 'Guardar proveedor'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {stockPolicyItem && canManageStocklessOrders && (
                <div className="fixed inset-0 z-[2006] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between bg-violet-600 p-6 text-white">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-violet-100">Política de Stock</p>
                                <h3 className="text-xl font-black">{stockPolicyItem.name}</h3>
                            </div>
                            <button onClick={closeStockPolicyModal} className="rounded-full p-2 transition-all hover:bg-white/20">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-5 p-6">
                            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                <p className="text-sm font-bold text-slate-800">SKU: {stockPolicyItem.sku || 'SIN-SKU'}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                    Define si este producto puede convertirse a pedido aunque el stock actual no alcance. Si lo permites, el stock podrá quedar negativo.
                                </p>
                            </div>
                            <label className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-4">
                                <input
                                    type="checkbox"
                                    checked={stockPolicyValue}
                                    onChange={(event) => setStockPolicyValue(event.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                                />
                                <div>
                                    <p className="text-sm font-black text-violet-900">Permitir pedido sin stock</p>
                                    <p className="mt-1 text-xs font-medium text-violet-700">
                                        Úsalo solo en productos que deban poder venderse bajo pedido o con reposición posterior.
                                    </p>
                                </div>
                            </label>
                            <div className="flex justify-end gap-3">
                                <button onClick={closeStockPolicyModal} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button onClick={() => void saveStockPolicy()} disabled={savingStockPolicy} className="rounded-2xl bg-violet-600 px-5 py-3 font-black text-white shadow-lg shadow-violet-100 disabled:opacity-60">
                                    {savingStockPolicy ? 'Guardando...' : 'Guardar política'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {adjustmentItem && canManageStockControls && (
                <div className="fixed inset-0 z-[2010] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between bg-slate-900 p-6 text-white">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-indigo-300">Ajuste Manual</p>
                                <h3 className="text-xl font-black">{adjustmentItem.name}</h3>
                            </div>
                            <button onClick={closeAdjustmentModal} className="rounded-full p-2 transition-all hover:bg-white/20">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-5 p-6">
                            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                <p className="text-sm font-bold text-slate-800">Stock actual: {adjustmentItem.stock_qty || 0} uds</p>
                                <p className="mt-1 text-xs text-slate-500">SKU {adjustmentItem.sku || 'SIN-SKU'} · Deja trazabilidad con motivo obligatorio.</p>
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Nuevo stock</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={adjustmentStockValue}
                                    onChange={(event) => setAdjustmentStockValue(event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Motivo</label>
                                <select
                                    value={adjustmentReasonCode}
                                    onChange={(event) => setAdjustmentReasonCode(event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                >
                                    {MOVEMENT_REASON_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Comentario</label>
                                <textarea
                                    rows={4}
                                    value={adjustmentReasonNote}
                                    onChange={(event) => setAdjustmentReasonNote(event.target.value)}
                                    placeholder="Opcional. Ej: conteo físico de bodega, corrección post venta, merma detectada..."
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-medium text-slate-700 outline-none focus:border-indigo-300"
                                />
                            </div>
                            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-medium text-indigo-700">
                                Diferencia: {Math.max(0, Math.trunc(Number(adjustmentStockValue || 0))) - (adjustmentItem.stock_qty || 0)} uds
                            </div>
                            <div className="flex justify-end gap-3">
                                <button onClick={closeAdjustmentModal} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button onClick={() => void saveManualStock()} disabled={savingAdjustment} className="rounded-2xl bg-indigo-600 px-5 py-3 font-black text-white shadow-lg shadow-indigo-100 disabled:opacity-60">
                                    {savingAdjustment ? 'Guardando...' : 'Guardar ajuste'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {minStockItem && canManageStockControls && (
                <div className="fixed inset-0 z-[2015] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between bg-slate-900 p-6 text-white">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-amber-300">Mínimo Operativo</p>
                                <h3 className="text-xl font-black">{minStockItem.name}</h3>
                            </div>
                            <button onClick={closeMinStockModal} className="rounded-full p-2 transition-all hover:bg-white/20">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-5 p-6">
                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Nuevo mínimo</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={minStockValue}
                                    onChange={(event) => setMinStockValue(event.target.value)}
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-indigo-300"
                                />
                            </div>
                            <div className="flex justify-end gap-3">
                                <button onClick={closeMinStockModal} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button onClick={() => void saveMinStock()} disabled={savingMinStock} className="rounded-2xl bg-amber-500 px-5 py-3 font-black text-white shadow-lg shadow-amber-100 disabled:opacity-60">
                                    {savingMinStock ? 'Guardando...' : 'Guardar mínimo'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {receiptItem && canManageStockControls && (
                <div className="fixed inset-0 z-[2020] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between bg-emerald-600 p-6 text-white">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-100">Ingreso Manual</p>
                                <h3 className="text-xl font-black">{receiptItem.name}</h3>
                            </div>
                            <button onClick={closeReceiptModal} className="rounded-full p-2 transition-all hover:bg-white/20">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-5 p-6">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Cantidad a ingresar</label>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={receiptQty}
                                        onChange={(event) => setReceiptQty(event.target.value)}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-emerald-300"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Embarque vinculado (opcional)</label>
                                    <select
                                        value={receiptShipmentId}
                                        onChange={(event) => {
                                            setReceiptShipmentId(event.target.value);
                                            setReceiptShipmentItemId('');
                                        }}
                                        disabled={loadingReceiptSources}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-emerald-300"
                                    >
                                        <option value="">Sin embarque</option>
                                        {receiptShipments.map((shipment) => (
                                            <option key={shipment.id} value={shipment.id}>
                                                {shipment.supplier_name} · {shipment.status} · ETA {formatDate(shipment.eta_date)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {receiptShipmentId && (
                                <div>
                                    <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Línea del embarque</label>
                                    <select
                                        value={receiptShipmentItemId}
                                        onChange={(event) => setReceiptShipmentItemId(event.target.value)}
                                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-bold text-slate-800 outline-none focus:border-emerald-300"
                                    >
                                        <option value="">Selecciona la línea correspondiente</option>
                                        {selectedShipmentItems.map((shipmentItem) => (
                                            <option key={shipmentItem.id} value={shipmentItem.id}>
                                                {(shipmentItem.sku_snapshot || 'SIN-SKU')} · {shipmentItem.product_name_snapshot} · {shipmentItem.qty} uds
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="mb-2 block text-xs font-black uppercase tracking-[0.2em] text-slate-400">Observación</label>
                                <textarea
                                    rows={4}
                                    value={receiptReasonNote}
                                    onChange={(event) => setReceiptReasonNote(event.target.value)}
                                    placeholder="Opcional. Ej: ingreso parcial de embarque, recepción manual por ajuste físico, etc."
                                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-medium text-slate-700 outline-none focus:border-emerald-300"
                                />
                            </div>

                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                                Este ingreso sumará stock sin depender del cambio de estado del embarque. El embarque sigue sin mover stock automáticamente.
                            </div>

                            <div className="flex justify-end gap-3">
                                <button onClick={closeReceiptModal} className="rounded-2xl border border-slate-200 px-5 py-3 font-black text-slate-700">
                                    Cancelar
                                </button>
                                <button onClick={() => void saveReceipt()} disabled={savingReceipt || loadingReceiptSources || (receiptShipmentId !== '' && receiptShipmentItemId === '')} className="rounded-2xl bg-emerald-600 px-5 py-3 font-black text-white shadow-lg shadow-emerald-100 disabled:opacity-60">
                                    {savingReceipt ? 'Guardando...' : 'Registrar ingreso'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Inventory;
