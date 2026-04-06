import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Package, Plus, Search, Trash2, User, X } from 'lucide-react';
import { Database } from '../../types/supabase';
import { SizeChangeFormDraft } from '../../utils/sizeChangeModalDraft';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type InventoryRow = Database['public']['Tables']['inventory']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type SizeChangeRequestFormProps = {
    isOpen: boolean;
    mode: 'create' | 'edit';
    submitting: boolean;
    clients: ClientRow[];
    inventory: InventoryRow[];
    sellerOptions: ProfileRow[];
    currentUserProfile: ProfileRow | null;
    effectiveRole: string | null;
    initialRequest?: {
        clientId: string;
        sellerId: string;
        requestComment: string;
        items: Array<{
            productId: string;
            sku: string;
            productName: string;
            qty: number;
            unitPrice: number;
        }>;
    } | null;
    initialDraftState?: SizeChangeFormDraft | null;
    onDraftChange?: (draft: SizeChangeFormDraft) => void;
    onClose: () => void;
    onSubmit: (payload: {
        clientId: string;
        sellerId: string;
        requestComment: string;
        items: Array<{
            productId: string;
            qty: number;
            unitPrice: number;
        }>;
    }) => void;
};

type FormLine = {
    localId: string;
    productId: string;
    productSearch: string;
    qty: number;
    unitPrice: number;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

const buildEmptyLine = (): FormLine => ({
    localId: crypto.randomUUID(),
    productId: '',
    productSearch: '',
    qty: 1,
    unitPrice: 0,
});

const SizeChangeRequestForm = ({
    isOpen,
    mode,
    submitting,
    clients,
    inventory,
    sellerOptions,
    currentUserProfile,
    effectiveRole,
    initialRequest,
    initialDraftState,
    onDraftChange,
    onClose,
    onSubmit,
}: SizeChangeRequestFormProps) => {
    const isAdmin = effectiveRole === 'admin';
    const hasInitializedWhileOpenRef = useRef(false);
    const [clientSearch, setClientSearch] = useState('');
    const [clientId, setClientId] = useState('');
    const [sellerId, setSellerId] = useState('');
    const [requestComment, setRequestComment] = useState('');
    const [lines, setLines] = useState<FormLine[]>([buildEmptyLine()]);
    const [error, setError] = useState<string | null>(null);
    const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false);
    const [activeProductRowId, setActiveProductRowId] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            hasInitializedWhileOpenRef.current = false;
            return;
        }

        if (hasInitializedWhileOpenRef.current) return;

        if (initialDraftState) {
            setClientId(initialDraftState.clientId || '');
            setClientSearch(initialDraftState.clientSearch || '');
            setSellerId(initialDraftState.sellerId || (isAdmin ? '' : (currentUserProfile?.id || '')));
            setRequestComment(initialDraftState.requestComment || '');
            setLines(
                initialDraftState.lines.length > 0
                    ? initialDraftState.lines.map((line) => ({
                        localId: line.localId || crypto.randomUUID(),
                        productId: line.productId || '',
                        productSearch: line.productSearch || '',
                        qty: Number(line.qty || 1),
                        unitPrice: Number(line.unitPrice || 0),
                    }))
                    : [buildEmptyLine()]
            );
        } else if (initialRequest) {
            const selectedClient = clients.find((client) => client.id === initialRequest.clientId);
            setClientId(initialRequest.clientId);
            setClientSearch(selectedClient?.name || '');
            setSellerId(initialRequest.sellerId);
            setRequestComment(initialRequest.requestComment || '');
            setLines(
                initialRequest.items.length > 0
                    ? initialRequest.items.map((item) => ({
                        localId: crypto.randomUUID(),
                        productId: item.productId,
                        productSearch: [item.sku, item.productName].filter(Boolean).join(' - '),
                        qty: Number(item.qty || 1),
                        unitPrice: Number(item.unitPrice || 0),
                    }))
                    : [buildEmptyLine()]
            );
        } else {
            setClientId('');
            setClientSearch('');
            setSellerId(isAdmin ? '' : (currentUserProfile?.id || ''));
            setRequestComment('');
            setLines([buildEmptyLine()]);
        }

        setError(null);
        setClientSuggestionsOpen(false);
        setActiveProductRowId(null);
        hasInitializedWhileOpenRef.current = true;
    }, [clients, currentUserProfile?.id, initialDraftState, initialRequest, isAdmin, isOpen]);

    useEffect(() => {
        if (!isOpen || !onDraftChange) return;
        onDraftChange({
            clientId,
            clientSearch,
            sellerId,
            requestComment,
            lines,
        });
    }, [clientId, clientSearch, isOpen, lines, onDraftChange, requestComment, sellerId]);

    const selectedClient = useMemo(
        () => clients.find((client) => client.id === clientId) || null,
        [clientId, clients]
    );

    const filteredClients = useMemo(() => {
        const term = clientSearch.trim().toLowerCase();
        if (!term) return clients.slice(0, 8);
        return clients
            .filter((client) => [client.name, client.rut, client.address, client.comuna, client.office]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .includes(term))
            .slice(0, 8);
    }, [clientSearch, clients]);

    const sellerDisplayName = useMemo(() => {
        if (!currentUserProfile) return 'Vendedor';
        return currentUserProfile.full_name?.trim() || currentUserProfile.email?.split('@')[0] || 'Vendedor';
    }, [currentUserProfile]);

    const inventoryById = useMemo(() => new Map(inventory.map((item) => [item.id, item])), [inventory]);

    const totalAmount = useMemo(
        () => lines.reduce((sum, line) => sum + (Number(line.qty || 0) * Number(line.unitPrice || 0)), 0),
        [lines]
    );

    if (!isOpen) return null;

    const handleSelectClient = (client: ClientRow) => {
        setClientId(client.id);
        setClientSearch(client.name);
        setClientSuggestionsOpen(false);
        setError(null);
    };

    const handleLineChange = (localId: string, partial: Partial<FormLine>) => {
        setLines((current) => current.map((line) => (
            line.localId === localId
                ? { ...line, ...partial }
                : line
        )));
        setError(null);
    };

    const handleSelectProduct = (localId: string, product: InventoryRow) => {
        handleLineChange(localId, {
            productId: product.id,
            productSearch: [product.sku, product.name].filter(Boolean).join(' - '),
            unitPrice: Number(product.price || 0),
        });
        setActiveProductRowId(null);
    };

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();

        const sanitizedLines = lines.map((line) => ({
            productId: line.productId,
            qty: Number(line.qty || 0),
            unitPrice: Number(line.unitPrice || 0),
        }));

        if (!clientId) {
            setError('Debes seleccionar un cliente.');
            return;
        }

        if (!sellerId) {
            setError('Debes seleccionar un vendedor responsable.');
            return;
        }

        if (sanitizedLines.length === 0) {
            setError('Debes agregar al menos un producto.');
            return;
        }

        if (sanitizedLines.some((line) => !line.productId)) {
            setError('Todos los productos deben seleccionarse desde el inventario.');
            return;
        }

        if (sanitizedLines.some((line) => line.qty <= 0)) {
            setError('La cantidad debe ser mayor a cero en todas las líneas.');
            return;
        }

        if (sanitizedLines.some((line) => line.unitPrice < 0)) {
            setError('El valor unitario no puede ser negativo.');
            return;
        }

        const duplicatedProductIds = sanitizedLines
            .map((line) => line.productId)
            .filter((productId, index, array) => array.indexOf(productId) !== index);

        if (duplicatedProductIds.length > 0) {
            setError('No puedes repetir el mismo producto en más de una línea.');
            return;
        }

        onSubmit({
            clientId,
            sellerId,
            requestComment: requestComment.trim(),
            items: sanitizedLines,
        });
    };

    const modalContent = (
        <div className="fixed inset-0 z-[280] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
            <div className="w-full max-w-6xl max-h-[92vh] rounded-[2rem] bg-white shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-6 md:py-5 border-b border-gray-100 shrink-0 bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/70">
                            {mode === 'edit' ? 'Editar solicitud' : 'Nueva solicitud'}
                        </p>
                        <h3 className="text-xl md:text-2xl font-black mt-1">Cambio de Medida</h3>
                        <p className="text-sm text-white/80 mt-1">Solicita cambios sin generar pedido ni aplicar descuentos.</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/15 transition-colors shrink-0">
                        <X size={22} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
                    <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 py-5 md:px-6 md:py-6 space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="premium-card p-5 relative">
                                <label className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Cliente</label>
                                <div className="relative mt-3">
                                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        value={clientSearch}
                                        onChange={(event) => {
                                            setClientSearch(event.target.value);
                                            setClientSuggestionsOpen(true);
                                            setClientId('');
                                            setError(null);
                                        }}
                                        onFocus={() => setClientSuggestionsOpen(true)}
                                        onBlur={() => window.setTimeout(() => setClientSuggestionsOpen(false), 180)}
                                        className="w-full rounded-2xl border border-gray-200 bg-white pl-12 pr-4 py-3 text-sm font-medium text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500"
                                        placeholder="Buscar cliente por nombre o RUT..."
                                        autoFocus
                                    />
                                    {clientSuggestionsOpen && filteredClients.length > 0 && (
                                        <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl">
                                            {filteredClients.map((client) => (
                                                <button
                                                    key={client.id}
                                                    type="button"
                                                    onClick={() => handleSelectClient(client)}
                                                    className="w-full rounded-2xl px-4 py-3 text-left transition-all hover:bg-indigo-50"
                                                >
                                                    <p className="text-sm font-black text-gray-900 uppercase">{client.name}</p>
                                                    <p className="mt-1 text-[11px] font-medium text-gray-500">
                                                        {[client.rut, client.address, client.comuna].filter(Boolean).join(' · ') || 'Sin dirección'}
                                                    </p>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                {selectedClient && (
                                    <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                                        <p className="font-black uppercase text-[10px] tracking-widest text-indigo-500">Cliente seleccionado</p>
                                        <p className="mt-1 font-bold">{selectedClient.name}</p>
                                        <p className="mt-1 text-xs font-medium text-indigo-700">
                                            {[selectedClient.rut, selectedClient.address, selectedClient.comuna].filter(Boolean).join(' · ') || 'Sin dirección registrada'}
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="premium-card p-5">
                                <label className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Vendedor responsable</label>
                                {isAdmin ? (
                                    <select
                                        value={sellerId}
                                        onChange={(event) => {
                                            setSellerId(event.target.value);
                                            setError(null);
                                        }}
                                        className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="">Selecciona un vendedor</option>
                                        {sellerOptions.map((seller) => (
                                            <option key={seller.id} value={seller.id}>
                                                {(seller.full_name || seller.email || 'Vendedor').toUpperCase()}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                                            <User size={18} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-gray-900 uppercase">{sellerDisplayName}</p>
                                            <p className="text-xs font-medium text-gray-500">Solicitud asignada automáticamente a tu usuario</p>
                                        </div>
                                    </div>
                                )}

                                <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Resumen</p>
                                    <p className="mt-2 text-2xl font-black text-gray-900">{formatMoney(totalAmount)}</p>
                                    <p className="text-xs font-medium text-gray-500 mt-1">
                                        {lines.length} línea(s) · sin crédito · sin descuentos
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="premium-card p-5 space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h4 className="text-lg font-black text-gray-900 flex items-center gap-2">
                                        <Package size={18} className="text-indigo-600" /> Productos del cambio
                                    </h4>
                                    <p className="text-sm font-medium text-gray-500 mt-1">Busca por SKU o nombre y define cantidad y valor por línea.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setLines((current) => [...current, buildEmptyLine()])}
                                    className="inline-flex items-center rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700 transition-colors"
                                >
                                    <Plus size={16} className="mr-2" />
                                    Agregar línea
                                </button>
                            </div>

                            <div className="space-y-4">
                                {lines.map((line, index) => {
                                    const selectedProduct = line.productId ? inventoryById.get(line.productId) || null : null;
                                    const term = line.productSearch.trim().toLowerCase();
                                    const suggestions = inventory
                                        .filter((product) => {
                                            if (!term) return true;
                                            return [product.sku, product.name]
                                                .filter(Boolean)
                                                .join(' ')
                                                .toLowerCase()
                                                .includes(term);
                                        })
                                        .slice(0, 8);

                                    return (
                                        <div key={line.localId} className="rounded-[1.6rem] border border-gray-200 bg-white p-4 md:p-5">
                                            <div className="grid grid-cols-1 lg:grid-cols-[2.2fr_0.8fr_1fr_auto] gap-4 items-start">
                                                <div className="relative">
                                                    <label className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Producto #{index + 1}</label>
                                                    <div className="relative mt-2">
                                                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                                        <input
                                                            type="text"
                                                            value={line.productSearch}
                                                            onChange={(event) => {
                                                                handleLineChange(line.localId, {
                                                                    productSearch: event.target.value,
                                                                    productId: '',
                                                                });
                                                                setActiveProductRowId(line.localId);
                                                            }}
                                                            onFocus={() => setActiveProductRowId(line.localId)}
                                                            onBlur={() => window.setTimeout(() => setActiveProductRowId((current) => current === line.localId ? null : current), 180)}
                                                            className="w-full rounded-2xl border border-gray-200 bg-white pl-12 pr-4 py-3 text-sm font-medium text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500"
                                                            placeholder="Buscar por SKU o nombre..."
                                                        />
                                                        {activeProductRowId === line.localId && suggestions.length > 0 && (
                                                            <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl">
                                                                {suggestions.map((product) => (
                                                                    <button
                                                                        key={product.id}
                                                                        type="button"
                                                                        onClick={() => handleSelectProduct(line.localId, product)}
                                                                        className="w-full rounded-2xl px-4 py-3 text-left transition-all hover:bg-indigo-50"
                                                                    >
                                                                        <p className="text-sm font-black text-gray-900">{product.sku || 'SIN SKU'}</p>
                                                                        <p className="mt-1 text-[11px] font-medium text-gray-500">{product.name}</p>
                                                                        <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-indigo-500">
                                                                            Precio sistema {formatMoney(Number(product.price || 0))} · Stock {Number(product.stock_qty || 0).toLocaleString('es-CL')}
                                                                        </p>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {selectedProduct && (
                                                        <p className="mt-2 text-xs font-medium text-indigo-600">
                                                            SKU {selectedProduct.sku || 'SIN SKU'} · Precio sistema {formatMoney(Number(selectedProduct.price || 0))}
                                                        </p>
                                                    )}
                                                </div>

                                                <div>
                                                    <label className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Cantidad</label>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={line.qty}
                                                        onChange={(event) => handleLineChange(line.localId, { qty: Number(event.target.value || 0) })}
                                                        className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Valor unitario</label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={1}
                                                        value={line.unitPrice}
                                                        onChange={(event) => handleLineChange(line.localId, { unitPrice: Number(event.target.value || 0) })}
                                                        className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                                    />
                                                    <p className="mt-2 text-xs font-black text-indigo-600">Total {formatMoney(Number(line.qty || 0) * Number(line.unitPrice || 0))}</p>
                                                </div>

                                                <div className="pt-6 lg:pt-7">
                                                    <button
                                                        type="button"
                                                        onClick={() => setLines((current) => current.length === 1 ? [buildEmptyLine()] : current.filter((currentLine) => currentLine.localId !== line.localId))}
                                                        className="inline-flex items-center justify-center rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-600 hover:bg-red-100 transition-colors"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="premium-card p-5">
                            <label className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Comentarios</label>
                            <textarea
                                value={requestComment}
                                onChange={(event) => {
                                    setRequestComment(event.target.value);
                                    setError(null);
                                }}
                                className="mt-3 min-h-[130px] w-full rounded-3xl border border-gray-200 bg-white px-4 py-4 text-sm font-medium text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                placeholder="Describe el motivo del cambio de medida, coordinación con cliente o cualquier observación útil para facturación."
                            />
                        </div>

                        {error && (
                            <div className="rounded-3xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
                                {error}
                            </div>
                        )}
                    </div>

                    <div className="shrink-0 border-t border-gray-100 bg-white px-5 py-4 md:px-6 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-2xl border border-gray-200 px-5 py-3 text-sm font-black text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex items-center rounded-2xl bg-side-gradient px-6 py-3 text-sm font-black text-white shadow-lg transition-all hover:opacity-95 disabled:opacity-60"
                        >
                            {submitting ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
                            {mode === 'edit' ? 'Guardar cambios' : 'Crear solicitud'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return modalContent;
    return createPortal(modalContent, document.body);
};

export default SizeChangeRequestForm;
