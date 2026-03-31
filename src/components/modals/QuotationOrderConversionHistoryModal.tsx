import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Clock3, X } from 'lucide-react';
import { Database } from '../../types/supabase';

type ConversionLogRow = Database['public']['Tables']['quotation_order_conversion_logs']['Row'];

type QuotationOrderConversionHistoryModalProps = {
    isOpen: boolean;
    quotationFolio: number | null;
    clientName: string;
    logs: ConversionLogRow[];
    loading: boolean;
    error: string | null;
    onClose: () => void;
};

const stageLabels: Record<string, string> = {
    started: 'Inicio',
    payment_proof_upload: 'Comprobante',
    order_creation: 'Creación pedido',
    notification: 'Correo facturación',
    cleanup: 'Limpieza',
    completed: 'Resultado final',
};

const statusStyles: Record<string, string> = {
    success: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    info: 'bg-blue-100 text-blue-700',
};

const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(value));

const getAttemptSummary = (attemptLogs: ConversionLogRow[]) => {
    if (attemptLogs.some((log) => log.status === 'failed')) {
        return {
            label: 'Falló',
            icon: <AlertTriangle size={16} />,
            className: 'bg-red-100 text-red-700',
        };
    }

    if (attemptLogs.some((log) => log.stage === 'completed' && log.status === 'success')) {
        return {
            label: 'Completado',
            icon: <CheckCircle2 size={16} />,
            className: 'bg-emerald-100 text-emerald-700',
        };
    }

    return {
        label: 'En proceso',
        icon: <Clock3 size={16} />,
        className: 'bg-blue-100 text-blue-700',
    };
};

const QuotationOrderConversionHistoryModal = ({
    isOpen,
    quotationFolio,
    clientName,
    logs,
    loading,
    error,
    onClose,
}: QuotationOrderConversionHistoryModalProps) => {
    if (!isOpen) return null;

    const groupedAttempts = Array.from(
        logs.reduce((acc, log) => {
            const current = acc.get(log.attempt_id) || [];
            current.push(log);
            acc.set(log.attempt_id, current);
            return acc;
        }, new Map<string, ConversionLogRow[]>()),
    ).map(([attemptId, attemptLogs]) => ({
        attemptId,
        logs: [...attemptLogs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    })).sort((a, b) =>
        new Date(b.logs[b.logs.length - 1]?.created_at || 0).getTime()
        - new Date(a.logs[a.logs.length - 1]?.created_at || 0).getTime(),
    );

    const modalContent = (
        <div className="fixed inset-0 z-[275] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
            <div className="w-full max-w-5xl max-h-[92vh] rounded-[2rem] bg-white shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-6 md:py-5 border-b border-gray-100">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Trazabilidad de conversión</p>
                        <h3 className="text-xl md:text-2xl font-black text-gray-900 mt-1">Cotización #{quotationFolio ?? '-'}</h3>
                        <p className="text-sm font-medium text-gray-500 mt-1 truncate">{clientName}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors shrink-0">
                        <X size={22} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-auto bg-gray-50 p-4 md:p-6">
                    {loading ? (
                        <div className="rounded-[1.5rem] border border-gray-200 bg-white p-6 text-center text-sm font-bold text-gray-500">
                            Cargando historial...
                        </div>
                    ) : error ? (
                        <div className="rounded-[1.5rem] border border-red-200 bg-red-50 p-6 text-center text-sm font-bold text-red-700">
                            {error}
                        </div>
                    ) : groupedAttempts.length === 0 ? (
                        <div className="rounded-[1.5rem] border border-gray-200 bg-white p-6 text-center text-sm font-bold text-gray-500">
                            Esta cotización aún no tiene intentos registrados de conversión a pedido.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {groupedAttempts.map((attempt) => {
                                const summary = getAttemptSummary(attempt.logs);
                                const lastLog = attempt.logs[attempt.logs.length - 1];

                                return (
                                    <div key={attempt.attemptId} className="rounded-[1.5rem] border border-gray-200 bg-white p-5 shadow-sm space-y-4">
                                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-gray-900">Intento {attempt.attemptId.slice(0, 8)}</p>
                                                <p className="text-xs font-medium text-gray-500">
                                                    Último evento: {lastLog ? formatDateTime(lastLog.created_at) : '-'}
                                                </p>
                                            </div>
                                            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${summary.className}`}>
                                                {summary.icon}
                                                {summary.label}
                                            </span>
                                        </div>

                                        <div className="space-y-3">
                                            {attempt.logs.map((log) => (
                                                <div key={log.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-black text-gray-900">{stageLabels[log.stage] || log.stage}</p>
                                                            <p className="text-xs font-medium text-gray-500">{formatDateTime(log.created_at)}</p>
                                                        </div>
                                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${statusStyles[log.status] || 'bg-gray-100 text-gray-700'}`}>
                                                            {log.status}
                                                        </span>
                                                    </div>
                                                    {log.message && (
                                                        <p className={`mt-2 text-sm font-medium ${log.status === 'failed' ? 'text-red-700' : 'text-gray-700'}`}>
                                                            {log.message}
                                                        </p>
                                                    )}
                                                    {log.order_id && (
                                                        <p className="mt-2 text-[11px] font-mono text-gray-500 break-all">
                                                            order_id: {log.order_id}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return modalContent;
    return createPortal(modalContent, document.body);
};

export default QuotationOrderConversionHistoryModal;
