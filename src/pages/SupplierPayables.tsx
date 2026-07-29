import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, FileText, Pencil, Plus, RefreshCw, Search, XCircle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Database } from '../types/supabase';

type SupplierRow = Database['public']['Tables']['suppliers']['Row'];
type SupplierPayableRow = Database['public']['Tables']['supplier_payables']['Row'];

type PayableStatusFilter = 'all' | 'pending' | 'partial' | 'overdue' | 'paid' | 'cancelled';
type CurrencyCode = 'CLP' | 'USD';

type PayableFormState = {
    supplier_id: string;
    reference_number: string;
    description: string;
    issue_date: string;
    due_date: string;
    currency: CurrencyCode;
    total_amount: string;
    paid_amount: string;
    status: SupplierPayableRow['status'];
    notes: string;
};

type EnrichedPayable = SupplierPayableRow & {
    supplier: SupplierRow | null;
    balance: number;
    derivedStatus: Exclude<PayableStatusFilter, 'all'>;
};

const todayInput = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const createEmptyForm = (): PayableFormState => ({
    supplier_id: '',
    reference_number: '',
    description: '',
    issue_date: todayInput(),
    due_date: todayInput(),
    currency: 'CLP',
    total_amount: '',
    paid_amount: '0',
    status: 'pending',
    notes: '',
});

const formatCurrency = (value: number | null | undefined, currency: CurrencyCode = 'CLP') =>
    new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency,
        minimumFractionDigits: currency === 'CLP' ? 0 : 2,
        maximumFractionDigits: currency === 'CLP' ? 0 : 2,
    }).format(Number(value || 0));

const formatDate = (value?: string | null) => {
    if (!value) return 'Sin fecha';
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(parsed.getTime())) return 'Sin fecha';
    return parsed.toLocaleDateString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
};

const normalizeStatus = (
    totalAmount: number,
    paidAmount: number,
    manualStatus: SupplierPayableRow['status']
): SupplierPayableRow['status'] => {
    if (manualStatus === 'cancelled') return 'cancelled';
    if (paidAmount >= totalAmount) return 'paid';
    if (paidAmount > 0) return 'partial';
    return 'pending';
};

