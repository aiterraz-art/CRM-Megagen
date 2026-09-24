import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    HeartPulse, Mail, MessageCircle, Phone, PhoneCall, RefreshCw, Search, Trophy, XCircle
} from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import KPICard from '../components/KPICard';
import ReactivationAttemptModal from '../components/modals/ReactivationAttemptModal';
import ReactivationDiscardModal from '../components/modals/ReactivationDiscardModal';
import {
    SEGMENT_LABELS, SEGMENT_STYLES, STATUS_LABELS, formatDays, formatMoney,
    type ReactivationSegment, type ReactivationStatus
} from '../utils/reactivation';
import { normalizeChileanPhone } from '../utils/messageTemplates';

const CASES_PAGE_SIZE = 25;

type CaseRow = {
    id: string;
    client_id: string;
    client_name: string;
    client_phone: string | null;
    client_email: string | null;
    client_comuna: string | null;
    client_rut: string | null;
    assignee_name: string | null;
    segment: ReactivationSegment;
    status: ReactivationStatus;
    attempts_count: number;
    last_attempt_at: string | null;
    next_action_at: string | null;
    opened_at: string;
    lifetime_amount_snapshot: number;
    days_without_purchase_snapshot: number | null;
    won_amount: number | null;
    won_at: string | null;
    discard_reason: string | null;
};

