import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Search, Package, Plus, AlertTriangle, TrendingUp, History, FileSpreadsheet, Download, ClipboardList, Pencil, Check, X } from 'lucide-react';
import { Database } from '../types/supabase';
import * as XLSX from 'xlsx';

type InventoryItem = Database['public']['Tables']['inventory']['Row'] & { sku?: string | null };
type ImportType = 'stock' | 'pricing';

const Inventory = () => {
    const navigate = useNavigate();
    const { hasPermission, effectiveRole } = useUser();
    const isSellerReadOnly = effectiveRole === 'seller';
    const canManageInventory = !isSellerReadOnly && hasPermission('MANAGE_INVENTORY');
    const canUploadInventory = !isSellerReadOnly && hasPermission('UPLOAD_EXCEL');
    const canRequestProducts = hasPermission('REQUEST_PRODUCTS');
    const canDownloadCatalog = effectiveRole === 'admin' || effectiveRole === 'jefe';
    const canShowActions = canManageInventory || canRequestProducts;
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [isImporting, setIsImporting] = useState(false);
    const [importType, setImportType] = useState<ImportType | null>(null);
    const [showNewProductModal, setShowNewProductModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
    const [editingPriceValue, setEditingPriceValue] = useState('');
    const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
    const [editingStockId, setEditingStockId] = useState<string | null>(null);
    const [editingStockValue, setEditingStockValue] = useState('');
    const [savingStockId, setSavingStockId] = useState<string | null>(null);
    const [newProduct, setNewProduct] = useState({
        sku: '',
        name: '',
        price: 0,
        stock_qty: 0,
        category: 'General'
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const normalizeHeader = (value: string) =>
        value
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');

    const normalizeSku = (value: any) => String(value || '').trim().toUpperCase();

    const parseImportedPrice = (value: any) => {
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

    const getValueByAliases = (row: Record<string, any>, aliases: string[]) => {
        const normalizedAliases = aliases.map(normalizeHeader);
        const entries = Object.entries(row);

        for (const [key, value] of entries) {
            const normalizedKey = normalizeHeader(key);
            if (normalizedAliases.some(alias => normalizedKey.includes(alias))) {
                return value;
            }
        }

        return null;
    };

    const getValueByExactAliases = (row: Record<string, any>, aliases: string[]) => {
        const normalizedAliases = new Set(aliases.map(normalizeHeader));
        const entries = Object.entries(row);

        for (const [key, value] of entries) {
            const normalizedKey = normalizeHeader(key);
            if (normalizedAliases.has(normalizedKey)) {
                return value;
            }
        }

        return null;
    };

    const fetchInventory = async () => {
        setLoading(true);
        // Explicit projection: avoid leaking internal cost/margin columns to client UI.
        const { data, error } = await (supabase.from('inventory') as any)
            .select('id, sku, name, price, stock_qty, category, created_at')
            .eq('is_service_item', false)
            .order('name');
        if (error) {
            console.error('Error fetching inventory:', error);
        }
        if (data) setItems(data as any as InventoryItem[]);
        setLoading(false);
    };

    useEffect(() => {
        fetchInventory();
    }, []);

    const [selectedHistoryItem, setSelectedHistoryItem] = useState<InventoryItem | null>(null);
    const [historyData, setHistoryData] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    const fetchHistory = async (item: InventoryItem) => {
        setSelectedHistoryItem(item);
        setLoadingHistory(true);
        try {
            // Fetch order items for this product, including order details and linked quotation folio
            const { data, error } = await supabase
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
                .order('created_at', { ascending: false });

            if (error) throw error;
            setHistoryData(data || []);
        } catch (error) {
            console.error("Error fetching history:", error);
            alert("Error al cargar el historial");
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
        const rows = [
            {
                SKU: 'SKU-001',
                Nombre: 'Implante Demo',
                Cantidad: 25
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(rows, {
            header: ['SKU', 'Nombre', 'Cantidad']
        });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock');
        XLSX.writeFile(workbook, 'plantilla_importador_stock.xlsx');
    };

    const downloadPricingTemplate = () => {
        const rows = [
            {
                SKU: 'SKU-001',
                'Precio Neto Venta': 15990
            }
        ];

        const worksheet = XLSX.utils.json_to_sheet(rows, {
            header: ['SKU', 'Precio Neto Venta']
        });
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
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

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

                const { data, error } = await supabase.rpc('replace_inventory_stock_import', {
                    p_items: newItems
                });
                if (error) throw error;

                alert(`Importador de stock completado. ${data?.processed_count || newItems.length} SKU procesados, ${data?.deleted_count || 0} SKU reemplazados y ${data?.preserved_historical_count || 0} SKU históricos conservados con stock 0.`);
            } else if (importType === 'pricing') {
                const expectedSkuHeaders = ['sku'];
                const expectedPriceHeaders = ['precionetoventa', 'precionetodeventa'];
                const normalizedFileHeaders = new Set(
                    Object.keys(rows[0] || {}).map(normalizeHeader)
                );
                const hasSkuHeader = expectedSkuHeaders.some((h) => normalizedFileHeaders.has(h));
                const hasPriceHeader = expectedPriceHeaders.some((h) => normalizedFileHeaders.has(h));

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
                const { data, error } = await supabase.rpc('replace_inventory_pricing_import', {
                    p_items: pricingItems
                });
                if (error) throw error;

                const catalogOnlyCount = Number(data?.catalog_only_count || 0);
                const catalogOnlyMsg = catalogOnlyCount > 0
                    ? ` ${catalogOnlyCount} SKU quedaron guardados solo en la lista de precios porque hoy no están en stock.`
                    : '';
                alert(`Importador de precios completado. ${data?.stored_count || 0} SKU guardados en la lista permanente y ${data?.synced_inventory_count || 0} SKU sincronizados con el stock actual.${catalogOnlyMsg}`);
            }

            fetchInventory();
        } catch (error: any) {
            console.error('Import Error:', error);
            alert(`Error al importar: ${error.message}`);
        } finally {
            setIsImporting(false);
            setImportType(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCreateProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canManageInventory) {
            alert('No tienes permisos para crear productos.');
            return;
        }
        if (!newProduct.sku || !newProduct.name) {
            alert("SKU y Nombre son obligatorios");
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                ...newProduct,
                sku: normalizeSku(newProduct.sku),
                name: String(newProduct.name || '').trim(),
                price: Math.max(0, Number(newProduct.price || 0)),
                stock_qty: Math.max(0, Math.trunc(Number(newProduct.stock_qty || 0))),
                category: String(newProduct.category || 'General').trim() || 'General'
            };

            const { error } = await supabase
                .from('inventory')
                .insert([payload]);

            if (error) throw error;

            alert("Producto creado exitosamente");
            setShowNewProductModal(false);
            setNewProduct({
                sku: '',
                name: '',
                price: 0,
                stock_qty: 0,
                category: 'General'
            });
            fetchInventory();
        } catch (error: any) {
            console.error("Error creating product:", error);
            alert(`Error al crear producto: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    const startPriceEdit = (item: InventoryItem) => {
        setEditingStockId(null);
        setEditingStockValue('');
        setSavingStockId(null);
        setEditingPriceId(item.id);
        setEditingPriceValue(String(Math.max(0, Number(item.price || 0))));
    };

    const cancelPriceEdit = () => {
        setEditingPriceId(null);
        setEditingPriceValue('');
        setSavingPriceId(null);
    };

    const startStockEdit = (item: InventoryItem) => {
        setEditingPriceId(null);
        setEditingPriceValue('');
        setSavingPriceId(null);
        setEditingStockId(item.id);
        setEditingStockValue(String(Math.max(0, Math.trunc(Number(item.stock_qty || 0)))));
    };

    const cancelStockEdit = () => {
        setEditingStockId(null);
        setEditingStockValue('');
        setSavingStockId(null);
    };

    const saveManualPrice = async (item: InventoryItem) => {
        if (!canManageInventory) return;

        const nextPrice = Math.max(0, Number(editingPriceValue || 0));
        if (!Number.isFinite(nextPrice)) {
            alert('Debes ingresar un precio válido.');
            return;
        }

        setSavingPriceId(item.id);
        try {
            const { error } = await supabase
                .from('inventory')
                .update({ price: nextPrice })
                .eq('id', item.id);

            if (error) throw error;

            setItems((prev) => prev.map((row) => (
                row.id === item.id
                    ? { ...row, price: nextPrice }
                    : row
            )));
            cancelPriceEdit();
            alert('Precio actualizado y guardado en la lista permanente.');
        } catch (error: any) {
            console.error('Error updating inventory price:', error);
            alert(`No se pudo actualizar el precio: ${error.message}`);
            setSavingPriceId(null);
        }
    };

    const saveManualStock = async (item: InventoryItem) => {
        if (!canManageInventory) return;

        const parsedStock = Number(editingStockValue || 0);
        const nextStock = Math.max(0, Math.trunc(parsedStock));
        if (!Number.isFinite(parsedStock)) {
            alert('Debes ingresar un stock válido.');
            return;
        }

        setSavingStockId(item.id);
        try {
            const { error } = await supabase
                .from('inventory')
                .update({ stock_qty: nextStock })
                .eq('id', item.id);

            if (error) throw error;

            setItems((prev) => prev.map((row) => (
                row.id === item.id
                    ? { ...row, stock_qty: nextStock }
                    : row
            )));
            cancelStockEdit();
            alert('Stock actualizado manualmente.');
        } catch (error: any) {
            console.error('Error updating inventory stock:', error);
            alert(`No se pudo actualizar el stock: ${error.message}`);
            setSavingStockId(null);
        }
    };

    const filteredItems = items.filter(i =>
        (i.name?.toLowerCase() || '').includes(search.toLowerCase()) ||
        (i.sku?.toLowerCase() || '').includes(search.toLowerCase())
    );

    const lowStockCount = items.filter(i => (i.stock_qty || 0) < 5).length;
    const totalUnits = items.reduce((acc, i) => acc + (i.stock_qty || 0), 0);

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv,.xlsx,.xls"
                className="hidden"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="premium-card p-6 border-l-4 border-l-indigo-500">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Total SKU</p>
                            <h3 className="text-3xl font-black text-gray-900">{items.length}</h3>
                        </div>
                        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                            <Package size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card p-6 border-l-4 border-l-amber-500">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Alertas Stock Bajo</p>
                            <h3 className="text-3xl font-black text-gray-900">{lowStockCount}</h3>
                        </div>
                        <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                            <AlertTriangle size={24} />
                        </div>
                    </div>
                </div>
                <div className="premium-card p-6 border-l-4 border-l-emerald-500">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{isSellerReadOnly ? 'Unidades Totales' : 'Valor Inventario'}</p>
                            <h3 className="text-3xl font-black text-gray-900">{isSellerReadOnly ? `${totalUnits.toLocaleString()} uds` : `$${items.reduce((acc, i) => acc + (i.price || 0) * (i.stock_qty || 0), 0).toLocaleString()}`}</h3>
                        </div>
                        <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                            <TrendingUp size={24} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <div className="relative w-full md:max-w-4xl">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Buscar por SKU o Nombre de producto..."
                        className="w-full min-h-[64px] pl-14 pr-5 py-4 bg-white border border-transparent rounded-[1.75rem] shadow-sm text-base font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {canDownloadCatalog && (
                        <button
                            onClick={downloadProductCatalog}
                            disabled={loading}
                            className="flex items-center px-6 py-4 bg-white rounded-2xl border border-gray-100 text-slate-700 font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
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
                            className="flex items-center px-6 py-4 bg-white rounded-2xl border border-gray-100 text-indigo-600 font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
                        >
                            {isImporting && importType === 'stock' ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-indigo-600 border-t-transparent mr-2"></div>
                            ) : (
                                <FileSpreadsheet size={18} className="mr-2" />
                            )}
                            Importar SKU + Nombre + Cantidad
                        </button>
                        <button
                            onClick={downloadStockTemplate}
                            disabled={isImporting}
                            className="flex items-center px-6 py-4 bg-white rounded-2xl border border-gray-100 text-slate-700 font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
                        >
                            <Download size={18} className="mr-2" />
                            Plantilla Stock
                        </button>
                        <button
                            onClick={() => handleImportClick('pricing')}
                            disabled={isImporting}
                            className="flex items-center px-6 py-4 bg-white rounded-2xl border border-gray-100 text-teal-600 font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
                        >
                            {isImporting && importType === 'pricing' ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-teal-600 border-t-transparent mr-2"></div>
                            ) : (
                                <TrendingUp size={18} className="mr-2" />
                            )}
                            Importar SKU + Precio Neto
                        </button>
                        <button
                            onClick={downloadPricingTemplate}
                            disabled={isImporting}
                            className="flex items-center px-6 py-4 bg-white rounded-2xl border border-gray-100 text-slate-700 font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
                        >
                            <Download size={18} className="mr-2" />
                            Plantilla Precios
                        </button>
                        <button
                            onClick={() => setShowNewProductModal(true)}
                            className="bg-indigo-600 text-white px-6 py-4 rounded-2xl font-bold flex items-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all"
                        >
                            <Plus size={18} className="mr-2" />
                            Nuevo Producto
                        </button>
                        </>
                    )}
                    {!canUploadInventory && canRequestProducts && (
                        <button
                            onClick={() => navigate('/procurement', { state: { activeTab: 'requests' } })}
                            className="flex items-center px-6 py-4 bg-white rounded-2xl border border-gray-100 text-indigo-600 font-bold hover:bg-gray-50 transition-all shadow-sm"
                        >
                            <ClipboardList size={18} className="mr-2" />
                            Ver Solicitudes de Compra
                        </button>
                    )}
                </div>
            </div>

            <div>
                <h2 className="text-3xl font-extrabold text-gray-900 mb-1">Gestión de Inventario</h2>
                <p className="text-gray-400 font-medium">{isSellerReadOnly ? 'Consulta de stock disponible por producto' : 'Control de stock y precios de venta'}</p>
            </div>

            {loading ? (
                <div className="space-y-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="premium-card h-20 animate-pulse bg-gray-50/50"></div>
                    ))}
                </div>
            ) : (
                <div className="premium-card overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50/50">
                            <tr>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Producto</th>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">SKU</th>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Stock</th>
                                {!isSellerReadOnly && <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Precio</th>}
                                {canShowActions && <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Acciones</th>}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredItems.map((item) => (
                                <tr key={item.id} className="hover:bg-gray-50/30 transition-colors group">
                                    <td className="px-6 py-5">
                                        <div className="flex items-center space-x-4">
                                            <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100">
                                                <Package size={18} className="text-gray-300" />
                                            </div>
                                            <div>
                                                <p className="text-sm font-bold text-gray-900">{item.name}</p>
                                                <p className="text-[10px] text-gray-400 font-medium uppercase">{item.category || 'General'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-center text-sm font-mono text-gray-500">
                                        {item.sku || '---'}
                                    </td>
                                    <td className="px-6 py-5 text-center">
                                        {canManageInventory && editingStockId === item.id ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    className="w-24 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-center text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                                    value={editingStockValue}
                                                    onChange={(e) => setEditingStockValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            void saveManualStock(item);
                                                        }
                                                        if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            cancelStockEdit();
                                                        }
                                                    }}
                                                    autoFocus
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => void saveManualStock(item)}
                                                    disabled={savingStockId === item.id}
                                                    className="rounded-lg bg-emerald-50 p-2 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                                                    title="Guardar stock"
                                                >
                                                    <Check size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={cancelStockEdit}
                                                    disabled={savingStockId === item.id}
                                                    className="rounded-lg bg-gray-100 p-2 text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-50"
                                                    title="Cancelar edición"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center gap-2">
                                                <span className={`px-3 py-1 rounded-full text-xs font-bold border ${(item.stock_qty || 0) < 5 ? 'bg-orange-50 text-orange-600 border-orange-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                                                    {item.stock_qty} uds
                                                </span>
                                                {canManageInventory && (
                                                    <button
                                                        type="button"
                                                        onClick={() => startStockEdit(item)}
                                                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                                                        title="Editar stock manualmente"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                    {!isSellerReadOnly && (
                                        <td className="px-6 py-5 text-center text-sm font-bold text-gray-900">
                                            {canManageInventory && editingPriceId === item.id ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        className="w-28 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-sm font-bold text-center text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500"
                                                        value={editingPriceValue}
                                                        onChange={(e) => setEditingPriceValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                void saveManualPrice(item);
                                                            }
                                                            if (e.key === 'Escape') {
                                                                e.preventDefault();
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
                                                    {canManageInventory && (
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
                                    {canShowActions && (
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex justify-end gap-2">
                                                {canManageInventory && (
                                                    <button
                                                        onClick={() => fetchHistory(item)}
                                                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                                        title="Ver Historial"
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

            {/* History Modal */}
            {selectedHistoryItem && (
                <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 flex flex-col max-h-[80vh]">
                        <div className="p-6 bg-gray-900 text-white flex justify-between items-center">
                            <div>
                                <h3 className="font-bold text-lg">Historial de Movimientos</h3>
                                <p className="text-gray-400 text-xs font-mono mt-1">{selectedHistoryItem.sku} - {selectedHistoryItem.name}</p>
                            </div>
                            <button onClick={() => setSelectedHistoryItem(null)} className="p-2 hover:bg-white/20 rounded-full transition-all">
                                <History size={20} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto">
                            {loadingHistory ? (
                                <div className="space-y-3">
                                    {[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-50 rounded-xl animate-pulse"></div>)}
                                </div>
                            ) : historyData.length === 0 ? (
                                <div className="text-center py-10 text-gray-400">
                                    <Package size={48} className="mx-auto mb-3 opacity-20" />
                                    <p className="font-medium">No hay movimientos registrados para este producto.</p>
                                </div>
                            ) : (
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="pb-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha</th>
                                            <th className="pb-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Tipo</th>
                                            <th className="pb-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Folio Cotización</th>
                                            <th className="pb-3 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Cantidad</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {historyData.map((record: any, idx) => (
                                            <tr key={idx} className="group hover:bg-gray-50 transition-colors">
                                                <td className="py-4 text-xs font-bold text-gray-700">
                                                    {new Date(record.created_at).toLocaleDateString()} <span className="text-gray-400 text-[10px] font-medium ml-1">{new Date(record.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                </td>
                                                <td className="py-4">
                                                    <span className="px-2 py-1 rounded-md bg-red-50 text-red-600 text-[10px] font-bold uppercase tracking-wide border border-red-100">
                                                        Venta
                                                    </span>
                                                </td>
                                                <td className="py-4 text-center">
                                                    <span className="font-mono text-xs text-indigo-600 font-bold">
                                                        #{record.orders?.quotations?.folio || 'N/A'}
                                                    </span>
                                                </td>
                                                <td className="py-4 text-right">
                                                    <span className="font-bold text-red-600">
                                                        -{record.quantity}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* New Product Modal */}
            {showNewProductModal && canManageInventory && (
                <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                        <div className="p-6 bg-indigo-600 text-white flex justify-between items-center">
                            <h3 className="font-bold text-lg">Nuevo Producto</h3>
                            <button onClick={() => setShowNewProductModal(false)} className="p-2 hover:bg-white/20 rounded-full transition-all">
                                <Plus size={20} className="rotate-45" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateProduct} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Código SKU</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={newProduct.sku}
                                    onChange={e => setNewProduct({ ...newProduct, sku: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre del Producto</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={newProduct.name}
                                    onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Precio Neto</label>
                                    <input
                                        type="number"
                                        required
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={newProduct.price}
                                        onChange={e => setNewProduct({ ...newProduct, price: parseFloat(e.target.value) })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Stock Inicial</label>
                                    <input
                                        type="number"
                                        required
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={newProduct.stock_qty}
                                        onChange={e => setNewProduct({ ...newProduct, stock_qty: parseInt(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Categoría</label>
                                <select
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={newProduct.category}
                                    onChange={e => setNewProduct({ ...newProduct, category: e.target.value })}
                                >
                                    <option value="General">General</option>
                                    <option value="Insumos">Insumos</option>
                                    <option value="Equipos">Equipos</option>
                                    <option value="Repuestos">Repuestos</option>
                                </select>
                            </div>
                            <div className="pt-4">
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                                >
                                    {isSaving ? "Guardando..." : "Crear Producto"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Inventory;
