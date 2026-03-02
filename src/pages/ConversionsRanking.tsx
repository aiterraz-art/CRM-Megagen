import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { Calendar, Crown, Trophy, Medal } from 'lucide-react';

type RankingRow = {
    sellerId: string;
    sellerName: string;
    conversions: number;
    conversionPct: number;
    coldVisits: number;
};

const toInputDate = (d: Date) => {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const ConversionsRanking = () => {
    const [loading, setLoading] = useState(true);
    const [preset, setPreset] = useState<'month' | '30d' | 'custom'>('month');
    const [fromDate, setFromDate] = useState(() => {
        const now = new Date();
        return toInputDate(new Date(now.getFullYear(), now.getMonth(), 1));
    });
    const [toDate, setToDate] = useState(() => toInputDate(new Date()));
    const [ranking, setRanking] = useState<RankingRow[]>([]);

    useEffect(() => {
        if (preset === 'month') {
            const now = new Date();
            setFromDate(toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)));
            setToDate(toInputDate(now));
        }
        if (preset === '30d') {
            const now = new Date();
            const start = new Date();
            start.setDate(now.getDate() - 29);
            setFromDate(toInputDate(start));
            setToDate(toInputDate(now));
        }
    }, [preset]);

    useEffect(() => {
        fetchRanking();
    }, [fromDate, toDate]);

    const fetchRanking = async () => {
        setLoading(true);
        try {
            const fromIso = new Date(`${fromDate}T00:00:00`).toISOString();
            const toIso = new Date(`${toDate}T23:59:59.999`).toISOString();

            const { data: sellers, error: sellersError } = await supabase
                .from('profiles')
                .select('id, full_name, email, role')
                .in('role', ['seller']);

            if (sellersError) throw sellersError;

            const sellerRows = (sellers || []) as Array<{ id: string; full_name: string | null; email: string | null }>;
            if (sellerRows.length === 0) {
                setRanking([]);
                return;
            }

            const sellerIds = sellerRows.map((s) => s.id);

            const { data: visits, error: visitsError } = await supabase
                .from('visits')
                .select('sales_rep_id, client_id, check_in_time, type')
                .in('sales_rep_id', sellerIds)
                .eq('type', 'cold_visit')
                .gte('check_in_time', fromIso)
                .lte('check_in_time', toIso);

            if (visitsError) throw visitsError;

            const coldVisits = (visits || []) as Array<{ sales_rep_id: string | null; client_id: string | null; check_in_time: string | null }>;

            const bySeller = new Map<string, { coldVisits: number; clientFirstVisit: Map<string, number> }>();
            sellerIds.forEach((id) => bySeller.set(id, { coldVisits: 0, clientFirstVisit: new Map() }));

            coldVisits.forEach((row) => {
                if (!row.sales_rep_id || !bySeller.has(row.sales_rep_id)) return;
                const sellerData = bySeller.get(row.sales_rep_id)!;
                sellerData.coldVisits += 1;

                if (!row.client_id || !row.check_in_time) return;
                const at = new Date(row.check_in_time).getTime();
                const previous = sellerData.clientFirstVisit.get(row.client_id);
                if (previous === undefined || at < previous) {
                    sellerData.clientFirstVisit.set(row.client_id, at);
                }
            });

            const clientIds = Array.from(
                new Set(Array.from(bySeller.values()).flatMap((v) => Array.from(v.clientFirstVisit.keys())))
            );

            const clientsMap = new Map<string, { status: string | null; updated_at: string | null }>();
            if (clientIds.length > 0) {
                const { data: clients, error: clientsError } = await supabase
                    .from('clients')
                    .select('id, status, updated_at')
                    .in('id', clientIds);

                if (clientsError) throw clientsError;

                (clients || []).forEach((c: any) => {
                    clientsMap.set(c.id, { status: c.status, updated_at: c.updated_at });
                });
            }

            const result: RankingRow[] = sellerRows.map((seller) => {
                const stats = bySeller.get(seller.id) || { coldVisits: 0, clientFirstVisit: new Map<string, number>() };
                let conversions = 0;

                stats.clientFirstVisit.forEach((firstVisitAt, clientId) => {
                    const clientData = clientsMap.get(clientId);
                    if (!clientData || clientData.status !== 'active') return;
                    const updatedAt = clientData.updated_at ? new Date(clientData.updated_at).getTime() : 0;
                    if (updatedAt >= firstVisitAt) conversions += 1;
                });

                const conversionPct = stats.coldVisits > 0 ? Math.round((conversions / stats.coldVisits) * 100) : 0;

                return {
                    sellerId: seller.id,
                    sellerName: seller.full_name || seller.email || seller.id,
                    conversions,
                    conversionPct,
                    coldVisits: stats.coldVisits
                };
            });

            result.sort((a, b) => {
                if (b.conversions !== a.conversions) return b.conversions - a.conversions;
                if (b.conversionPct !== a.conversionPct) return b.conversionPct - a.conversionPct;
                return a.sellerName.localeCompare(b.sellerName);
            });

            setRanking(result);
        } catch (error: any) {
            console.error('Error loading conversions ranking:', error);
            alert(`Error cargando ranking de conversiones: ${error.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    const leader = useMemo(() => ranking[0] || null, [ranking]);

    if (loading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent animate-spin rounded-full"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-6xl mx-auto pb-12">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                        <Trophy className="text-amber-500" /> Ranking de Conversiones
                    </h1>
                    <p className="text-gray-500 font-medium mt-1">Competencia comercial por conversiones de visitas en frío.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setPreset('month')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase ${preset === 'month' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>Mes actual</button>
                    <button onClick={() => setPreset('30d')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase ${preset === '30d' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>30 días</button>
                    <button onClick={() => setPreset('custom')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase ${preset === 'custom' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>Personalizado</button>
                </div>
            </div>

            <div className="premium-card p-5 border border-gray-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="relative">
                        <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input type="date" value={fromDate} onChange={(e) => { setPreset('custom'); setFromDate(e.target.value); }} className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-100 bg-white font-bold text-sm" />
                    </div>
                    <div className="relative">
                        <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input type="date" value={toDate} onChange={(e) => { setPreset('custom'); setToDate(e.target.value); }} className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-100 bg-white font-bold text-sm" />
                    </div>
                </div>
            </div>

            {leader ? (
                <div className="premium-card p-6 border border-amber-200 bg-amber-50/60">
                    <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">Líder actual</p>
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center">
                                <Crown size={22} />
                            </div>
                            <div>
                                <p className="text-lg font-black text-gray-900">{leader.sellerName}</p>
                                <p className="text-xs font-bold text-gray-500 uppercase">{leader.conversionPct}% efectividad</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Conversiones</p>
                            <p className="text-3xl font-black text-amber-600">{leader.conversions}</p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="premium-card p-6 text-center text-gray-500 font-bold">No hay datos de conversión en el rango seleccionado.</div>
            )}

            <div className="premium-card overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <p className="col-span-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">Posición</p>
                    <p className="col-span-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Vendedor</p>
                    <p className="col-span-2 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Conversiones</p>
                    <p className="col-span-2 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Efectividad</p>
                </div>

                {ranking.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 font-bold">Sin conversiones registradas.</div>
                ) : ranking.map((row, index) => {
                    const rank = index + 1;
                    const rankBadge = rank === 1
                        ? 'bg-yellow-100 text-yellow-700'
                        : rank === 2
                            ? 'bg-slate-200 text-slate-700'
                            : rank === 3
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-gray-100 text-gray-600';

                    return (
                        <div key={row.sellerId} className="grid grid-cols-12 gap-2 px-6 py-4 border-b border-gray-50 items-center">
                            <div className="col-span-2">
                                <span className={`inline-flex min-w-10 justify-center px-3 py-1 rounded-lg text-xs font-black ${rankBadge}`}>#{rank}</span>
                            </div>
                            <p className="col-span-6 font-black text-gray-900 truncate">{row.sellerName}</p>
                            <p className="col-span-2 text-right font-black text-indigo-600">{row.conversions}</p>
                            <p className="col-span-2 text-right text-sm font-bold text-gray-600">{row.conversionPct}%</p>
                        </div>
                    );
                })}
            </div>

            <div className="text-center text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                Ranking calculado con visitas tipo cold_visit convertidas a cliente activo
            </div>
        </div>
    );
};

export default ConversionsRanking;