const getDerivedStatus = (payable: SupplierPayableRow): EnrichedPayable['derivedStatus'] => {
    if (payable.status === 'cancelled') return 'cancelled';
    const balance = Math.max(0, Number(payable.total_amount || 0) - Number(payable.paid_amount || 0));
    if (balance <= 0) return 'paid';

    const dueDate = new Date(`${payable.due_date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isFinite(dueDate.getTime()) && dueDate.getTime() < today.getTime()) return 'overdue';
    if (Number(payable.paid_amount || 0) > 0) return 'partial';
    return 'pending';
};

const statusLabelMap: Record<Exclude<PayableStatusFilter, 'all'>, string> = {
    pending: 'Pendiente',
    partial: 'Abono Parcial',
    overdue: 'Vencida',
    paid: 'Pagada',
    cancelled: 'Cancelada',
};

const statusStyleMap: Record<Exclude<PayableStatusFilter, 'all'>, string> = {
    pending: 'bg-slate-100 text-slate-700 border-slate-200',
    partial: 'bg-sky-50 text-sky-700 border-sky-200',
    overdue: 'bg-rose-50 text-rose-700 border-rose-200',
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    cancelled: 'bg-amber-50 text-amber-700 border-amber-200',
};

const SupplierPayables: React.FC = () => {
    const { profile, hasPermission } = useUser();
    const canManage = hasPermission('MANAGE_SUPPLIER_PAYABLES');

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
    const [payables, setPayables] = useState<SupplierPayableRow[]>([]);
    const [search, setSearch] = useState('');
    const [supplierFilter, setSupplierFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<PayableStatusFilter>('all');
    const [showForm, setShowForm] = useState(false);
    const [editingPayableId, setEditingPayableId] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [form, setForm] = useState<PayableFormState>(createEmptyForm());

    const fetchModuleData = useCallback(async (showLoader = true) => {
        if (showLoader) {
            setLoading(true);
        } else {
            setRefreshing(true);
        }

        try {
            setError(null);
            const [suppliersRes, payablesRes] = await Promise.all([
                supabase.from('suppliers').select('*').order('name', { ascending: true }),
                supabase.from('supplier_payables').select('*').order('due_date', { ascending: true }),
            ]);

            if (suppliersRes.error) throw suppliersRes.error;
            if (payablesRes.error) throw payablesRes.error;

            setSuppliers((suppliersRes.data || []) as SupplierRow[]);
            setPayables((payablesRes.data || []) as SupplierPayableRow[]);
        } catch (fetchError: any) {
            console.error('SupplierPayables fetch error:', fetchError);
            setError(fetchError?.message || 'No se pudo cargar el módulo de cuentas por pagar.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void fetchModuleData();
    }, [fetchModuleData]);

    const supplierMap = useMemo(
        () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
        [suppliers]
    );

    const enrichedPayables = useMemo<EnrichedPayable[]>(
        () => payables.map((payable) => {
            const balance = Math.max(0, Number(payable.total_amount || 0) - Number(payable.paid_amount || 0));
            return {
                ...payable,
                supplier: supplierMap.get(payable.supplier_id) || null,
                balance,
                derivedStatus: getDerivedStatus(payable),
            };
        }),
        [payables, supplierMap]
    );

    const filteredPayables = useMemo(() => {
        const normalizedSearch = search
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

        return enrichedPayables.filter((payable) => {
            if (supplierFilter !== 'all' && payable.supplier_id !== supplierFilter) return false;
            if (statusFilter !== 'all' && payable.derivedStatus !== statusFilter) return false;

            if (!normalizedSearch) return true;
            const haystack = [
                payable.reference_number,
                payable.description,
                payable.notes,
                payable.supplier?.name,
                payable.supplier?.email,
                payable.supplier?.contact_name,
            ]
                .filter(Boolean)
                .join(' ')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase();

            return haystack.includes(normalizedSearch);
        });
    }, [enrichedPayables, search, statusFilter, supplierFilter]);

    const summary = useMemo(() => {
        const openRows = filteredPayables.filter((row) => !['paid', 'cancelled'].includes(row.derivedStatus));
        const overdueRows = filteredPayables.filter((row) => row.derivedStatus === 'overdue');
        const outstandingBalance = openRows.reduce((sum, row) => sum + row.balance, 0);
        const overdueBalance = overdueRows.reduce((sum, row) => sum + row.balance, 0);
        const supplierCount = new Set(openRows.map((row) => row.supplier_id)).size;
        return {
            outstandingBalance,
            overdueBalance,
            overdueCount: overdueRows.length,
            supplierCount,
        };
    }, [filteredPayables]);

    const handleStartCreate = () => {
        setEditingPayableId(null);
        setForm(createEmptyForm());
        setFormError(null);
        setShowForm(true);
    };

    const handleEdit = (payable: EnrichedPayable) => {
        setEditingPayableId(payable.id);
        setForm({
            supplier_id: payable.supplier_id,
            reference_number: payable.reference_number || '',
            description: payable.description,
            issue_date: payable.issue_date,
            due_date: payable.due_date,
            currency: (payable.currency || 'CLP') as CurrencyCode,
            total_amount: String(Number(payable.total_amount || 0)),
            paid_amount: String(Number(payable.paid_amount || 0)),
            status: payable.status,
            notes: payable.notes || '',
        });
        setFormError(null);
        setShowForm(true);
    };

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!profile?.id) {
            setFormError('No se pudo identificar al usuario actual.');
            return;
        }

        if (!form.supplier_id) {
            setFormError('Debes seleccionar un proveedor.');
            return;
        }

        if (!form.description.trim()) {
            setFormError('Debes ingresar una descripción para la deuda.');
            return;
        }

        if (!form.issue_date || !form.due_date) {
            setFormError('Debes indicar la fecha de emisión y vencimiento.');
            return;
        }

        const totalAmount = Number(form.total_amount || 0);
        const paidAmount = Number(form.paid_amount || 0);
        if (!Number.isFinite(totalAmount) || totalAmount < 0) {
            setFormError('El monto total no es válido.');
            return;
        }
        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
            setFormError('El monto abonado no es válido.');
            return;
        }
        if (paidAmount > totalAmount) {
            setFormError('El monto abonado no puede ser mayor que la deuda total.');
            return;
        }
        if (form.due_date < form.issue_date) {
            setFormError('La fecha de vencimiento no puede ser anterior a la emisión.');
            return;
        }

        const normalizedStatus = normalizeStatus(totalAmount, paidAmount, form.status);
        const payload: Database['public']['Tables']['supplier_payables']['Insert'] = {
            supplier_id: form.supplier_id,
            reference_number: form.reference_number.trim() || null,
            description: form.description.trim(),
            issue_date: form.issue_date,
            due_date: form.due_date,
            currency: form.currency,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            status: normalizedStatus,
            notes: form.notes.trim() || null,
            created_by: profile.id,
            updated_by: profile.id,
        };

        setSaving(true);
        setFormError(null);

        try {
            if (editingPayableId) {
                const updatePayload: Database['public']['Tables']['supplier_payables']['Update'] = {
                    supplier_id: payload.supplier_id,
                    reference_number: payload.reference_number,
                    description: payload.description,
                    issue_date: payload.issue_date,
                    due_date: payload.due_date,
                    currency: payload.currency,
                    total_amount: payload.total_amount,
                    paid_amount: payload.paid_amount,
                    status: payload.status,
                    notes: payload.notes,
                    updated_by: profile.id,
                };
                const { error: updateError } = await supabase
                    .from('supplier_payables')
                    .update(updatePayload)
                    .eq('id', editingPayableId);
                if (updateError) throw updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('supplier_payables')
                    .insert(payload);
                if (insertError) throw insertError;
            }

            setShowForm(false);
            setEditingPayableId(null);
            setForm(createEmptyForm());
            await fetchModuleData(false);
        } catch (saveError: any) {
            console.error('SupplierPayables save error:', saveError);
            setFormError(saveError?.message || 'No se pudo guardar la deuda del proveedor.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 border-4 border-amber-600 border-t-transparent animate-spin rounded-full"></div>
                <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Cargando cuentas por pagar...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 w-full mx-auto px-4 sm:px-6 lg:px-8 pb-12">
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.32em] text-amber-500">Gestión financiera</p>
                    <h1 className="mt-2 text-4xl font-black text-gray-900 tracking-tight">Cuentas por Pagar</h1>
                    <p className="mt-2 text-gray-500 font-medium max-w-3xl">
                        Revisa saldos pendientes por proveedor, identifica vencimientos y controla pagos parciales desde un solo panel.
                    </p>
                </div>

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={() => void fetchModuleData(false)}
                        className="px-4 py-3 rounded-2xl border border-gray-200 bg-white text-gray-700 font-bold text-sm hover:bg-gray-50 transition-all"
                    >
                        <RefreshCw size={18} className={`inline mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        {refreshing ? 'Actualizando...' : 'Actualizar'}
                    </button>
                    {canManage && (
                        <button
                            onClick={handleStartCreate}
                            className="px-5 py-3 rounded-2xl bg-amber-600 text-white font-black text-sm shadow-lg shadow-amber-100 hover:bg-amber-700 transition-all"
                        >
                            <Plus size={18} className="inline mr-2" />
                            Nueva Deuda
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700 font-medium">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                <div className="premium-card p-5 border border-gray-100">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">Saldo pendiente</p>
                    <p className="mt-3 text-3xl font-black text-gray-900">{formatCurrency(summary.outstandingBalance, 'CLP')}</p>
                    <p className="mt-2 text-sm font-medium text-gray-500">Total visible aún por pagar</p>
                </div>
                <div className="premium-card p-5 border border-rose-100 bg-rose-50/60">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-rose-500">Monto vencido</p>
                    <p className="mt-3 text-3xl font-black text-rose-700">{formatCurrency(summary.overdueBalance, 'CLP')}</p>
                    <p className="mt-2 text-sm font-medium text-rose-600">{summary.overdueCount} deuda(s) vencida(s)</p>
                </div>
                <div className="premium-card p-5 border border-sky-100 bg-sky-50/60">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-500">Proveedores activos</p>
                    <p className="mt-3 text-3xl font-black text-sky-700">{summary.supplierCount}</p>
                    <p className="mt-2 text-sm font-medium text-sky-600">Con saldo abierto en el filtro actual</p>
                </div>
                <div className="premium-card p-5 border border-emerald-100 bg-emerald-50/60">
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-500">Registros visibles</p>
                    <p className="mt-3 text-3xl font-black text-emerald-700">{filteredPayables.length}</p>
                    <p className="mt-2 text-sm font-medium text-emerald-600">Entre pendientes, abonadas y cerradas</p>
                </div>
            </div>

            <div className="premium-card p-5 border border-gray-100">
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                    <div className="relative xl:col-span-2">
                        <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar por proveedor, referencia, descripción o nota..."
                            className="w-full pl-11 pr-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                        />
                    </div>
                    <select
                        value={supplierFilter}
                        onChange={(event) => setSupplierFilter(event.target.value)}
                        className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-bold text-gray-700 outline-none focus:border-amber-400"
                    >
                        <option value="all">Todos los proveedores</option>
                        {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                                {supplier.name}
                            </option>
                        ))}
                    </select>
                    <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as PayableStatusFilter)}
                        className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-bold text-gray-700 outline-none focus:border-amber-400"
                    >
                        <option value="all">Todos los estados</option>
                        <option value="pending">Pendientes</option>
                        <option value="partial">Abono parcial</option>
                        <option value="overdue">Vencidas</option>
                        <option value="paid">Pagadas</option>
                        <option value="cancelled">Canceladas</option>
                    </select>
                </div>
            </div>

            {showForm && canManage && (
                <div className="premium-card p-6 border border-amber-100 bg-amber-50/50">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-500">
                                {editingPayableId ? 'Editar registro' : 'Nueva deuda'}
                            </p>
                            <h2 className="mt-2 text-2xl font-black text-gray-900">
                                {editingPayableId ? 'Actualizar cuenta por pagar' : 'Registrar cuenta por pagar'}
                            </h2>
                        </div>
                        <button
                            onClick={() => {
                                setShowForm(false);
                                setEditingPayableId(null);
                                setForm(createEmptyForm());
                                setFormError(null);
                            }}
                            className="rounded-full p-3 text-gray-400 hover:bg-white hover:text-gray-700 transition-all"
                        >
                            <XCircle size={22} />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="mt-6 space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Proveedor</span>
                                <select
                                    value={form.supplier_id}
                                    onChange={(event) => setForm((current) => ({ ...current, supplier_id: event.target.value }))}
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                >
                                    <option value="">Selecciona proveedor</option>
                                    {suppliers.map((supplier) => (
                                        <option key={supplier.id} value={supplier.id}>
                                            {supplier.name}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Referencia</span>
                                <input
                                    value={form.reference_number}
                                    onChange={(event) => setForm((current) => ({ ...current, reference_number: event.target.value }))}
                                    placeholder="Factura, OC o folio"
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                />
                            </label>

                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Emisión</span>
                                <input
                                    type="date"
                                    value={form.issue_date}
                                    onChange={(event) => setForm((current) => ({ ...current, issue_date: event.target.value }))}
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                />
                            </label>

                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Vencimiento</span>
                                <input
                                    type="date"
                                    value={form.due_date}
                                    onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))}
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                />
                            </label>
                        </div>

                        <label className="space-y-2 block">
                            <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Descripción</span>
                            <input
                                value={form.description}
                                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                                placeholder="Ej: factura implantes julio, insumos quirúrgicos, courier internacional..."
                                className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                            />
                        </label>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Moneda</span>
                                <select
                                    value={form.currency}
                                    onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value as CurrencyCode }))}
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                >
                                    <option value="CLP">CLP</option>
                                    <option value="USD">USD</option>
                                </select>
                            </label>

                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Monto total</span>
                                <input
                                    type="number"
                                    min="0"
                                    step={form.currency === 'CLP' ? '1' : '0.01'}
                                    value={form.total_amount}
                                    onChange={(event) => setForm((current) => ({ ...current, total_amount: event.target.value }))}
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                />
                            </label>

                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Monto abonado</span>
                                <input
                                    type="number"
                                    min="0"
                                    step={form.currency === 'CLP' ? '1' : '0.01'}
                                    value={form.paid_amount}
                                    onChange={(event) => setForm((current) => ({ ...current, paid_amount: event.target.value }))}
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                />
                            </label>

                            <label className="space-y-2">
                                <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Estado manual</span>
                                <select
                                    value={form.status}
                                    onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as SupplierPayableRow['status'] }))}
                                    className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400"
                                >
                                    <option value="pending">Pendiente</option>
                                    <option value="partial">Abono parcial</option>
                                    <option value="paid">Pagada</option>
                                    <option value="cancelled">Cancelada</option>
                                </select>
                            </label>
                        </div>

                        <label className="space-y-2 block">
                            <span className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-500">Notas</span>
                            <textarea
                                value={form.notes}
                                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                                rows={3}
                                placeholder="Observaciones sobre pago, compromiso con proveedor, transferencia parcial, etc."
                                className="w-full px-4 py-3 rounded-2xl border border-gray-200 bg-white text-sm font-medium outline-none focus:border-amber-400 resize-none"
                            />
                        </label>

                        {formError && (
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                                {formError}
                            </div>
                        )}

                        <div className="flex flex-wrap justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowForm(false);
                                    setEditingPayableId(null);
                                    setForm(createEmptyForm());
                                    setFormError(null);
                                }}
                                className="px-4 py-3 rounded-2xl border border-gray-200 bg-white text-gray-700 font-bold text-sm hover:bg-gray-50 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-5 py-3 rounded-2xl bg-amber-600 text-white font-black text-sm shadow-lg shadow-amber-100 hover:bg-amber-700 transition-all disabled:opacity-50"
                            >
                                {saving ? 'Guardando...' : editingPayableId ? 'Guardar Cambios' : 'Registrar Deuda'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="premium-card overflow-hidden border border-gray-100">
                <div className="p-5 border-b border-gray-100 bg-gray-50/70 flex items-center justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-gray-400">Listado operativo</p>
                        <h2 className="mt-2 text-2xl font-black text-gray-900">Deudas por proveedor</h2>
                    </div>
                    <span className="px-4 py-2 rounded-2xl bg-white border border-gray-200 text-sm font-black text-gray-700">
                        {filteredPayables.length} registro(s)
                    </span>
                </div>

                {filteredPayables.length === 0 ? (
                    <div className="p-12 text-center">
                        <CircleDollarSign size={40} className="mx-auto text-gray-300" />
                        <p className="mt-4 text-lg font-black text-gray-700">No hay cuentas por pagar en este filtro</p>
                        <p className="mt-2 text-sm font-medium text-gray-500">
                            Ajusta búsqueda y estados, o registra una nueva deuda para comenzar el control financiero.
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {filteredPayables.map((payable) => (
                            <div key={payable.id} className="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-lg font-black text-gray-900">
                                            {payable.supplier?.name || 'Proveedor eliminado'}
                                        </p>
                                        <span className={`px-3 py-1 rounded-full border text-[11px] font-black uppercase tracking-widest ${statusStyleMap[payable.derivedStatus]}`}>
                                            {statusLabelMap[payable.derivedStatus]}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm font-semibold text-gray-700">
                                        {payable.reference_number ? `${payable.reference_number} · ` : ''}{payable.description}
                                    </p>
                                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                        <span>Emisión: {formatDate(payable.issue_date)}</span>
                                        <span>Vence: {formatDate(payable.due_date)}</span>
                                        <span>Registrado: {formatDate(payable.created_at?.slice?.(0, 10) || null)}</span>
                                    </div>
                                    {payable.notes && (
                                        <div className="mt-3 rounded-2xl bg-gray-50 px-4 py-3 text-sm font-medium text-gray-600">
                                            <FileText size={16} className="inline mr-2 text-gray-400" />
                                            {payable.notes}
                                        </div>
                                    )}
                                </div>

                                <div className="xl:w-[360px] flex flex-col gap-3">
                                    <div className="grid grid-cols-3 gap-3 text-center">
                                        <div className="rounded-2xl border border-gray-100 bg-white px-3 py-4">
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Total</p>
                                            <p className="mt-2 text-sm font-black text-gray-900">{formatCurrency(payable.total_amount, payable.currency as CurrencyCode)}</p>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-white px-3 py-4">
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Abonado</p>
                                            <p className="mt-2 text-sm font-black text-sky-700">{formatCurrency(payable.paid_amount, payable.currency as CurrencyCode)}</p>
                                        </div>
                                        <div className="rounded-2xl border border-gray-100 bg-white px-3 py-4">
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Saldo</p>
                                            <p className={`mt-2 text-sm font-black ${payable.balance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                                {formatCurrency(payable.balance, payable.currency as CurrencyCode)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2 justify-end">
                                        {payable.derivedStatus === 'paid' && (
                                            <span className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-emerald-50 text-emerald-700 text-xs font-black uppercase tracking-wider">
                                                <CheckCircle2 size={16} />
                                                Pagada
                                            </span>
                                        )}
                                        {payable.derivedStatus === 'overdue' && (
                                            <span className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-rose-50 text-rose-700 text-xs font-black uppercase tracking-wider">
                                                <AlertTriangle size={16} />
                                                Acción Prioritaria
                                            </span>
                                        )}
                                        {canManage && (
                                            <button
                                                onClick={() => handleEdit(payable)}
                                                className="px-4 py-3 rounded-2xl border border-gray-200 bg-white text-gray-700 font-bold text-sm hover:bg-gray-50 transition-all"
                                            >
                                                <Pencil size={16} className="inline mr-2" />
                                                Editar
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SupplierPayables;