const Reactivation = () => {
    const { profile, hasPermission } = useUser();
    const canManage = hasPermission('MANAGE_REACTIVATION');

    const [cases, setCases] = useState<CaseRow[]>([]);
    const [totals, setTotals] = useState({ total: 0, open: 0, wonMonth: 0, wonAmount: 0, stale: 0 });
    const [minAttempts, setMinAttempts] = useState(3);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [statusFilter, setStatusFilter] = useState<ReactivationStatus | 'all'>('open');
    const [segmentFilter, setSegmentFilter] = useState<ReactivationSegment | 'all'>('all');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);

    const [attemptCase, setAttemptCase] = useState<CaseRow | null>(null);
    const [discardCase, setDiscardCase] = useState<CaseRow | null>(null);

    useEffect(() => {
        const temporizador = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => window.clearTimeout(temporizador);
    }, [search]);

    useEffect(() => {
        setCurrentPage(1);
    }, [statusFilter, segmentFilter, debouncedSearch]);

    const fetchCases = useCallback(async () => {
        if (!profile?.id) return;

        setLoading(true);
        setErrorMessage(null);

        try {
            const [{ data, error }, { data: settings }] = await Promise.all([
                supabase.rpc('search_reactivation_cases_paged', {
                    p_actor_id: profile.id,
                    // Un jefe trabaja su propia bandeja aqui; el equipo completo se mira
                    // desde la consola de reparto.
                    p_view_all: false,
                    p_status: statusFilter,
                    p_segment: segmentFilter,
                    p_search: debouncedSearch,
                    p_limit: CASES_PAGE_SIZE,
                    p_offset: Math.max(0, (currentPage - 1) * CASES_PAGE_SIZE)
                } as any),
                supabase
                    .from('client_followup_settings')
                    .select('reactivation_min_attempts')
                    .eq('id', 'default')
                    .maybeSingle()
            ]);

            if (error) throw error;

            const rows = (data || []) as any[];
            setCases(rows.map((row) => row.case_row as CaseRow));
            setTotals({
                total: Number(rows[0]?.total_count || 0),
                open: Number(rows[0]?.open_count || 0),
                wonMonth: Number(rows[0]?.won_month_count || 0),
                wonAmount: Number(rows[0]?.won_month_amount || 0),
                stale: Number(rows[0]?.stale_count || 0)
            });
            setMinAttempts(Number((settings as any)?.reactivation_min_attempts || 3));
        } catch (error: any) {
            console.error('Error cargando casos de reactivacion:', error);
            setErrorMessage(error?.message || 'No se pudieron cargar los casos de reactivación.');
        } finally {
            setLoading(false);
        }
    }, [profile?.id, statusFilter, segmentFilter, debouncedSearch, currentPage]);

    useEffect(() => {
        void fetchCases();
    }, [fetchCases]);

    const totalPages = Math.max(1, Math.ceil(totals.total / CASES_PAGE_SIZE));

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);

    const abrirWhatsApp = (row: CaseRow) => {
        const telefono = normalizeChileanPhone(row.client_phone);
        if (!telefono) {
            alert('Este cliente no tiene un teléfono válido registrado.');
            return;
        }
        window.open(`https://wa.me/${telefono}`, '_blank', 'noopener');
    };

    const cabecera = useMemo(() => {
        if (statusFilter === 'won') return 'Clientes que volvieron a comprar';
        if (statusFilter === 'discarded') return 'Casos descartados';
        return 'Clientes asignados para reactivar, el silencio más caro primero';
    }, [statusFilter]);

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                        <HeartPulse className="text-rose-600" />
                        Reactivación
                    </h2>
                    <p className="text-gray-500 font-medium mt-1">{cabecera}</p>
                </div>
                <button
                    onClick={() => void fetchCases()}
                    disabled={loading}
                    className="flex items-center gap-2 rounded-2xl border border-gray-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-40"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                <KPICard title="Casos abiertos" value={String(totals.open)} icon={HeartPulse} color="rose"
                    detail="Asignados y sin cerrar" />
                <KPICard title="Reactivados del mes" value={String(totals.wonMonth)} icon={Trophy} color="emerald"
                    detail="Volvieron a comprar" />
                <KPICard title="Monto recuperado" value={formatMoney(totals.wonAmount)} icon={Trophy} color="indigo"
                    detail="En ventas del mes" />
                <KPICard title="Sin gestionar" value={String(totals.stale)} icon={PhoneCall} color="amber"
                    detail="Llevan días sin un intento" />
            </div>

            <div className="premium-card p-6 space-y-4">
                <div className="flex flex-col lg:flex-row gap-3">
                    <div className="flex-1 relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar por nombre, RUT o comuna..."
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as any)}
                        className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-bold outline-none"
                    >
                        <option value="open">Abiertos</option>
                        <option value="won">Reactivados</option>
                        <option value="discarded">Descartados</option>
                        <option value="all">Todos</option>
                    </select>
                    <select
                        value={segmentFilter}
                        onChange={(event) => setSegmentFilter(event.target.value as any)}
                        className="px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-bold outline-none"
                    >
                        <option value="all">Todos los segmentos</option>
                        <option value="cooling">Enfriándose</option>
                        <option value="dormant">Dormidos</option>
                        <option value="never_contacted">Sin contacto</option>
                    </select>
                </div>

                {errorMessage && (
                    <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
                        {errorMessage}
                    </div>
                )}
            </div>

            {loading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-24 bg-white rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : cases.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-16 bg-gray-50 rounded-[3rem] border-2 border-dashed border-gray-200">
                    <HeartPulse size={48} className="text-gray-300" />
                    <h3 className="text-xl font-bold text-gray-900 mt-4">No tienes casos en esta vista</h3>
                    <p className="text-gray-500 mt-2 text-center max-w-md">
                        {statusFilter === 'open'
                            ? 'Cuando el jefe te asigne clientes para reactivar, aparecerán aquí ordenados por lo que facturan.'
                            : 'Cambia el filtro de estado para ver otros casos.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {cases.map((row) => {
                        const esAbierto = row.status === 'open';

                        return (
                            <div key={row.id} className="premium-card p-6">
                                <div className="flex flex-col xl:flex-row xl:items-center gap-4 justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-lg font-black text-gray-900 truncate">{row.client_name}</h3>
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${SEGMENT_STYLES[row.segment]}`}>
                                                {SEGMENT_LABELS[row.segment]}
                                            </span>
                                            {!esAbierto && (
                                                <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-600">
                                                    {STATUS_LABELS[row.status]}
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-bold text-gray-500">
                                            <span className="text-indigo-600">{formatMoney(row.lifetime_amount_snapshot)} facturados</span>
                                            <span>Sin comprar: {formatDays(row.days_without_purchase_snapshot)}</span>
                                            <span>{row.attempts_count} intento(s)</span>
                                            {row.client_comuna && <span>{row.client_comuna}</span>}
                                        </div>

                                        {row.status === 'won' && (
                                            <p className="mt-2 text-xs font-black text-emerald-600">
                                                Volvió a comprar por {formatMoney(row.won_amount)}
                                            </p>
                                        )}
                                        {row.status === 'discarded' && row.discard_reason && (
                                            <p className="mt-2 text-xs font-bold text-gray-400">
                                                Descartado: {row.discard_reason}
                                            </p>
                                        )}
                                        {esAbierto && row.next_action_at && (
                                            <p className="mt-2 text-xs font-bold text-amber-600">
                                                Próximo contacto: {new Date(row.next_action_at).toLocaleDateString('es-CL')}
                                            </p>
                                        )}
                                    </div>

                                    {esAbierto && (
                                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            {row.client_phone && (
                                                <>
                                                    <a
                                                        href={`tel:${row.client_phone}`}
                                                        className="rounded-xl bg-emerald-50 p-3 text-emerald-600 transition-all hover:bg-emerald-100"
                                                        title="Llamar"
                                                    >
                                                        <Phone size={16} />
                                                    </a>
                                                    <button
                                                        onClick={() => abrirWhatsApp(row)}
                                                        className="rounded-xl bg-green-50 p-3 text-green-600 transition-all hover:bg-green-100"
                                                        title="WhatsApp"
                                                    >
                                                        <MessageCircle size={16} />
                                                    </button>
                                                </>
                                            )}
                                            {row.client_email && (
                                                <a
                                                    href={`mailto:${row.client_email}`}
                                                    className="rounded-xl bg-blue-50 p-3 text-blue-600 transition-all hover:bg-blue-100"
                                                    title="Correo"
                                                >
                                                    <Mail size={16} />
                                                </a>
                                            )}
                                            <button
                                                onClick={() => setAttemptCase(row)}
                                                className="rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-indigo-700"
                                            >
                                                Registrar intento
                                            </button>
                                            <button
                                                onClick={() => setDiscardCase(row)}
                                                className="rounded-xl border border-gray-200 p-3 text-gray-400 transition-all hover:bg-rose-50 hover:text-rose-600"
                                                title="Descartar caso"
                                            >
                                                <XCircle size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {!loading && totals.total > CASES_PAGE_SIZE && (
                <div className="flex flex-col items-center justify-between gap-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm sm:flex-row">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                        Mostrando {cases.length} de {totals.total} caso(s). Página {currentPage} de {totalPages}.
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                            disabled={currentPage <= 1}
                            className="rounded-2xl border border-gray-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-30"
                        >
                            Anterior
                        </button>
                        <span className="text-sm font-black text-gray-900">{currentPage} / {totalPages}</span>
                        <button
                            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                            disabled={currentPage >= totalPages}
                            className="rounded-2xl border border-gray-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-30"
                        >
                            Siguiente
                        </button>
                    </div>
                </div>
            )}

            <ReactivationAttemptModal
                caseRow={attemptCase}
                isOpen={Boolean(attemptCase)}
                onClose={() => setAttemptCase(null)}
                onSaved={() => void fetchCases()}
            />

            <ReactivationDiscardModal
                caseRow={discardCase}
                isOpen={Boolean(discardCase)}
                minAttempts={minAttempts}
                canOverride={canManage}
                onClose={() => setDiscardCase(null)}
                onDiscarded={() => void fetchCases()}
            />
        </div>
    );
};

export default Reactivation;
