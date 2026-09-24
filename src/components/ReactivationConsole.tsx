import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, RefreshCw, Search, UserCheck, Users } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import ReactivationAssignModal from './modals/ReactivationAssignModal';
import { SEGMENT_LABELS, SEGMENT_STYLES, formatDays, formatMoney, type ReactivationSegment } from '../utils/reactivation';

const CANDIDATES_PAGE_SIZE = 25;
// La funcion de busqueda acota cada llamada a 200 filas, asi que recoger "todo lo
// filtrado" se hace recorriendo paginas de ese tamaño en lugar de pedirlo de una vez.
const BATCH_SIZE = 200;

type Candidate = {
    client_id: string;
    name: string;
    rut: string | null;
    comuna: string | null;
    owner_id: string | null;
    owner_name: string | null;
    owner_status: string | null;
    lifetime_amount: number;
    days_without_contact: number | null;
    days_without_purchase: number | null;
    segment: ReactivationSegment;
};

type Workload = {
    seller_id: string;
    seller_name: string;
    open_cases: number;
    stale_cases: number;
    avg_attempts: number;
    won_month: number;
    won_month_amount: number;
    discarded_month: number;
};

type SubTab = 'candidatos' | 'carga' | 'huerfanos';

const ReactivationConsole = () => {
    const { profile, hasPermission } = useUser();
    const canArchive = hasPermission('ARCHIVE_CLIENTS');

    const [subTab, setSubTab] = useState<SubTab>('candidatos');

    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [totals, setTotals] = useState({ total: 0, cooling: 0, dormant: 0, never: 0, amount: 0 });
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [segmentFilter, setSegmentFilter] = useState<'all' | ReactivationSegment>('all');
    const [ownerStatusFilter, setOwnerStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [minAmount, setMinAmount] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);

    const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());
    const [assignOpen, setAssignOpen] = useState(false);
    const [sellers, setSellers] = useState<Array<{ id: string; nombre: string; rol: string }>>([]);

    const [workload, setWorkload] = useState<Workload[]>([]);
    const [orphanPreview, setOrphanPreview] = useState<any>(null);
    const [orphanBusy, setOrphanBusy] = useState(false);

    useEffect(() => {
        const temporizador = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => window.clearTimeout(temporizador);
    }, [search]);

    useEffect(() => {
        setCurrentPage(1);
    }, [segmentFilter, ownerStatusFilter, debouncedSearch, minAmount]);

    const buildParams = useCallback((page: number, pageSize: number) => ({
        p_actor_id: profile?.id ?? null,
        p_can_view_all: true,
        p_segment: segmentFilter,
        p_seller: 'all',
        p_search: debouncedSearch,
        p_min_amount: minAmount,
        p_owner_status: ownerStatusFilter,
        p_sort: 'value',
        p_limit: pageSize,
        p_offset: Math.max(0, (page - 1) * pageSize)
    }), [profile?.id, segmentFilter, debouncedSearch, minAmount, ownerStatusFilter]);

    const fetchCandidates = useCallback(async () => {
        if (!profile?.id) return;

        setLoading(true);
        setErrorMessage(null);

        try {
            const { data, error } = await supabase.rpc(
                'search_reactivation_candidates_paged',
                buildParams(currentPage, CANDIDATES_PAGE_SIZE) as any
            );

            if (error) throw error;

            const rows = (data || []) as any[];
            setCandidates(rows.map((row) => row.candidate as Candidate));
            setTotals({
                total: Number(rows[0]?.total_count || 0),
                cooling: Number(rows[0]?.cooling_count || 0),
                dormant: Number(rows[0]?.dormant_count || 0),
                never: Number(rows[0]?.never_count || 0),
                amount: Number(rows[0]?.total_lifetime_amount || 0)
            });
        } catch (error: any) {
            console.error('Error cargando candidatos:', error);
            setErrorMessage(error?.message || 'No se pudieron cargar los candidatos.');
        } finally {
            setLoading(false);
        }
    }, [profile?.id, buildParams, currentPage]);

    useEffect(() => {
        void fetchCandidates();
    }, [fetchCandidates]);

    useEffect(() => {
        if (!profile?.id) return;

        void (async () => {
            const [{ data: perfiles }, { data: carga }] = await Promise.all([
                supabase
                    .from('profiles')
                    .select('id, full_name, email, role')
                    .eq('status', 'active')
                    .in('role', ['seller', 'jefe', 'admin']),
                supabase.rpc('reactivation_workload_summary' as any)
            ]);

            setSellers((perfiles || []).map((p: any) => ({
                id: p.id,
                nombre: p.full_name || p.email,
                rol: String(p.role || '').toLowerCase()
            })));
            setWorkload((carga || []) as Workload[]);
        })();
    }, [profile?.id]);

    const totalPages = Math.max(1, Math.ceil(totals.total / CANDIDATES_PAGE_SIZE));

    const alternarSeleccion = (candidato: Candidate) => {
        setSelected((previa) => {
            const copia = new Map(previa);
            if (copia.has(candidato.client_id)) copia.delete(candidato.client_id);
            else copia.set(candidato.client_id, candidato);
            return copia;
        });
    };

    const seleccionarPagina = () => {
        setSelected((previa) => {
            const copia = new Map(previa);
            candidates.forEach((c) => copia.set(c.client_id, c));
            return copia;
        });
    };

    const seleccionarTodoFiltrado = async () => {
        setLoading(true);
        try {
            const recogidos: Candidate[] = [];
            let page = 1;
            let total = Infinity;

            while (recogidos.length < total && page <= 50) {
                const { data, error } = await supabase.rpc(
                    'search_reactivation_candidates_paged',
                    buildParams(page, BATCH_SIZE) as any
                );
                if (error) throw error;

                const rows = (data || []) as any[];
                if (rows.length === 0) break;

                total = Number(rows[0]?.total_count || 0);
                recogidos.push(...rows.map((row) => row.candidate as Candidate));
                page += 1;
            }

            setSelected(new Map(recogidos.map((c) => [c.client_id, c])));
        } catch (error: any) {
            alert(`No se pudo seleccionar todo: ${error?.message || 'error desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    const seleccionados = useMemo(() => Array.from(selected.values()), [selected]);

    const ejecutarEnsayoHuerfanos = async (enSeco: boolean) => {
        setOrphanBusy(true);
        try {
            const { data, error } = await supabase.rpc('archive_orphan_clients', {
                p_owner_ids: null,
                p_dry_run: enSeco
            } as any);
            if (error) throw error;
            setOrphanPreview(data);
            if (!enSeco) {
                alert(`Archivado ejecutado. Clientes archivados: ${(data as any)?.archivados ?? 0}.`);
                void fetchCandidates();
            }
        } catch (error: any) {
            alert(`No se pudo procesar la cartera huérfana: ${error?.message || 'error desconocido'}`);
        } finally {
            setOrphanBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
                {([
                    { id: 'candidatos', label: 'Candidatos' },
                    { id: 'carga', label: 'Carga del equipo' },
                    { id: 'huerfanos', label: 'Cartera huérfana' }
                ] as Array<{ id: SubTab; label: string }>).map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setSubTab(tab.id)}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                            subTab === tab.id ? 'bg-slate-800 text-white' : 'bg-white border border-gray-100 text-gray-500'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {subTab === 'candidatos' && (
                <>
                    <div className="premium-card p-6 space-y-4">
                        <div className="flex flex-col lg:flex-row gap-3">
                            <div className="flex-1 relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Buscar por nombre, RUT o comuna..."
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <select
                                value={segmentFilter}
                                onChange={(event) => setSegmentFilter(event.target.value as any)}
                                className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold outline-none"
                            >
                                <option value="all">Todos los segmentos</option>
                                <option value="cooling">Enfriándose</option>
                                <option value="dormant">Dormidos</option>
                                <option value="never_contacted">Sin contacto</option>
                            </select>
                            <select
                                value={ownerStatusFilter}
                                onChange={(event) => setOwnerStatusFilter(event.target.value as any)}
                                className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold outline-none"
                            >
                                <option value="all">Cualquier dueño</option>
                                <option value="active">Vendedor activo</option>
                                <option value="inactive">Vendedor dado de baja</option>
                            </select>
                            <select
                                value={String(minAmount)}
                                onChange={(event) => setMinAmount(Number(event.target.value))}
                                className="px-4 py-3 rounded-xl border border-gray-200 text-sm font-bold outline-none"
                            >
                                <option value="0">Cualquier monto</option>
                                <option value="500000">Desde $500.000</option>
                                <option value="2000000">Desde $2.000.000</option>
                                <option value="5000000">Desde $5.000.000</option>
                            </select>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-gray-500">
                            <span>{totals.total} candidato(s)</span>
                            <span className="text-amber-600">{totals.cooling} enfriándose</span>
                            <span className="text-rose-600">{totals.dormant} dormidos</span>
                            <span className="text-slate-500">{totals.never} sin contacto</span>
                            <span className="text-indigo-600">{formatMoney(totals.amount)} en juego</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <button onClick={seleccionarPagina}
                                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-black uppercase tracking-wider text-gray-600 hover:bg-gray-50">
                                Seleccionar página
                            </button>
                            <button onClick={() => void seleccionarTodoFiltrado()} disabled={loading}
                                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-black uppercase tracking-wider text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                                Seleccionar todo lo filtrado
                            </button>
                            {selected.size > 0 && (
                                <>
                                    <button onClick={() => setSelected(new Map())}
                                        className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-black uppercase tracking-wider text-gray-400 hover:bg-gray-50">
                                        Limpiar ({selected.size})
                                    </button>
                                    <button onClick={() => setAssignOpen(true)}
                                        className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-700">
                                        <UserCheck size={14} />
                                        Repartir {selected.size}
                                    </button>
                                </>
                            )}
                        </div>

                        {errorMessage && (
                            <div className="rounded-2xl border-2 border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
                                {errorMessage}
                            </div>
                        )}
                    </div>

                    <div className="premium-card overflow-hidden">
                        <div className="divide-y divide-gray-50">
                            {loading ? (
                                <div className="p-10 text-center text-gray-400 font-medium">Cargando candidatos...</div>
                            ) : candidates.length === 0 ? (
                                <div className="p-10 text-center text-gray-400 font-medium">
                                    No hay candidatos con estos filtros.
                                </div>
                            ) : candidates.map((candidato) => (
                                <label key={candidato.client_id}
                                    className="flex items-center gap-4 p-4 hover:bg-gray-50/50 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(candidato.client_id)}
                                        onChange={() => alternarSeleccion(candidato)}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-black text-gray-900 truncate">{candidato.name}</span>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${SEGMENT_STYLES[candidato.segment]}`}>
                                                {SEGMENT_LABELS[candidato.segment]}
                                            </span>
                                            {candidato.owner_status && candidato.owner_status !== 'active' && (
                                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-700">
                                                    Dueño dado de baja
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs font-bold text-gray-500 mt-1">
                                            {candidato.owner_name || 'Sin vendedor'} · sin comprar {formatDays(candidato.days_without_purchase)}
                                            {candidato.comuna ? ` · ${candidato.comuna}` : ''}
                                        </p>
                                    </div>
                                    <span className="text-sm font-black text-indigo-600 shrink-0">
                                        {formatMoney(candidato.lifetime_amount)}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {!loading && totals.total > CANDIDATES_PAGE_SIZE && (
                        <div className="flex items-center justify-between gap-4 rounded-3xl border border-gray-100 bg-white p-5">
                            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                Página {currentPage} de {totalPages}
                            </p>
                            <div className="flex items-center gap-3">
                                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}
                                    className="rounded-2xl border border-gray-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-600 disabled:opacity-30">
                                    Anterior
                                </button>
                                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                                    className="rounded-2xl border border-gray-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-600 disabled:opacity-30">
                                    Siguiente
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {subTab === 'carga' && (
                <div className="premium-card overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                        <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                            <Users size={18} className="text-indigo-600" />
                            Carga por vendedor
                        </h3>
                    </div>
                    {workload.length === 0 ? (
                        <div className="p-10 text-center text-gray-400 font-medium">
                            Todavía no hay casos repartidos.
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {workload.map((fila) => (
                                <div key={fila.seller_id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                                    <div>
                                        <p className="font-black text-gray-900">{fila.seller_name}</p>
                                        <p className="text-xs font-bold text-gray-500 mt-1">
                                            {fila.open_cases} abierto(s) · {fila.avg_attempts} intentos de media
                                            {fila.stale_cases > 0 && (
                                                <span className="text-amber-600"> · {fila.stale_cases} sin gestionar</span>
                                            )}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-emerald-600">
                                            {fila.won_month} reactivado(s) este mes
                                        </p>
                                        <p className="text-xs font-bold text-gray-500">
                                            {formatMoney(fila.won_month_amount)} recuperados
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {subTab === 'huerfanos' && (
                <div className="premium-card p-6 space-y-5">
                    <div>
                        <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                            <Archive size={18} className="text-slate-600" />
                            Cartera de vendedores dados de baja
                        </h3>
                        <p className="text-sm font-medium text-gray-500 mt-1">
                            Quien alguna vez compró o cotizó se reasigna, porque tiene historial que justifica
                            reactivarlo. Quien nunca hizo ninguna de las dos cosas se archiva y deja de contar
                            como cartera.
                        </p>
                    </div>

                    <button
                        onClick={() => void ejecutarEnsayoHuerfanos(true)}
                        disabled={orphanBusy}
                        className="flex items-center gap-2 rounded-2xl border border-gray-200 px-5 py-3 text-xs font-black uppercase tracking-widest text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                    >
                        <RefreshCw size={14} className={orphanBusy ? 'animate-spin' : ''} />
                        Calcular en seco
                    </button>

                    {orphanPreview && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="rounded-2xl bg-gray-50 p-4">
                                    <p className="text-2xl font-black text-gray-900">{orphanPreview.a_archivar ?? orphanPreview.archivados ?? 0}</p>
                                    <p className="text-xs font-bold text-gray-500">a archivar</p>
                                </div>
                                <div className="rounded-2xl bg-gray-50 p-4">
                                    <p className="text-2xl font-black text-gray-900">{orphanPreview.a_reasignar ?? 0}</p>
                                    <p className="text-xs font-bold text-gray-500">a reasignar</p>
                                </div>
                                <div className="rounded-2xl bg-indigo-50 p-4">
                                    <p className="text-2xl font-black text-indigo-700">{formatMoney(orphanPreview.monto_en_juego)}</p>
                                    <p className="text-xs font-bold text-indigo-600">facturación a reasignar</p>
                                </div>
                            </div>

                            {canArchive && orphanPreview.ensayo && Number(orphanPreview.a_archivar || 0) > 0 && (
                                <button
                                    onClick={() => {
                                        if (!window.confirm(
                                            `Vas a archivar ${orphanPreview.a_archivar} cliente(s) sin compras ni cotizaciones.\n\n`
                                            + 'Dejarán de contar como cartera y de aparecer en los indicadores. Es reversible.\n\n¿Continuar?'
                                        )) return;
                                        void ejecutarEnsayoHuerfanos(false);
                                    }}
                                    disabled={orphanBusy}
                                    className="rounded-2xl bg-slate-800 px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-900 disabled:opacity-40"
                                >
                                    Archivar {orphanPreview.a_archivar} cliente(s)
                                </button>
                            )}

                            <p className="text-[11px] font-medium text-gray-400 leading-tight">
                                Los que se reasignan no se tocan aquí: selecciónalos en la pestaña de candidatos
                                filtrando por dueño dado de baja y repártelos como cualquier otro caso.
                            </p>
                        </div>
                    )}
                </div>
            )}

            <ReactivationAssignModal
                isOpen={assignOpen}
                candidates={seleccionados}
                sellers={sellers}
                onClose={() => setAssignOpen(false)}
                onAssigned={() => {
                    setSelected(new Map());
                    void fetchCandidates();
                }}
            />
        </div>
    );
};

export default ReactivationConsole;
