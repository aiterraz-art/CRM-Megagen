import { createPortal } from 'react-dom';
import { AlertCircle, Download, FileText, Loader2, RefreshCw, X } from 'lucide-react';

type OrderPdfPreviewModalProps = {
    isOpen: boolean;
    orderFolio: number | null;
    clientName: string;
    fileName?: string | null;
    blobUrl: string | null;
    loading: boolean;
    error: string | null;
    canDownload: boolean;
    onClose: () => void;
    onRetry: () => void;
    onDownload: () => void;
};

const OrderPdfPreviewModal = ({
    isOpen,
    orderFolio,
    clientName,
    fileName,
    blobUrl,
    loading,
    error,
    canDownload,
    onClose,
    onRetry,
    onDownload
}: OrderPdfPreviewModalProps) => {
    if (!isOpen) return null;

    const modalContent = (
        <div className="fixed inset-0 z-[260] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
            <div className="w-full max-w-6xl max-h-[92vh] rounded-[2rem] bg-white shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-6 md:py-5 border-b border-gray-100">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">PDF del pedido</p>
                        <h3 className="text-xl md:text-2xl font-black text-gray-900 mt-1">Pedido #{orderFolio ?? '-'}</h3>
                        <p className="text-sm font-medium text-gray-500 mt-1 truncate">{clientName}</p>
                        {fileName ? <p className="text-xs font-bold text-gray-400 mt-2 truncate">{fileName}</p> : null}
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors shrink-0">
                        <X size={22} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 bg-gray-50 p-4 md:p-6 overflow-auto">
                    {loading ? (
                        <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-gray-500">
                            <Loader2 size={34} className="animate-spin text-indigo-600 mb-4" />
                            <p className="text-sm font-bold">Generando PDF del pedido...</p>
                        </div>
                    ) : error ? (
                        <div className="h-full min-h-[320px] flex items-center justify-center">
                            <div className="max-w-md w-full rounded-[1.5rem] border border-red-100 bg-white p-6 text-center shadow-sm">
                                <AlertCircle size={28} className="mx-auto text-red-500 mb-3" />
                                <h4 className="text-base font-black text-gray-900">No se pudo generar el PDF</h4>
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
                    ) : blobUrl ? (
                        <div className="h-full min-h-[65vh] rounded-[1.5rem] border border-gray-200 bg-white overflow-hidden shadow-sm">
                            <iframe
                                src={blobUrl}
                                title={`PDF pedido ${orderFolio ?? ''}`}
                                className="w-full h-[65vh] md:h-[72vh]"
                            />
                        </div>
                    ) : (
                        <div className="h-full min-h-[320px] flex items-center justify-center">
                            <div className="max-w-md w-full rounded-[1.5rem] border border-gray-200 bg-white p-6 text-center shadow-sm">
                                <FileText size={28} className="mx-auto text-gray-400 mb-3" />
                                <h4 className="text-base font-black text-gray-900">Sin PDF disponible</h4>
                                <p className="text-sm text-gray-500 font-medium mt-2">No se pudo preparar el PDF del pedido para mostrarlo.</p>
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
                    <button
                        onClick={onDownload}
                        disabled={!canDownload}
                        className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={16} className="mr-2" />
                        Descargar
                    </button>
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return modalContent;
    return createPortal(modalContent, document.body);
};

export default OrderPdfPreviewModal;
