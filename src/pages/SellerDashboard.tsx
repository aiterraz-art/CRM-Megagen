import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Calendar, MapPin, Target, TrendingUp, Clock, Filter, Award, Medal, Trophy } from 'lucide-react';
import KPICard from '../components/KPICard';
import GoalProgressChart from '../components/charts/GoalProgressChart';

type VisitRow = {
    id: string;
    check_in_time: string | null;
    check_out_time: string | null;
    status: string | null;
    type?: string | null;
    notes: string | null;
    client_id?: string | null;
    clients?: { name?: string | null; comuna?: string | null; zone?: string | null; status?: string | null } | null;
};

type DailySeries = { date: string; label: string; visits: number };

const DEFAULT_DAILY_VISITS_GOAL = Number(import.meta.env.VITE_DAILY_VISITS_GOAL || 8);

const toInputDate = (d: Date) => {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const SellerDashboard = () => {
    const { profile } = useUser();
    const [loading, setLoading] = useState(true);
    const [preset, setPreset] = useState<'today' | '7d' | '30d' | 'custom'>('7d');

    const [fromDate, setFromDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return toInputDate(d);
    });
    const [toDate, setToDate] = useState(() => toInputDate(new Date()));

    const [todayVisits, setTodayVisits] = useState(0);
    const [todayCompletedVisits, setTodayCompletedVisits] = useState(0);
    const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_VISITS_GOAL);
    const [monthSales, setMonthSales] = useState(0);
    const [monthGoal, setMonthGoal] = useState(0);
    const [visitSeries, setVisitSeries] = useState<DailySeries[]>([]);
    const [recentVisits, setRecentVisits] = useState<VisitRow[]>([]);
    const [coldVisitsTotal, setColdVisitsTotal] = useState(0);
    const [coldVisitsConverted, setColdVisitsConverted] = useState(0);

    useEffect(() => {
        if (preset === 'today') {
            const today = toInputDate(new Date());
            setFromDate(today);
            setToDate(today);
        }
        if (preset === '7d') {
            const d = new Date();
            const end = toInputDate(d);
            d.setDate(d.getDate() - 6);
            setFromDate(toInputDate(d));
            setToDate(end);
        }
        if (preset === '30d') {
            const d = new Date();
            const end = toInputDate(d);
            d.setDate(d.getDate() - 29);
            setFromDate(toInputDate(d));
            setToDate(end);
        }
    }, [preset]);

    useEffect(() => {
        if (!profile?.id) return;
        fetchData();
    }, [profile?.id, fromDate, toDate]);

    const fetchData = async () => {
        if (!profile?.id) return;
        setLoading(true);

        try {
            const rangeStart = new Date(`${fromDate}T00:00:00`);
            const rangeEnd = new Date(`${toDate}T23:59:59.999`);

            const today = toInputDate(new Date());
            const todayStart = new Date(`${today}T00:00:00`);
            const todayEnd = new Date(`${today}T23:59:59.999`);

            const [{ data: rangeVisits, error: rangeError }, { data: todayRows, error: todayError }, { data: monthOrders }, { data: goalRow }, { data: coldRows, error: coldError }] = await Promise.all([
                supabase
                    .from('visits')
                    .select('id, check_in_time, check_out_time, status, type, notes, client_id, clients(name, comuna, zone, status)')
                    .eq('sales_rep_id', profile.id)
                    .gte('check_in_time', rangeStart.toISOString())
                    .lte('check_in_time', rangeEnd.toISOString())
                    .order('check_in_time', { ascending: false }),
                supabase
                    .from('visits')
                    .select('id, status')
                    .eq('sales_rep_id', profile.id)
                    .gte('check_in_time', todayStart.toISOString())
                    .lte('check_in_time', todayEnd.toISOString()),
                (() => {
                    const now = new Date();
                    const monthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0));
                    const monthEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999));
                    return supabase
                        .from('orders')
                        .select('total_amount, status, created_at')
                        .eq('user_id', profile.id)
                        .not('quotation_id', 'is', null)
                        .gte('created_at', monthStart.toISOString())
                        .lte('created_at', monthEnd.toISOString());
                })(),
                (() => {
                    const now = new Date();
                    return supabase
                        .from('goals')
                        .select('target_amount, daily_visits_goal')
                        .eq('user_id', profile.id)
                        .eq('month', now.getMonth() + 1)
                        .eq('year', now.getFullYear())
                        .maybeSingle();
                })(),
                supabase
                    .from('visits')
                    .select('id, client_id, check_in_time, type, clients(status)')
                    .eq('sales_rep_id', profile.id)
                    .eq('type', 'cold_visit')
                    .gte('check_in_time', rangeStart.toISOString())
                    .lte('check_in_time', rangeEnd.toISOString()),
            ]);

            if (rangeError) throw rangeError;
            if (todayError) throw todayError;
            if (coldError) throw coldError;

            const visits = (rangeVisits || []) as VisitRow[];
            setRecentVisits(visits.slice(0, 10));

            const seriesMap = new Map<string, number>();
            for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
                const key = toInputDate(d);
                seriesMap.set(key, 0);
            }

            visits.forEach((v) => {
                if (!v.check_in_time) return;
                const dayKey = v.check_in_time.split('T')[0];
                seriesMap.set(dayKey, (seriesMap.get(dayKey) || 0) + 1);
            });

            const builtSeries: DailySeries[] = Array.from(seriesMap.entries()).map(([date, count]) => ({
                date,
                label: date.slice(5),
                visits: count,
            }));
            setVisitSeries(builtSeries);

            const todayData = todayRows || [];
            setTodayVisits(todayData.length);
            setTodayCompletedVisits(todayData.filter(v => v.status === 'completed').length);

            let monthlySalesAmount = 0;
            (monthOrders || []).forEach((o: any) => {
                if (o.status !== 'cancelled' && o.status !== 'rejected') {
                    monthlySalesAmount += Number(o.total_amount || 0);
                }
            });
            setMonthSales(monthlySalesAmount);
            setMonthGoal(Number((goalRow as any)?.target_amount) || 0);
            setDailyGoal(Number((goalRow as any)?.daily_visits_goal) || DEFAULT_DAILY_VISITS_GOAL);

            const coldVisits = (coldRows || []) as Array<{ id: string; client_id: string | null; check_in_time?: string | null }>;
            const firstColdVisitByClient = new Map<string, number>();
            for (const row of coldVisits) {
                if (!row.client_id || !row.check_in_time) continue;
                const visitAt = new Date(row.check_in_time).getTime();
                const previous = firstColdVisitByClient.get(row.client_id);
                if (previous === undefined || visitAt < previous) {
                    firstColdVisitByClient.set(row.client_id, visitAt);
                }
            }

            const coldClientIds = Array.from(firstColdVisitByClient.keys());
            let convertedCount = 0;
            if (coldClientIds.length > 0) {
                const { data: coldClients, error: coldClientsError } = await supabase
                    .from('clients')
                    .select('id, status, updated_at')
                    .in('id', coldClientIds);
                if (coldClientsError) throw coldClientsError;

                convertedCount = (coldClients || []).filter((client) => {
                    if (client.status !== 'active') return false;
                    const convertedAt = client.updated_at ? new Date(client.updated_at).getTime() : 0;
                    const firstVisitAt = firstColdVisitByClient.get(client.id) || 0;
                    return convertedAt >= firstVisitAt;
                }).length;
            }

            setColdVisitsTotal(coldVisits.length);
            setColdVisitsConverted(convertedCount);
        } catch (e) {
            console.error('SellerDashboard error:', e);
            alert(`Error cargando dashboard vendedor: ${(e as any)?.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    const avgVisits = useMemo(() => {
        if (visitSeries.length === 0) return 0;
        return Number((visitSeries.reduce((sum, v) => sum + v.visits, 0) / visitSeries.length).toFixed(1));
    }, [visitSeries]);

    const todayGoalPct = Math.min(100, Math.round((todayVisits / Math.max(dailyGoal, 1)) * 100));
    const coldConversionPct = coldVisitsTotal > 0 ? Math.round((coldVisitsConverted / coldVisitsTotal) * 100) : 0;
    const maxBar = Math.max(1, ...visitSeries.map(v => v.visits));
    const medal = useMemo(() => {
        if (coldConversionPct >= 75 && coldVisitsConverted >= 15) {
            return {
                label: 'Master Hunter Megagen',
                level: 'Oro',
                className: 'bg-yellow-100 text-yellow-600 border-yellow-200 animate-pulse',
                icon: Trophy
            };
        }
        if (coldConversionPct >= 50 && coldVisitsConverted >= 10) {
            return {
                label: 'Experto en Frío',
                level: 'Plata',
                className: 'bg-slate-200 text-slate-700 border-slate-300',
                icon: Medal
            };
        }
        if (coldConversionPct >= 30 && coldVisitsConverted >= 5) {
            return {
                label: 'Cazador Inicial',
                level: 'Bronce',
                className: 'bg-orange-100 text-orange-700 border-orange-200',
                icon: Award
            };
        }
        return null;
    }, [coldConversionPct, coldVisitsConverted]);

    if (loading) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent animate-spin rounded-full"></div>
                <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Cargando Dashboard de Vendedor...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 w-full mx-auto px-4 pb-12">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight">Mi Dashboard Comercial</h1>
                    <p className="text-gray-500 font-medium mt-1">Seguimiento de metas, visitas diarias e histórico personal.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {medal && (
                        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border font-black ${medal.className}`}>
                            <medal.icon size={16} />
                            <div className="leading-tight">
                                <p className="text-[10px] uppercase tracking-wider">{medal.level}</p>
                                <p className="text-xs">{medal.label}</p>
                            </div>
                        </div>
                    )}
                    <button onClick={() => setPreset('today')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === 'today' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>Hoy</button>
                    <button onClick={() => setPreset('7d')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === '7d' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>7 días</button>
                    <button onClick={() => setPreset('30d')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === '30d' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>30 días</button>
                    <button onClick={() => setPreset('custom')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === 'custom' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>Personalizado</button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard title="Visitas Hoy" value={todayVisits} icon={MapPin} color="emerald" trend={`${todayCompletedVisits} completadas`} trendUp />
                <KPICard title="Meta Diaria" value={`${todayGoalPct}%`} icon={Target} color="indigo" trend={`${todayVisits}/${dailyGoal} visitas`} trendUp={todayGoalPct >= 100} />
                <KPICard title="Promedio Diario" value={avgVisits} icon={TrendingUp} color="amber" trend={`Rango ${fromDate} a ${toDate}`} trendUp={avgVisits >= dailyGoal} />
                <KPICard title="Venta Mes" value={`$${monthSales.toLocaleString()}`} icon={Clock} color="blue" trend={monthGoal > 0 ? `${Math.round((monthSales / monthGoal) * 100)}% de meta` : 'Sin meta cargada'} trendUp={monthGoal > 0 && monthSales >= monthGoal} />
            </div>
            <div className="grid grid-cols-1 gap-6">
                <KPICard
                    title="Conversión Prospección"
                    value={`${coldConversionPct}%`}
                    icon={Target}
                    color="indigo"
                    trend={`${coldVisitsConverted}/${coldVisitsTotal} prospectos convertidos`}
                    trendUp={coldConversionPct >= 40}
                />
            </div>
            <div className="premium-card p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <h3 className="text-lg font-black text-gray-900 flex items-center"><Filter size={18} className="mr-2 text-indigo-600" />Filtro histórico</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative">
                            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input type="date" value={fromDate} onChange={(e) => { setPreset('custom'); setFromDate(e.target.value); }} className="pl-9 pr-3 py-2 bg-white border border-gray-100 rounded-xl text-sm font-bold" />
                        </div>
                        <span className="text-xs text-gray-400 font-black uppercase">a</span>
                        <div className="relative">
                            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input type="date" value={toDate} onChange={(e) => { setPreset('custom'); setToDate(e.target.value); }} className="pl-9 pr-3 py-2 bg-white border border-gray-100 rounded-xl text-sm font-bold" />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="xl:col-span-2 premium-card p-5 border border-gray-50">
                        <h4 className="font-black text-gray-900 mb-4">Visitas por día</h4>
                        <div className="h-56 flex items-end gap-2">
                            {visitSeries.length === 0 ? (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">Sin visitas en el rango seleccionado.</div>
                            ) : (
                                visitSeries.map((point) => (
                                    <div key={point.date} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-2">
                                        <div
                                            className="w-full max-w-8 bg-indigo-500/90 rounded-t-md transition-all"
                                            style={{ height: `${Math.max(8, (point.visits / maxBar) * 160)}px` }}
                                            title={`${point.date}: ${point.visits} visitas`}
                                        />
                                        <span className="text-[10px] text-gray-400 font-bold">{point.label}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="premium-card p-5 border border-gray-50">
                        <h4 className="font-black text-gray-900 mb-2">Metas</h4>
                        <GoalProgressChart current={monthSales} target={monthGoal || 1} />
                        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider">Meta diaria visitas</p>
                            <div className="mt-2 flex items-center gap-2">
                                <span className="inline-flex px-3 py-2 rounded-lg border border-emerald-200 font-black text-emerald-700 bg-white">
                                    {dailyGoal}
                                </span>
                                <span className="text-xs text-emerald-700 font-bold">visitas/día</span>
                            </div>
                            <p className="mt-2 text-[10px] text-emerald-700/80 font-bold">Configurada por jefe/admin en Mi Equipo.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="premium-card overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                    <h3 className="text-lg font-black text-gray-900">Últimas visitas</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white border-b border-gray-50">
                            <tr>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Fecha</th>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cliente</th>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Ubicación</th>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Estado</th>
                                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Notas</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recentVisits.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-10 text-center text-gray-400 italic">No hay visitas en el rango seleccionado.</td>
                                </tr>
                            ) : (
                                recentVisits.map((v) => (
                                    <tr key={v.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/40">
                                        <td className="px-6 py-4 text-sm font-bold text-gray-800">{v.check_in_time ? new Date(v.check_in_time).toLocaleString() : '-'}</td>
                                        <td className="px-6 py-4 text-sm font-bold text-gray-900">{v.clients?.name || 'Sin cliente'}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">{v.clients?.comuna || v.clients?.zone || '-'}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${v.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                                                {v.status === 'completed' ? 'Completada' : 'En curso'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-xs text-gray-600">{v.notes || 'Sin notas'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SellerDashboard;
