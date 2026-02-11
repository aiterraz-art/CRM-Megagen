import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Search, Filter, Package, Plus, AlertTriangle, TrendingUp, History, ChevronRight, FileSpreadsheet, MoreVertical } from 'lucide-react';
import { Database } from '../types/supabase';
import Papa from 'papaparse';

type InventoryItem = Database['public']['Tables']['inventory']['Row'] & { sku?: string | null };

const Inventory = () => {
    const { isSupervisor, hasPermission } = useUser();
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [isImporting, setIsImporting] = useState(false);
    const [importType, setImportType] = useState<'inventory' | 'pricing' | null>(null);
    const [showNewProductModal, setShowNewProductModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [newProduct, setNewProduct] = useState({
        sku: '',
        name: '',
        price: 0,
        stock_qty: 0,
        category: 'General'
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchInventory = async () => {
        setLoading(true);
        const { data } = await (supabase.from('inventory') as any).select('*').order('name');
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

    const handleImportClick = (type: 'inventory' | 'pricing') => {
        setImportType(type);
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !importType) return;

        setIsImporting(true);

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const csvData = results.data as any[];

                try {
                    const getValue = (row: any, keywords: string[]) => {
                        const keys = Object.keys(row);
                        const foundKey = keys.find(k =>
                            keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase()))
                        );
                        return foundKey ? row[foundKey] : null;
                    };

                    if (importType === 'inventory') {
                        const newItems = csvData.map(row => ({
                            sku: (getValue(row, ['digo', 'SKU']) || '').toString().trim(),
                            name: (getValue(row, ['descrip', 'Nombre', 'Name', 'Detail']) || '').toString().trim(),
                            stock_qty: parseInt(getValue(row, ['Saldo', 'Stock', 'Cantidad']) || '0') || 0,
                            category: (getValue(row, ['Categoria', 'Categoría', 'Category']) || 'General').toString().trim(),
                            price: parseFloat(getValue(row, ['Precio', 'Price', 'Neto', 'Valor', 'P.Unit']) || '0')
                        })).filter(item => item.name && item.sku);

                        if (newItems.length === 0) {
                            throw new Error('No se encontraron columnas de SKU y Nombre. Asegúrese de que el archivo tenga las columnas correspondientes (Código, Descripción, Saldo).');
                        }

                        const { error: deleteError } = await (supabase.from('inventory') as any).delete().neq('id', '00000000-0000-0000-0000-000000000000');
                        if (deleteError) throw deleteError;

                        const { error: insertError } = await (supabase.from('inventory') as any).insert(newItems);
                        if (insertError) throw insertError;

                        alert(`¡Inventario actualizado! ${newItems.length} productos cargados.`);
                    } else if (importType === 'pricing') {
                        const priceUpdates = csvData.map(row => ({
                            sku: (getValue(row, ['digo', 'SKU']) || '').toString().trim(),
                            price: parseFloat(getValue(row, ['Precio neto', 'Precio Neto', 'Neto', 'PRECIO NETO', 'Price']) || '0')
                        })).filter(p => p.sku && p.price > 0);

                        if (priceUpdates.length === 0) {
                            throw new Error('No se encontraron datos de precios válidos. Asegúrese de que el archivo tenga columnas de SKU y Precio Neto.');
                        }

                        let successCount = 0;
                        for (const update of priceUpdates) {
                            const { error } = await (supabase.from('inventory') as any)
                                .update({ price: update.price })
                                .eq('sku', update.sku);
                            if (!error) successCount++;
                        }

                        alert(`¡Lista de precios actualizada! Se actualizaron ${successCount} de ${priceUpdates.length} productos.`);
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
            },
            error: (error) => {
                console.error('CSV Parsing Error:', error);
                alert('Error al leer el archivo CSV.');
                setIsImporting(false);
            }
        });
    };

    const handleCreateProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProduct.sku || !newProduct.name) {
            alert("SKU y Nombre son obligatorios");
            return;
        }

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('inventory')
                .insert([newProduct]);

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

    const filteredItems = items.filter(i =>
        (i.name?.toLowerCase() || '').includes(search.toLowerCase()) ||
        (i.sku?.toLowerCase() || '').includes(search.toLowerCase())
    );

    const lowStockCount = items.filter(i => (i.stock_qty || 0) < 5).length;

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".csv"
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
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Valor Inventario</p>
                            <h3 className="text-3xl font-black text-gray-900">${items.reduce((acc, i) => acc + (i.price || 0) * (i.stock_qty || 0), 0).toLocaleString()}</h3>
                        </div>
                        <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                            <TrendingUp size={24} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-xl">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por SKU o Nombre de producto..."
                        className="w-full pl-12 pr-4 py-4 bg-white border border-transparent rounded-2xl shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                {hasPermission('UPLOAD_EXCEL') && (
                    <div className="flex items-center space-x-3">
                        <button
                            onClick={() => handleImportClick('inventory')}
                            disabled={isImporting}
                            className="flex items-center px-6 py-4 bg-white rounded-2xl border border-gray-100 text-indigo-600 font-bold hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50"
                        >
                            {isImporting && importType === 'inventory' ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-indigo-600 border-t-transparent mr-2"></div>
                            ) : (
                                <FileSpreadsheet size={18} className="mr-2" />
                            )}
                            Importar Inventario
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
                            Cargar Lista Precios
                        </button>
                        <button
                            onClick={() => setShowNewProductModal(true)}
                            className="bg-indigo-600 text-white px-6 py-4 rounded-2xl font-bold flex items-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all"
                        >
                            <Plus size={18} className="mr-2" />
                            Nuevo Producto
                        </button>
                    </div>
                )}
            </div>

            <div>
                <h2 className="text-3xl font-extrabold text-gray-900 mb-1">Gestión de Inventario</h2>
                <p className="text-gray-400 font-medium">Control de stock y precios de venta</p>
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
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Precio</th>
                                {hasPermission('MANAGE_INVENTORY') && <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Acciones</th>}
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
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold border ${(item.stock_qty || 0) < 5 ? 'bg-orange-50 text-orange-600 border-orange-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                                            {item.stock_qty} uds
                                        </span>
                                    </td>
                                    <td className="px-6 py-5 text-center text-sm font-bold text-gray-900">
                                        ${item.price?.toLocaleString()}
                                    </td>
                                    {hasPermission('MANAGE_INVENTORY') && (
                                        <td className="px-6 py-5 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => fetchHistory(item)}
                                                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                                    title="Ver Historial"
                                                >
                                                    <History size={18} />
                                                </button>
                                                <button className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
                                                    <ChevronRight size={18} />
                                                </button>
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
            {showNewProductModal && (
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
