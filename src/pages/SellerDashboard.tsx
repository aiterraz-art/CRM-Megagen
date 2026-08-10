import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Calendar, ClipboardList, Filter, MapPin, ShoppingBag, ShoppingCart, TrendingUp } from 'lucide-react';
import KPICard from '../components/KPICard';
import GoalProgressChart from '../components/charts/GoalProgressChart';
import { grossToNet } from '../utils/amounts';
import { getPreviousBusinessDay } from '../utils/businessDate';

type VisitRow = {
    id: string;
    check_in_time: string | null;
    check_out_time: string | null;
    status: string | null;
    notes: string | null;
    client_id?: string | null;
    clients?: { id?: string | null; name?: string | null; comuna?: string | null; zone?: string | null } | null;
};

type DailySeries = { date: string; label: string; visits: number };

type TodayMetrics = {
    visits: number;
    completedVisits: number;
    billedSales: number;
};

type MonthMetrics = {
    billedSales: number;
    averageDailySales: number;
    goal: number;
    commissionRate: number;
    dailyVisitsGoal: number;
};

type PendingVisitItem = {
    id: string;
    clientId: string;
    clientName: string;
    visitTime: string;
    comunaOrZone: string;
};

type PendingQuotationItem = {
    id: string;
    folio: number | null;
    clientName: string;
    createdAt: string;
    totalNet: number;
};

const DEFAULT_DAILY_VISITS_GOAL = Number(import.meta.env.VITE_DAILY_VISITS_GOAL || 8);

const toInputDate = (d: Date) => {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const startOfDayLocal = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
};

const endOfDayLocal = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
};

const getDateKeyFromIso = (value: string | null | undefined) => {
    if (!value) return '';
    return toInputDate(new Date(value));
};

const formatCurrency = (value: number) => `$${Math.round(value || 0).toLocaleString('es-CL')}`;
const isBillableOrderStatus = (status: string | null | undefined) =>
    String(status || '').toLowerCase() !== 'cancelled';

const countBusinessDaysInclusive = (from: Date, to: Date) => {
    if (from > to) return 0;
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);

    let count = 0;
    while (cursor <= end) {
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) count += 1;
        cursor.setDate(cursor.getDate() + 1);
    }

    return count;
};

