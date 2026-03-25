import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Loader2, Package2, RefreshCw, X } from 'lucide-react';

export type OrderItemsPreviewItem = {
    sku: string;
    productName: string;
    quantity: number;
    value: number;
};

type OrderItemsPreviewModalProps = {
    isOpen: boolean;
    orderFolio: number | null;
    clientName: string;
    items: OrderItemsPreviewItem[];
    loading: boolean;
    error: string | null;
    onClose: () => void;
    onRetry: () => void;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

const copyText = async (text: string) => {
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
};

const OrderItemsPreviewModal = ({
    isOpen,
    orderFolio,
    clientName,
    items,
    loading,
    error,
    onClose,
    onRetry
}: OrderItemsPreviewModalProps) => {
    const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);

    useEffect(() => {
        if (!copiedFeedback) return;
        const timeoutId = window.setTimeout(() => setCopiedFeedback(null), 1600);
        return () => window.clearTimeout(timeoutId);
    }, [copiedFeedback]);

    useEffect(() => {
        if (!isOpen) {
            setCopiedFeedback(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleCopy = async (value: string, label: string) => {
        try {
            await copyText(value);
            setCopiedFeedback(`${label} copiado`);
        } catch (copyError) {
            console.error('Error copying order item value:', copyError);
            setCopiedFeedback(`No se pudo copiar ${label.toLowerCase()}`);
        }
    };

    const modalContent = (
        <div className="fixed inset-0 z-[260] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
            <div className="w-full max-w-5xl max-h-[92vh] rounded-[2rem] bg-white shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-6 md:py-5 border-b border-gray-100">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Detalle del pedido</p>
                        <h3 className="text-xl md:text-2xl font-black text-gray-900 mt-1">Pedido #{orderFolio ?? '-'}</h3>
                        <p className="text-sm font-medium text-gray-500 mt-1 truncate">{clientName}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        {copiedFeedback ? (
                            <div className="hidden md:inline-flex items-center rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                                <CheckCircle2 size={14} className="mr-2" />
                                {copiedFeedback}
                            </div>
                        ) : null}
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors shrink-0">
                            <X size={22} />
                        </button>
                    </div>
                </div>

                {copiedFeedback ? (
                    <div className="md:hidden px-5 pt-4">
                        <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                            <CheckCircle2 size={14} className="mr-2" />
                            {copiedFeedback}
                        </div>
                    </div>
                ) : null}

                <div className="flex-1 min-h-0 bg-gray-50 p-4 md:p-6 overflow-auto">
                    {loading ? (
                        <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-gray-500">
                            <Loader2 size={34} className="animate-spin text-indigo-600 mb-4" />
                            <p className="text-sm font-bold">Cargando detalle del pedido...</p>
                        </div>
                    ) : error ? (
                        <div className="h-full min-h-[320px] flex items-center justify-center">
                            <div className="max-w-md w-full rounded-[1.5rem] border border-red-100 bg-white p-6 text-center shadow-sm">
                                <AlertCircle size={28} className="mx-auto text-red-500 mb-3" />
                                <h4 className="text-base font-black text-gray-900">No se pudo cargar el detalle</h4>
                                <p className="text-sm text-red-600 font-medium mt-2">{error}</p>
                                <button
                                    onClick={onRetry}
                                    className="mt-5 inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700 transition-colors"
                                >
                                    <RefreshCw size={16} className="mr-2" />
                                    Reintentar
                                </button>
                            </div>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="h-full min-h-[320px] flex items-center justify-center">
                            <div className="max-w-md w-full rounded-[1.5rem] border border-gray-200 bg-white p-6 text-center shadow-sm">
                                <Package2 size={28} className="mx-auto text-gray-400 mb-3" />
                                <h4 className="text-base font-black text-gray-900">Pedido sin ítems</h4>
                                <p className="text-sm text-gray-500 font-medium mt-2">No se encontraron productos cargados para este pedido.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-[1.5rem] border border-gray-200 bg-white overflow-hidden shadow-sm">
                            <div className="hidden md:grid grid-cols-[1.2fr_3fr_1fr_1.2fr] gap-0 border-b border-gray-100 bg-gray-50 px-5 py-4">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">SKU</p>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Producto</p>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Cantidad</p>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">Valor</p>
                            </div>

                            <div className="divide-y divide-gray-100">
                                {items.map((item, index) => {
                                    const skuText = item.sku || '-';
                                    const productText = item.productName || 'Producto';
                                    const quantityText = Number(item.quantity || 0).toLocaleString('es-CL');
                                    const valueText = formatMoney(item.value);

                                    return (
                                        <div
                                            key={`${item.sku}-${item.productName}-${index}`}
                                            className="grid grid-cols-1 md:grid-cols-[1.2fr_3fr_1fr_1.2fr] gap-3 md:gap-0 px-4 py-4 md:px-5 md:py-4"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => void handleCopy(skuText, 'SKU')}
                                                className="group rounded-xl border border-gray-200 px-3 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-all"
                                            >
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">SKU</p>
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-sm font-black text-gray-900 break-all">{skuText}</span>
                                                    <Copy size={14} className="text-gray-300 group-hover:text-indigo-500" />
                                                </div>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => void handleCopy(productText, 'Producto')}
                                                className="group rounded-xl border border-gray-200 px-3 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-all md:mx-3"
                                            >
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">Producto</p>
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-sm font-bold text-gray-900">{productText}</span>
                                                    <Copy size={14} className="text-gray-300 group-hover:text-indigo-500 shrink-0" />
                                                </div>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => void handleCopy(quantityText, 'Cantidad')}
                                                className="group rounded-xl border border-gray-200 px-3 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-all md:mr-3"
                                            >
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">Cantidad</p>
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-sm font-black text-gray-900">{quantityText}</span>
                                                    <Copy size={14} className="text-gray-300 group-hover:text-indigo-500" />
                                                </div>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => void handleCopy(valueText, 'Valor')}
                                                className="group rounded-xl border border-gray-200 px-3 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50 transition-all"
                                            >
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">Valor</p>
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="text-sm font-black text-gray-900 md:ml-auto">{valueText}</span>
                                                    <Copy size={14} className="text-gray-300 group-hover:text-indigo-500" />
                                                </div>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-3 px-5 py-4 md:px-6 border-t border-gray-100 bg-white">
                    <button
                        onClick={onClose}
                        className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-black text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return modalContent;
    return createPortal(modalContent, document.body);
};

export default OrderItemsPreviewModal;
