import { createPortal } from 'react-dom';
import { Mail, X } from 'lucide-react';
import type { OrderNotificationLog } from '../../utils/orderNotification';

type OrderNotificationHistoryModalProps = {
    isOpen: boolean;
    orderFolio: number | null;
    clientName: string;
    logs: OrderNotificationLog[];
    onClose: () => void;
};

const getStatusStyles = (status: OrderNotificationLog['status']) => {
    switch (status) {
        case 'sent':
            return 'bg-emerald-100 text-emerald-700';
        case 'failed':
            return 'bg-red-100 text-red-700';
        default:
            return 'bg-amber-100 text-amber-700';
    }
};

const getStatusLabel = (status: OrderNotificationLog['status']) => {
    switch (status) {
        case 'sent':
            return 'Enviado';
        case 'failed':
            return 'Falló';
        default:
            return 'Pendiente';
    }
};

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString('es-CL') : '-';

const OrderNotificationHistoryModal = ({ isOpen, orderFolio, clientName, logs, onClose }: OrderNotificationHistoryModalProps) => {
    if (!isOpen) return null;

    const modalContent = (
        <div className="fixed inset-0 z-[270] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
            <div className="w-full max-w-4xl max-h-[92vh] rounded-[2rem] bg-white shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-6 md:py-5 border-b border-gray-100">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Historial de envíos</p>
                        <h3 className="text-xl md:text-2xl font-black text-gray-900 mt-1">Pedido #{orderFolio ?? '-'}</h3>
                        <p className="text-sm font-medium text-gray-500 mt-1 truncate">{clientName}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors shrink-0">
                        <X size={22} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-auto bg-gray-50 p-4 md:p-6">
                    {logs.length === 0 ? (
                        <div className="rounded-[1.5rem] border border-gray-200 bg-white p-6 text-center text-sm font-bold text-gray-500">
                            Este pedido aún no tiene historial de envíos a facturación.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {logs.map((log) => (
                                <div key={log.id} className="rounded-[1.5rem] border border-gray-200 bg-white p-5 shadow-sm space-y-3">
                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                                                <Mail size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-gray-900">{log.request_source === 'manual_resend' ? 'Reenvío manual' : 'Conversión desde cotización'}</p>
                                                <p className="text-xs font-medium text-gray-500">{formatDate(log.sent_at || log.created_at)}</p>
                                            </div>
                                        </div>
                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getStatusStyles(log.status)}`}>
                                            {getStatusLabel(log.status)}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Emisor</p>
                                            <p className="font-semibold text-gray-700 break-all">{log.sender_email}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">CC</p>
                                            <p className="font-semibold text-gray-700 break-all">{log.cc_recipients.length > 0 ? log.cc_recipients.join(', ') : '-'}</p>
                                        </div>
                                        <div className="md:col-span-2">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Para</p>
                                            <p className="font-semibold text-gray-700 break-all">{log.to_recipients.join(', ')}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Gmail Message ID</p>
                                            <p className="font-mono text-xs text-gray-600 break-all">{log.gmail_message_id || '-'}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Gmail Thread ID</p>
                                            <p className="font-mono text-xs text-gray-600 break-all">{log.gmail_thread_id || '-'}</p>
                                        </div>
                                        {log.error_message && (
                                            <div className="md:col-span-2">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-red-400">Error</p>
                                                <p className="font-semibold text-red-600">{log.error_message}</p>
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
    );

    if (typeof document === 'undefined') return modalContent;
    return createPortal(modalContent, document.body);
};

export default OrderNotificationHistoryModal;
