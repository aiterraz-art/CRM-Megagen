import { AlertTriangle, Calendar, FileText, ShoppingBag, X } from 'lucide-react';
import {
    CollectionInvoiceSummary,
    CollectionsCrmCommercialSnapshot,
    CollectionsDebtSnapshot,
} from '../../utils/collectionsLinking';

type CollectionClientDetailModalProps = {
    isOpen: boolean;
    onClose: () => void;
    clientSummary: {
        client_name: string;
        client_rut: string;
        seller_name: string;
        seller_email: string;
    } | null;
    debtSnapshot: CollectionsDebtSnapshot | null;
    crmSnapshot: CollectionsCrmCommercialSnapshot | null;
    loading: boolean;
    error: string | null;
};

const formatMoney = (value: number | null | undefined) =>
    `$${Number(value || 0).toLocaleString('es-CL')}`;

const formatDate = (value: string | null | undefined) => {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('es-CL');
};

const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '-';
    return new Date(value).toLocaleString('es-CL');
};

const DetailTable = ({
    title,
    icon,
    emptyMessage,
    rows,
    renderRow,
}: {
    title: string;
    icon: React.ReactNode;
    emptyMessage: string;
    rows: any[];
    renderRow: (row: any) => React.ReactNode;
}) => (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-3">
            {icon}
            <h4 className="font-black text-gray-900">{title}</h4>
        </div>
        <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 text-center">
                    {emptyMessage}
                </div>
            ) : rows.map(renderRow)}
        </div>
    </div>
);