const SellerDashboard = () => {
    const navigate = useNavigate();
    const { profile } = useUser();
    const [loading, setLoading] = useState(true);
    const [preset, setPreset] = useState<'today' | '7d' | '30d' | 'custom'>('7d');

    const [fromDate, setFromDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return toInputDate(d);
    });
    const [toDate, setToDate] = useState(() => toInputDate(new Date()));

    const [visitSeries, setVisitSeries] = useState<DailySeries[]>([]);
    const [recentVisits, setRecentVisits] = useState<VisitRow[]>([]);
    const [todayMetrics, setTodayMetrics] = useState<TodayMetrics>({
        visits: 0,
        completedVisits: 0,
        billedSales: 0,
    });
    const [monthMetrics, setMonthMetrics] = useState<MonthMetrics>({
        billedSales: 0,
        averageDailySales: 0,
        goal: 0,
        commissionRate: 0,
        dailyVisitsGoal: DEFAULT_DAILY_VISITS_GOAL,
    });
    const [pendingVisits, setPendingVisits] = useState<PendingVisitItem[]>([]);
    const [pendingQuotations, setPendingQuotations] = useState<PendingQuotationItem[]>([]);

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
        void fetchData();
    }, [profile?.id, fromDate, toDate]);

    useEffect(() => {
        if (!profile?.id) return;

        const subscription = supabase
            .channel(`seller-dashboard-goals-${profile.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'goals' }, (payload) => {
                const changedRow = payload.new || payload.old;
                if (changedRow && 'user_id' in changedRow && changedRow.user_id !== profile.id) return;
                void fetchData();
            })
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [profile?.id, fromDate, toDate]);

    const fetchData = async () => {
        if (!profile?.id) return;
        setLoading(true);

        try {
            const now = new Date();
            const todayStart = startOfDayLocal(now);
            const todayEnd = endOfDayLocal(now);

            const yesterday = getPreviousBusinessDay(now);
            const yesterdayStart = startOfDayLocal(yesterday);
            const yesterdayEnd = endOfDayLocal(yesterday);

            const monthStart = startOfDayLocal(new Date(now.getFullYear(), now.getMonth(), 1));
            const daysElapsedInMonth = now.getDate();

            const rangeStart = startOfDayLocal(new Date(`${fromDate}T00:00:00`));
            const rangeEnd = endOfDayLocal(new Date(`${toDate}T00:00:00`));

            const [
                { data: rangeVisits, error: rangeError },
                { data: todayVisitRows, error: todayVisitsError },
                { data: todayOrdersRows, error: todayOrdersError },
                { data: monthOrdersRows, error: monthOrdersError },
                { data: goalRow, error: goalError },
                { data: yesterdayVisitRows, error: yesterdayVisitsError },
                { data: yesterdayQuotationRows, error: yesterdayQuotationsError },
            ] = await Promise.all([
                supabase
                    .from('visits')
                    .select('id, check_in_time, check_out_time, status, notes, client_id, clients(id, name, comuna, zone)')
                    .eq('sales_rep_id', profile.id)
                    .gte('check_in_time', rangeStart.toISOString())
                    .lte('check_in_time', rangeEnd.toISOString())
                    .neq('status', 'cancelled')
                    .order('check_in_time', { ascending: false }),
                supabase
                    .from('visits')
                    .select('id, status')
                    .eq('sales_rep_id', profile.id)
                    .gte('check_in_time', todayStart.toISOString())
                    .lte('check_in_time', todayEnd.toISOString())
                    .neq('status', 'cancelled'),
                supabase
                    .from('orders')
                    .select('id, total_amount, status, quotation_id, created_at')
                    .eq('user_id', profile.id)
                    .not('quotation_id', 'is', null)
                    .gte('created_at', todayStart.toISOString())
                    .lte('created_at', todayEnd.toISOString()),
                supabase
                    .from('orders')
                    .select('id, total_amount, status, quotation_id, created_at')
                    .eq('user_id', profile.id)
                    .not('quotation_id', 'is', null)
                    .gte('created_at', monthStart.toISOString())
                    .lte('created_at', todayEnd.toISOString()),
                supabase
                    .from('goals')
                    .select('target_amount, commission_rate, daily_visits_goal')
                    .eq('user_id', profile.id)
                    .eq('month', now.getMonth() + 1)
                    .eq('year', now.getFullYear())
                    .maybeSingle(),
                supabase
                    .from('visits')
                    .select('id, client_id, check_in_time, status, clients(id, name, comuna, zone)')
                    .eq('sales_rep_id', profile.id)
                    .eq('status', 'completed')
                    .not('client_id', 'is', null)
                    .gte('check_in_time', yesterdayStart.toISOString())
                    .lte('check_in_time', yesterdayEnd.toISOString())
                    .order('check_in_time', { ascending: true }),
                supabase
                    .from('quotations')
                    .select('id, folio, client_id, seller_id, status, total_amount, created_at, clients(name, comuna, zone)')
                    .eq('seller_id', profile.id)
                    .in('status', ['sent', 'approved'])
                    .gte('created_at', yesterdayStart.toISOString())
                    .lte('created_at', yesterdayEnd.toISOString())
                    .order('created_at', { ascending: false }),
            ]);

            if (rangeError) throw rangeError;
            if (todayVisitsError) throw todayVisitsError;
            if (todayOrdersError) throw todayOrdersError;
            if (monthOrdersError) throw monthOrdersError;
            if (goalError) throw goalError;
            if (yesterdayVisitsError) throw yesterdayVisitsError;
            if (yesterdayQuotationsError) throw yesterdayQuotationsError;

            const visits = (rangeVisits || []) as VisitRow[];
            setRecentVisits(visits.slice(0, 10));

            const seriesMap = new Map<string, number>();
            for (let d = new Date(rangeStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
                seriesMap.set(toInputDate(d), 0);
            }

            visits.forEach((visit) => {
                const dayKey = getDateKeyFromIso(visit.check_in_time);
                if (!dayKey) return;
                seriesMap.set(dayKey, (seriesMap.get(dayKey) || 0) + 1);
            });

            setVisitSeries(
                Array.from(seriesMap.entries()).map(([date, count]) => ({
                    date,
                    label: date.slice(5),
                    visits: count,
                }))
            );

            const sanitizedTodayOrders = (todayOrdersRows || []).filter(
                (order: any) => isBillableOrderStatus(order.status)
            );
            const todayBilledSales = sanitizedTodayOrders.reduce(
                (sum: number, order: any) => sum + grossToNet(order.total_amount),
                0
            );

            const sanitizedMonthOrders = (monthOrdersRows || []).filter(
                (order: any) => isBillableOrderStatus(order.status)
            );
            const monthBilledSales = sanitizedMonthOrders.reduce(
                (sum: number, order: any) => sum + grossToNet(order.total_amount),
                0
            );

            setTodayMetrics({
                visits: (todayVisitRows || []).length,
                completedVisits: (todayVisitRows || []).filter((visit: any) => visit.status === 'completed').length,
                billedSales: todayBilledSales,
            });

            setMonthMetrics({
                billedSales: monthBilledSales,
                averageDailySales: daysElapsedInMonth > 0 ? monthBilledSales / daysElapsedInMonth : 0,
                goal: Number(goalRow?.target_amount) || 0,
                commissionRate: Number(goalRow?.commission_rate) || 0,
                dailyVisitsGoal: Number(goalRow?.daily_visits_goal) || DEFAULT_DAILY_VISITS_GOAL,
            });

            const yesterdayVisits = (yesterdayVisitRows || []) as Array<{
                id: string;
                client_id: string | null;
                check_in_time: string | null;
                clients?: { id?: string | null; name?: string | null; comuna?: string | null; zone?: string | null } | null;
            }>;

            const yesterdayClientIds = Array.from(new Set(yesterdayVisits.map((visit) => visit.client_id).filter(Boolean))) as string[];

            let quotationsForVisitedClients: Array<{ client_id: string | null; created_at: string | null }> = [];
            if (yesterdayClientIds.length > 0) {
                const { data: quotationRows, error: quotationRowsError } = await supabase
                    .from('quotations')
                    .select('client_id, created_at')
                    .eq('seller_id', profile.id)
                    .in('client_id', yesterdayClientIds)
                    .gte('created_at', yesterdayStart.toISOString());

                if (quotationRowsError) throw quotationRowsError;
                quotationsForVisitedClients = (quotationRows || []) as Array<{ client_id: string | null; created_at: string | null }>;
            }

            const pendingVisitsRows = yesterdayVisits.filter((visit) => {
                if (!visit.client_id || !visit.check_in_time) return false;
                const visitTime = new Date(visit.check_in_time).getTime();

                return !quotationsForVisitedClients.some((quotation) => {
                    if (quotation.client_id !== visit.client_id || !quotation.created_at) return false;
                    return new Date(quotation.created_at).getTime() >= visitTime;
                });
            });

            setPendingVisits(
                pendingVisitsRows.map((visit) => ({
                    id: visit.id,
                    clientId: visit.client_id as string,
                    clientName: visit.clients?.name || 'Cliente sin nombre',
                    visitTime: visit.check_in_time || '',
                    comunaOrZone: visit.clients?.comuna || visit.clients?.zone || 'Sin ubicación',
                }))
            );

            const yesterdayQuotations = (yesterdayQuotationRows || []) as Array<{
                id: string;
                folio: number | null;
                total_amount: number | null;
                created_at: string | null;
                clients?: { name?: string | null } | null;
            }>;

            const quotationIds = yesterdayQuotations.map((quotation) => quotation.id);
            let convertedQuotationIds = new Set<string>();
            if (quotationIds.length > 0) {
                const { data: orderRows, error: orderRowsError } = await supabase
                    .from('orders')
                    .select('quotation_id, status')
                    .in('quotation_id', quotationIds);

                if (orderRowsError) throw orderRowsError;
                convertedQuotationIds = new Set(
                    (orderRows || [])
                        .filter((order: any) => String(order.status || '').toLowerCase() !== 'cancelled')
                        .map((order: any) => order.quotation_id)
                        .filter(Boolean)
                );
            }

            setPendingQuotations(
                yesterdayQuotations
                    .filter((quotation) => !convertedQuotationIds.has(quotation.id))
                    .map((quotation) => ({
                        id: quotation.id,
                        folio: quotation.folio,
                        clientName: quotation.clients?.name || 'Cliente sin nombre',
                        createdAt: quotation.created_at || '',
                        totalNet: grossToNet(quotation.total_amount),
                    }))
            );
        } catch (error: any) {
            console.error('SellerDashboard error:', error);
            alert(`Error cargando dashboard vendedor: ${error?.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    const maxBar = Math.max(1, ...visitSeries.map((point) => point.visits));
    const dailyGoalPct = Math.min(
        100,
        Math.round((todayMetrics.visits / Math.max(monthMetrics.dailyVisitsGoal, 1)) * 100)
    );

    const salesGoalPct = monthMetrics.goal > 0
        ? Math.round((monthMetrics.billedSales / monthMetrics.goal) * 100)
        : 0;
    const today = new Date();
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const remainingToGoal = Math.max(monthMetrics.goal - monthMetrics.billedSales, 0);
    const exceededGoalBy = Math.max(monthMetrics.billedSales - monthMetrics.goal, 0);
    const remainingBusinessDays = countBusinessDaysInclusive(today, monthEnd);
    const requiredDailySales = remainingToGoal > 0 && remainingBusinessDays > 0
        ? remainingToGoal / remainingBusinessDays
        : 0;
    const estimatedCommission = monthMetrics.billedSales * Math.max(monthMetrics.commissionRate, 0);
    const visitsRemainingToday = Math.max(monthMetrics.dailyVisitsGoal - todayMetrics.visits, 0);

    const limitedPendingVisits = useMemo(() => pendingVisits.slice(0, 5), [pendingVisits]);
    const limitedPendingQuotations = useMemo(() => pendingQuotations.slice(0, 5), [pendingQuotations]);

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
                    <p className="text-gray-500 font-medium mt-1">Seguimiento diario de visitas, cotizaciones y ventas personales.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setPreset('today')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === 'today' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>Hoy</button>
                    <button onClick={() => setPreset('7d')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === '7d' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>7 días</button>
                    <button onClick={() => setPreset('30d')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === '30d' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>30 días</button>
                    <button onClick={() => setPreset('custom')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${preset === 'custom' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>Personalizado</button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                <KPICard title="Visitas Hoy" value={todayMetrics.visits} icon={MapPin} color="emerald" trend={`${todayMetrics.completedVisits} completadas`} trendUp />
                <KPICard title="Facturado Hoy" value={formatCurrency(todayMetrics.billedSales)} icon={ShoppingCart} color="blue" trend="Monto facturado desde pedidos" trendUp={todayMetrics.billedSales > 0} />
                <KPICard title="Promedio Diario Mes" value={formatCurrency(monthMetrics.averageDailySales)} icon={TrendingUp} color="amber" trend="Promedio facturado mes actual" trendUp={monthMetrics.averageDailySales > 0} />
                <KPICard title="Visitas Ayer sin Cotizar" value={pendingVisits.length} icon={ClipboardList} color="indigo" trend="Pendiente actual" trendUp={pendingVisits.length === 0} />
                <KPICard title="Cotizaciones Ayer sin Pedido" value={pendingQuotations.length} icon={ShoppingBag} color="rose" trend="Estados sent o approved" trendUp={pendingQuotations.length === 0} />
                <KPICard title="Facturado Acumulado Mes" value={formatCurrency(monthMetrics.billedSales)} icon={Calendar} color="indigo" trend={monthMetrics.goal > 0 ? `${salesGoalPct}% de meta` : 'Sin meta cargada'} trendUp={monthMetrics.goal > 0 && monthMetrics.billedSales >= monthMetrics.goal} />
            </div>

            <div className="premium-card overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-indigo-50 via-white to-emerald-50">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div>
                            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.28em]">Metas del Mes</p>
                            <h3 className="mt-2 text-2xl font-black text-gray-900">Tu avance comercial del mes actual</h3>
                            <p className="mt-2 text-sm text-gray-500 font-medium">
                                Visualiza tu facturación neta, cuánto falta para llegar y el ritmo que necesitas sostener.
                            </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3 lg:min-w-[340px]">
                            <div className="rounded-2xl bg-white border border-indigo-100 p-4 shadow-sm">
                                <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Meta mensual</p>
                                <p className="mt-2 text-xl font-black text-gray-900">{formatCurrency(monthMetrics.goal)}</p>
                                <p className="mt-1 text-xs font-bold text-gray-500">
                                    {monthMetrics.goal > 0 ? `${salesGoalPct}% cumplido` : 'Sin meta configurada'}
                                </p>
                            </div>
                            <div className="rounded-2xl bg-white border border-emerald-100 p-4 shadow-sm">
                                <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Comisión estimada</p>
                                <p className="mt-2 text-xl font-black text-gray-900">{formatCurrency(estimatedCommission)}</p>
                                <p className="mt-1 text-xs font-bold text-gray-500">
                                    {monthMetrics.commissionRate > 0
                                        ? `${(monthMetrics.commissionRate * 100).toFixed(1)}% sobre facturado`
                                        : 'Sin porcentaje cargado'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-6 grid grid-cols-1 xl:grid-cols-[340px,1fr] gap-6">
                    <div className="premium-card p-5 border border-gray-50">
                        <h4 className="font-black text-gray-900 mb-2">Meta de Facturación</h4>
                        <GoalProgressChart current={monthMetrics.billedSales} target={monthMetrics.goal || 1} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        <div className="rounded-3xl border border-emerald-100 bg-emerald-50/70 p-5">
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Facturado neto</p>
                            <p className="mt-3 text-2xl font-black text-gray-900">{formatCurrency(monthMetrics.billedSales)}</p>
                            <p className="mt-2 text-xs font-bold text-emerald-700">Tomado directamente desde pedidos convertidos.</p>
                        </div>

                        <div className="rounded-3xl border border-amber-100 bg-amber-50/80 p-5">
                            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Por facturar</p>
                            <p className="mt-3 text-2xl font-black text-gray-900">
                                {monthMetrics.goal > 0 ? formatCurrency(remainingToGoal) : 'Sin meta'}
                            </p>
                            <p className="mt-2 text-xs font-bold text-amber-700">
                                {monthMetrics.goal > 0
                                    ? remainingToGoal > 0
                                        ? 'Monto que aún falta para cumplir la meta.'
                                        : `Vas sobre meta por ${formatCurrency(exceededGoalBy)}.`
                                    : 'Carga tu meta con jefatura para empezar a medir cumplimiento.'}
                            </p>
                        </div>

                        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/70 p-5">
                            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Ritmo necesario</p>
                            <p className="mt-3 text-2xl font-black text-gray-900">
                                {monthMetrics.goal > 0 && remainingToGoal > 0
                                    ? formatCurrency(requiredDailySales)
                                    : formatCurrency(0)}
                            </p>
                            <p className="mt-2 text-xs font-bold text-indigo-700">
                                {monthMetrics.goal > 0 && remainingToGoal > 0
                                    ? `${remainingBusinessDays} día(s) hábil(es) restantes en el mes.`
                                    : monthMetrics.goal > 0
                                        ? 'Meta ya cumplida para este mes.'
                                        : 'Disponible cuando exista una meta mensual.'}
                            </p>
                        </div>

                        <div className="rounded-3xl border border-rose-100 bg-rose-50/70 p-5">
                            <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Visitas hoy</p>
                            <p className="mt-3 text-2xl font-black text-gray-900">
                                {todayMetrics.visits}/{monthMetrics.dailyVisitsGoal}
                            </p>
                            <p className="mt-2 text-xs font-bold text-rose-700">
                                {visitsRemainingToday > 0
                                    ? `Te faltan ${visitsRemainingToday} visita(s) para tu meta diaria.`
                                    : 'Meta diaria de visitas cumplida hoy.'}
                            </p>
                        </div>

                        <div className="md:col-span-2 xl:col-span-4 rounded-3xl border border-gray-100 bg-white p-5">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Lectura rápida</p>
                                    <h4 className="mt-2 text-lg font-black text-gray-900">
                                        {monthMetrics.goal > 0
                                            ? remainingToGoal > 0
                                                ? 'Todavía estás a tiempo de cerrar el mes cumpliendo la meta.'
                                                : 'Ya cumpliste la meta mensual y ahora estás generando sobrecumplimiento.'
                                            : 'Aún no tienes una meta mensual cargada para este período.'}
                                    </h4>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <span className="rounded-full bg-gray-100 px-4 py-2 text-xs font-black text-gray-700">
                                        Promedio mes: {formatCurrency(monthMetrics.averageDailySales)}
                                    </span>
                                    <span className="rounded-full bg-indigo-100 px-4 py-2 text-xs font-black text-indigo-700">
                                        Meta visitas: {monthMetrics.dailyVisitsGoal}/día
                                    </span>
                                    {monthMetrics.commissionRate > 0 && (
                                        <span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-black text-emerald-700">
                                            Comisión: {(monthMetrics.commissionRate * 100).toFixed(1)}%
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="premium-card overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-black text-gray-900">Visitas pendientes de cotización</h3>
                            <p className="text-sm text-gray-500 font-medium mt-1">Visitas completadas ayer sin cotización creada hasta ahora.</p>
                        </div>
                        <span className="px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-sm font-black">
                            {pendingVisits.length}
                        </span>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {limitedPendingVisits.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">No hay visitas pendientes de cotización.</div>
                        ) : (
                            limitedPendingVisits.map((visit) => (
                                <div key={visit.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div>
                                        <p className="font-black text-gray-900">{visit.clientName}</p>
                                        <p className="text-xs text-gray-500 font-bold">
                                            {visit.visitTime ? new Date(visit.visitTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'} · {visit.comunaOrZone}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => navigate('/quotations', { state: { client: { id: visit.clientId, name: visit.clientName } } })}
                                        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-wider hover:bg-indigo-700 transition-colors"
                                    >
                                        Cotizar
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="premium-card overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-black text-gray-900">Cotizaciones pendientes de pedido</h3>
                            <p className="text-sm text-gray-500 font-medium mt-1">Cotizaciones de ayer enviadas o aprobadas que aún no generan pedido.</p>
                        </div>
                        <span className="px-4 py-2 rounded-xl bg-rose-50 text-rose-700 text-sm font-black">
                            {pendingQuotations.length}
                        </span>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {limitedPendingQuotations.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">No hay cotizaciones pendientes de pedido.</div>
                        ) : (
                            limitedPendingQuotations.map((quotation) => (
                                <div key={quotation.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div>
                                        <p className="font-black text-gray-900">
                                            Cotización #{quotation.folio ?? '-'} · {quotation.clientName}
                                        </p>
                                        <p className="text-xs text-gray-500 font-bold">
                                            {quotation.createdAt ? new Date(quotation.createdAt).toLocaleString() : '-'} · {formatCurrency(quotation.totalNet)}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => navigate(`/quotations/${quotation.id}/order-proof`)}
                                        className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors"
                                    >
                                        Generar pedido
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
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
                        <h4 className="font-black text-gray-900 mb-2">Meta de Visitas</h4>
                        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider">Meta diaria visitas</p>
                            <div className="mt-2 flex items-center gap-2">
                                <span className="inline-flex px-3 py-2 rounded-lg border border-emerald-200 font-black text-emerald-700 bg-white">
                                    {monthMetrics.dailyVisitsGoal}
                                </span>
                                <span className="text-xs text-emerald-700 font-bold">visitas/día</span>
                            </div>
                            <p className="mt-2 text-[10px] text-emerald-700/80 font-bold">
                                Avance de hoy: {todayMetrics.visits}/{monthMetrics.dailyVisitsGoal} visitas ({dailyGoalPct}%).
                            </p>
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
                                recentVisits.map((visit) => (
                                    <tr key={visit.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/40">
                                        <td className="px-6 py-4 text-sm font-bold text-gray-800">{visit.check_in_time ? new Date(visit.check_in_time).toLocaleString() : '-'}</td>
                                        <td className="px-6 py-4 text-sm font-bold text-gray-900">{visit.clients?.name || 'Sin cliente'}</td>
                                        <td className="px-6 py-4 text-xs font-bold text-gray-500 uppercase">{visit.clients?.comuna || visit.clients?.zone || '-'}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${visit.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                                                {visit.status === 'completed' ? 'Completada' : 'En curso'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-xs text-gray-600">{visit.notes || 'Sin notas'}</td>
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
