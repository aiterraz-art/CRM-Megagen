import { createPortal } from 'react-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Package, Send, User, X } from 'lucide-react';

type DetailItem = {
    id: string;
    sku_snapshot: string;
    product_name_snapshot: string;
    qty: number;
    unit_price: number;
    line_total: number;
};

type DetailRequest = {
    id: string;
    folio: number;
    status: string;
    client_name_snapshot: string;
    client_rut_snapshot: string | null;
    client_address_snapshot: string | null;
    client_comuna_snapshot: string | null;
    seller_name_snapshot: string;
    request_comment: string | null;
    sent_note: string | null;
    close_note: string | null;
    cancel_note: string | null;
    created_at: string;
    sent_at: string | null;
    closed_at: string | null;
    cancelled_at: string | null;
    created_by: string;
    sent_by: string | null;
    closed_by: string | null;
    cancelled_by: string | null;
    exchange_completed_successfully: boolean;
    return_products_collected: boolean;
};

type SizeChangeRequestDetailModalProps = {
    isOpen: boolean;
    request: DetailRequest | null;
    items: DetailItem[];
    actorNames: Record<string, string>;
    canEdit: boolean;
    canMarkSent: boolean;
    canCloseRequest: boolean;
    canCancel: boolean;
    onClose: () => void;
    onEdit: () => void;
    onMarkSent: () => void;
    onCloseRequest: () => void;
    onCancel: () => void;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

const formatDateTime = (value?: string | null) => {
    if (!value) return 'Sin registro';
    return new Date(value).toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const statusStyles: Record<string, string> = {
    requested: 'bg-amber-50 text-amber-700 border-amber-200',
    sent: 'bg-sky-50 text-sky-700 border-sky-200',
    closed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
};

const statusLabels: Record<string, string> = {
    requested: 'Solicitado',
    sent: 'Enviado',
    closed: 'Cerrado',
    cancelled: 'Cancelado',
};

const SizeChangeRequestDetailModal = ({
    isOpen,
    request,
    items,
    actorNames,
    canEdit,
    canMarkSent,
    canCloseRequest,
    canCancel,
    onClose,
    onEdit,
    onMarkSent,
    onCloseRequest,
    onCancel,
}: SizeChangeRequestDetailModalProps) => {
    if (!isOpen || !request) return null;

    const totalAmount = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);

    const modalContent = (
        <div className="fixed inset-0 z-[290] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
            <div className="w-full max-w-6xl max-h-[92vh] rounded-[2rem] bg-white shadow-2xl overflow-hidden flex flex-col">
                <div className="flex items-start justify-between gap-4 px-5 py-4 md:px-6 md:py-5 border-b border-gray-100 shrink-0">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Detalle del cambio</p>
                        <h3 className="text-xl md:text-2xl font-black text-gray-900 mt-1">Cambio #{request.folio}</h3>
                        <p className="text-sm font-medium text-gray-500 mt-1 truncate">{request.client_name_snapshot}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                        <span className={`rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${statusStyles[request.status] || statusStyles.requested}`}>
                            {statusLabels[request.status] || request.status}
                        </span>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors shrink-0">
                            <X size={22} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 py-5 md:px-6 md:py-6 space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="premium-card p-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Cliente</p>
                            <h4 className="mt-2 text-lg font-black text-gray-900 uppercase">{request.client_name_snapshot}</h4>
                            <p className="mt-2 text-sm font-medium text-gray-600">{[request.client_rut_snapshot, request.client_address_snapshot, request.client_comuna_snapshot].filter(Boolean).join(' · ') || 'Sin datos adicionales'}</p>
                        </div>
                        <div className="premium-card p-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Vendedor</p>
                            <div className="mt-3 flex items-center gap-3">
                                <div className="h-11 w-11 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                                    <User size={18} />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-gray-900 uppercase">{request.seller_name_snapshot}</p>
                                    <p className="text-xs font-medium text-gray-500">Creado {formatDateTime(request.created_at)}</p>
                                </div>
                            </div>
                        </div>
                        <div className="premium-card p-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Monto total</p>
                            <p className="mt-2 text-3xl font-black text-indigo-600">{formatMoney(totalAmount)}</p>
                            <p className="text-xs font-medium text-gray-500 mt-1">{items.length} línea(s) de producto</p>
                        </div>
                    </div>

                    <div className="premium-card overflow-hidden p-0">
                        <div className="hidden md:grid grid-cols-[1.1fr_2.6fr_0.8fr_1fr_1fr] gap-0 border-b border-gray-100 bg-gray-50 px-5 py-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">SKU</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Producto</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Cantidad</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">Valor</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 text-right">Total</p>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {items.map((item) => (
                                <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1.1fr_2.6fr_0.8fr_1fr_1fr] gap-3 md:gap-0 px-4 py-4 md:px-5">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">SKU</p>
                                        <p className="text-sm font-black text-gray-900">{item.sku_snapshot || 'SIN SKU'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">Producto</p>
                                        <p className="text-sm font-bold text-gray-900">{item.product_name_snapshot}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">Cantidad</p>
                                        <p className="text-sm font-black text-gray-900">{Number(item.qty || 0).toLocaleString('es-CL')}</p>
                                    </div>
                                    <div className="md:text-right">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">Valor</p>
                                        <p className="text-sm font-black text-gray-900">{formatMoney(item.unit_price)}</p>
                                    </div>
                                    <div className="md:text-right">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 md:hidden">Total</p>
                                        <p className="text-sm font-black text-indigo-600">{formatMoney(item.line_total)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="premium-card p-5 space-y-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Comentario comercial</p>
                                <p className="mt-2 text-sm font-medium text-gray-700 whitespace-pre-wrap">{request.request_comment || 'Sin comentarios registrados.'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Nota de envío</p>
                                <p className="mt-2 text-sm font-medium text-gray-700 whitespace-pre-wrap">{request.sent_note || 'Sin nota de envío.'}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">Cierre / cancelación</p>
                                <p className="mt-2 text-sm font-medium text-gray-700 whitespace-pre-wrap">
                                    {request.close_note || request.cancel_note || 'Sin nota final registrada.'}
                                </p>
                            </div>
                        </div>
                        <div className="premium-card p-5 space-y-4">
                            <div className="flex items-center gap-2 text-gray-900">
                                <ClipboardList size={18} className="text-indigo-600" />
                                <p className="text-sm font-black uppercase tracking-[0.2em] text-gray-500">Trazabilidad</p>
                            </div>
                            <div className="space-y-3 text-sm text-gray-700">
                                <div>
                                    <p className="font-black text-gray-900">Creado</p>
                                    <p className="font-medium">{actorNames[request.created_by] || 'Usuario'} · {formatDateTime(request.created_at)}</p>
                                </div>
                                <div>
                                    <p className="font-black text-gray-900">Enviado</p>
                                    <p className="font-medium">{request.sent_at ? `${actorNames[request.sent_by || ''] || 'Usuario'} · ${formatDateTime(request.sent_at)}` : 'Aún no enviado'}</p>
                                </div>
                                <div>
                                    <p className="font-black text-gray-900">Cerrado</p>
                                    <p className="font-medium">{request.closed_at ? `${actorNames[request.closed_by || ''] || 'Usuario'} · ${formatDateTime(request.closed_at)}` : 'Aún no cerrado'}</p>
                                </div>
                                <div>
                                    <p className="font-black text-gray-900">Cancelado</p>
                                    <p className="font-medium">{request.cancelled_at ? `${actorNames[request.cancelled_by || ''] || 'Usuario'} · ${formatDateTime(request.cancelled_at)}` : 'No cancelado'}</p>
                                </div>
                            </div>
                            {request.status === 'closed' && (
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                                    <div className="flex items-center gap-2 font-black">
                                        <CheckCircle2 size={16} /> Cambio realizado exitosamente
                                    </div>
                                    <div className="mt-2 flex items-center gap-2 font-black">
                                        <Package size={16} /> Productos de devolución retirados
                                    </div>
                                </div>
                            )}
                            {request.status === 'cancelled' && (
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-800 flex items-start gap-2">
                                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                    Esta solicitud fue cancelada y no generó movimiento de stock.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-4 md:px-6 border-t border-gray-100 bg-white">
                    {canCancel && (
                        <button
                            onClick={onCancel}
                            className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-600 hover:bg-red-100 transition-colors"
                        >
                            Cancelar solicitud
                        </button>
                    )}
                    {canEdit && (
                        <button
                            onClick={onEdit}
                            className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-black text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            Editar
                        </button>
                    )}
                    {canMarkSent && (
                        <button
                            onClick={onMarkSent}
                            className="inline-flex items-center rounded-2xl bg-sky-600 px-4 py-3 text-sm font-black text-white hover:bg-sky-700 transition-colors"
                        >
                            <Send size={16} className="mr-2" />
                            Marcar enviado
                        </button>
                    )}
                    {canCloseRequest && (
                        <button
                            onClick={onCloseRequest}
                            className="inline-flex items-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 transition-colors"
                        >
                            <CheckCircle2 size={16} className="mr-2" />
                            Cerrar cambio
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-black text-gray-600 hover:bg-gray-50 transition-colors"
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

export default SizeChangeRequestDetailModal;