const CollectionClientDetailModal = ({
    isOpen,
    onClose,
    clientSummary,
    debtSnapshot,
    crmSnapshot,
    loading,
    error,
}: CollectionClientDetailModalProps) => {
    if (!isOpen) return null;

    const invoices: CollectionInvoiceSummary[] = debtSnapshot?.invoices || [];

    return (
        <div className="fixed inset-0 z-[2200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-6xl max-h-[90dvh] rounded-[2rem] shadow-2xl overflow-hidden flex flex-col">
                <div className="px-6 py-5 bg-slate-900 text-white flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-white/60 font-black">Detalle de cobranza + CRM</p>
                        <h3 className="text-2xl font-black mt-2">{clientSummary?.client_name || 'Cliente'}</h3>
                        <p className="mt-1 text-sm text-white/70">{clientSummary?.client_rut || 'Sin RUT'}</p>
                        <p className="mt-2 text-xs text-white/60">
                            {clientSummary?.seller_name || clientSummary?.seller_email || 'Sin vendedor asignado'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
                    {loading ? (
                        <div className="space-y-4 animate-pulse">
                            <div className="h-24 rounded-2xl bg-white border border-gray-100" />
                            <div className="h-48 rounded-2xl bg-white border border-gray-100" />
                            <div className="h-48 rounded-2xl bg-white border border-gray-100" />
                        </div>
                    ) : error ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 text-red-700 p-4 font-medium">
                            {error}
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-gray-400 font-black">Facturas pendientes</p>
                                    <p className="mt-2 text-3xl font-black text-gray-900">{debtSnapshot?.documents || 0}</p>
                                </div>
                                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-gray-400 font-black">Deuda pendiente</p>
                                    <p className="mt-2 text-3xl font-black text-slate-900">{formatMoney(debtSnapshot?.outstanding_total)}</p>
                                </div>
                                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-gray-400 font-black">Deuda vencida</p>
                                    <p className="mt-2 text-3xl font-black text-red-600">{formatMoney(debtSnapshot?.overdue_total)}</p>
                                </div>
                                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                                    <p className="text-[10px] uppercase tracking-[0.22em] text-gray-400 font-black">Mora máxima</p>
                                    <p className="mt-2 text-3xl font-black text-amber-600">{debtSnapshot?.max_aging_days || 0}</p>
                                    <p className="text-xs text-gray-500 mt-1">días</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                                <div className="xl:col-span-1 bg-white rounded-2xl border border-gray-100 p-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <AlertTriangle size={18} className="text-amber-500" />
                                        <h4 className="font-black text-gray-900">Resumen comercial</h4>
                                    </div>
                                    <div className="space-y-3 text-sm">
                                        <div className="flex justify-between gap-3">
                                            <span className="text-gray-500">Último pedido</span>
                                            <span className="font-bold text-gray-900">{formatDateTime(crmSnapshot?.last_order_at)}</span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span className="text-gray-500">Última cotización</span>
                                            <span className="font-bold text-gray-900">{formatDateTime(crmSnapshot?.last_quotation_at)}</span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span className="text-gray-500">Última visita</span>
                                            <span className="font-bold text-gray-900">{formatDateTime(crmSnapshot?.last_visit_at)}</span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span className="text-gray-500">Pedidos CRM</span>
                                            <span className="font-bold text-gray-900">{crmSnapshot?.total_orders || 0}</span>
                                        </div>
                                        <div className="flex justify-between gap-3">
                                            <span className="text-gray-500">Cotizaciones CRM</span>
                                            <span className="font-bold text-gray-900">{crmSnapshot?.total_quotations || 0}</span>
                                        </div>
                                        {!crmSnapshot?.crm_client && (
                                            <div className="rounded-xl border border-dashed border-gray-200 px-4 py-4 text-xs text-gray-500 mt-4">
                                                No se encontró cliente CRM asociado a este RUT.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="xl:col-span-2 grid grid-cols-1 gap-6">
                                    <DetailTable
                                        title="Facturas pendientes"
                                        icon={<Calendar size={18} className="text-amber-500" />}
                                        emptyMessage="Sin facturas pendientes para este cliente."
                                        rows={invoices}
                                        renderRow={(invoice: CollectionInvoiceSummary) => (
                                            <div key={invoice.id} className="rounded-xl border border-gray-100 p-3 bg-gray-50/70">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="font-black text-gray-900">{invoice.document_number || 'Sin documento'}</p>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            Emisión: {formatDate(invoice.issue_date)} · Vencimiento: {formatDate(invoice.due_date)}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-black text-gray-900">{formatMoney(invoice.outstanding_amount)}</p>
                                                        <p className={`text-xs font-bold mt-1 ${invoice.aging_days > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                                            {invoice.aging_days > 0 ? `${invoice.aging_days} días de mora` : 'Al día'}
                                                        </p>
                                                    </div>
                                                </div>
                                                {invoice.seller_comment && (
                                                    <p className="mt-2 text-xs text-gray-600">Descargo: {invoice.seller_comment}</p>
                                                )}
                                            </div>
                                        )}
                                    />

                                    <DetailTable
                                        title="Pedidos CRM"
                                        icon={<ShoppingBag size={18} className="text-indigo-500" />}
                                        emptyMessage="Sin pedidos CRM asociados a este cliente."
                                        rows={crmSnapshot?.orders || []}
                                        renderRow={(order) => (
                                            <div key={order.id} className="rounded-xl border border-gray-100 p-3 bg-gray-50/70">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="font-black text-gray-900">Pedido #{order.folio || order.id.slice(0, 8)}</p>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            {formatDateTime(order.created_at)} · {order.seller_name || 'Sin vendedor'}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-black text-gray-900">{formatMoney(order.total_amount)}</p>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            {order.status || 'Sin estado'} · {order.delivery_status || 'Sin despacho'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    />

                                    <DetailTable
                                        title="Cotizaciones CRM"
                                        icon={<FileText size={18} className="text-emerald-500" />}
                                        emptyMessage="Sin cotizaciones CRM asociadas a este cliente."
                                        rows={crmSnapshot?.quotations || []}
                                        renderRow={(quotation) => (
                                            <div key={quotation.id} className="rounded-xl border border-gray-100 p-3 bg-gray-50/70">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className="font-black text-gray-900">Cotización #{quotation.folio || quotation.id.slice(0, 8)}</p>
                                                        <p className="text-xs text-gray-500 mt-1">
                                                            {formatDateTime(quotation.created_at)} · {quotation.seller_name || 'Sin vendedor'}
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-black text-gray-900">{formatMoney(quotation.total_amount)}</p>
                                                        <p className={`text-xs font-bold mt-1 ${quotation.has_order ? 'text-emerald-600' : 'text-gray-500'}`}>
                                                            {quotation.has_order ? 'Pedido generado' : quotation.status || 'Sin estado'}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CollectionClientDetailModal;
