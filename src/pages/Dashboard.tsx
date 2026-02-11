import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { ShoppingCart, Users, AlertCircle, Calendar as CalendarIcon, ChevronRight, Search, Bell, Plus, Package, MapPin, Clock, CheckCircle2, TrendingUp, User, Target, BarChart2, PieChart as PieIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import VisualEvidence from '../components/VisualEvidence';
import TaskModal from '../components/TaskModal';

// Charts
import SalesTrendChart from '../components/charts/SalesTrendChart';
import GoalProgressChart from '../components/charts/GoalProgressChart';
import ActivityChart from '../components/charts/ActivityChart';
import ZoneDistributionChart from '../components/charts/ZoneDistributionChart';
import KPICard from '../components/KPICard';

const ActiveVisitTimer = ({ startTime }: { startTime: string }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const start = new Date(startTime).getTime();
        const interval = setInterval(() => {
            const now = new Date().getTime();
            setElapsed(Math.floor((now - start) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime]);

    const limit = 20 * 60; // 20 minutes
    const remaining = limit - elapsed;
    const isOvertime = remaining < 0;
    const absRemaining = Math.abs(remaining);

    const minutes = Math.floor(absRemaining / 60);
    const seconds = absRemaining % 60;
    const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (isOvertime) {
        return (
            <span className="text-red-600 font-bold animate-pulse flex items-center">
                <AlertCircle size={12} className="mr-1" />
                Excedido: +{formatted}
            </span>
        );
    }

    return (
        <span className="text-emerald-600 font-bold flex items-center">
            <Clock size={12} className="mr-1" />
            Restante: {formatted}
        </span>
    );
};

const Dashboard = () => {
    const { profile, isSupervisor, hasPermission } = useUser();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        todayVisits: 0,
        effectiveHours: '0h 0m',
        zones: [] as string[],
        recentVisits: [] as any[],
        newClientsToday: 0,
        quotationsToday: 0
    });

    // Chart Data State
    const [salesTrend, setSalesTrend] = useState<{ name: string; sales: number }[]>([]);
    const [zoneData, setZoneData] = useState<{ name: string; value: number }[]>([]);
    const [weeklyActivity, setWeeklyActivity] = useState<{ name: string; visits: number; orders: number }[]>([]);

    const [dailyVisits, setDailyVisits] = useState<any[]>([]);
    const [adminSummary, setAdminSummary] = useState<any[]>([]);
    const [selectedVisitForEvidence, setSelectedVisitForEvidence] = useState<any | null>(null);
    const [neglectedClients, setNeglectedClients] = useState<any[]>([]);
    const [selectedDate, setSelectedDate] = useState(new Date());

    // Tasks State
    const [tasks, setTasks] = useState<any[]>([]);
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

    useEffect(() => {
        if (!profile) {
            // Stop loading after 5 seconds if profile is still missing (safety timeout)
            const timeout = setTimeout(() => {
                if (loading) {
                    console.warn("Dashboard: Profile load timeout. Stopping loader.");
                    setLoading(false);
                }
            }, 5000);
            return () => clearTimeout(timeout);
        }
        fetchDashboardData();

        // Realtime subscription to update visits list automatically
        const subscription = supabase
            .channel('dashboard-visits')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => {
                fetchDashboardData();
            })
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [profile, selectedDate]);

    const [monthlyStats, setMonthlyStats] = useState({ goal: 0, currentSales: 0, commissionRate: 0 });

    useEffect(() => {
        // ... existing useEffect ...
    }, [profile, selectedDate]);

    const fetchDashboardData = async () => {
        setLoading(true);
        const start = new Date(selectedDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDate);
        end.setHours(23, 59, 59, 999);

        const isoStart = start.toISOString();
        const isoEnd = end.toISOString();

        try {
            if (profile) {

                const now = new Date();
                const currentMonth = now.getMonth() + 1;
                const currentYear = now.getFullYear();
                const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

                // A. Get Goal (Note: Goals table uses separate month/year columns as numbers)
                const { data: goalData, error: goalError } = await supabase
                    .from('goals')
                    .select('*')
                    .eq('user_id', profile.id)
                    .eq('month', currentMonth)
                    .eq('year', currentYear)
                    .maybeSingle();

                // DEBUG: Fetch ALL goals for this user to check for mismatches
                const { data: allGoals } = await supabase
                    .from('goals')
                    .select('*')
                    .eq('user_id', profile.id);

                // B. Get Monthly Sales (Direct Orders Query)
                const { data: monthOrders } = await supabase
                    .from('orders')
                    .select('total_amount, status, created_at')
                    .eq('user_id', profile.id)
                    .gte('created_at', firstDayOfMonth)
                    .lte('created_at', lastDayOfMonth);

                let monthSales = 0;
                let activeOrdersCount = 0; // Not strictly used but kept for logic structure

                monthOrders?.forEach(o => {
                    if (o.status !== 'cancelled' && o.status !== 'rejected') {
                        monthSales += o.total_amount || 0;
                        activeOrdersCount++;
                    }
                });

                setMonthlyStats({
                    goal: Number(goalData?.target_amount) || 0,
                    currentSales: monthSales,
                    commissionRate: Number(goalData?.commission_rate) || 0.01
                });

                // --- CHART DATA PROCESSING ---

                // 1. Sales Trend (Daily Sales in Current Month)
                const salesByDay = new Map<number, number>();
                monthOrders?.forEach(o => {
                    // Filter out cancelled orders
                    if (o.status === 'cancelled' || o.status === 'rejected') return;

                    const day = new Date(o.created_at).getDate();
                    salesByDay.set(day, (salesByDay.get(day) || 0) + (o.total_amount || 0));
                });

                const trendData = [];
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
                for (let i = 1; i <= daysInMonth; i++) {
                    // Only show up to today if current month
                    if (now.getMonth() === currentMonth - 1 && i > now.getDate()) break;
                    trendData.push({
                        name: `${i}`,
                        sales: salesByDay.get(i) || 0
                    });
                }
                setSalesTrend(trendData);

                // 2. Weekly Activity (Last 7 Days)
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                sevenDaysAgo.setHours(0, 0, 0, 0);

                const { data: weekVisits } = await supabase
                    .from('visits')
                    .select('check_in_time')
                    .eq('sales_rep_id', profile.id)
                    .gte('check_in_time', sevenDaysAgo.toISOString());

                const { data: weekOrders } = await supabase
                    .from('orders')
                    .select('created_at')
                    .eq('user_id', profile.id)
                    .gte('created_at', sevenDaysAgo.toISOString());

                const activityMap = new Map<string, { name: string; visits: number; orders: number }>();
                const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

                for (let d = new Date(sevenDaysAgo); d <= now; d.setDate(d.getDate() + 1)) {
                    const dateKey = d.toISOString().split('T')[0];
                    const dayName = weekDays[d.getDay()];
                    activityMap.set(dateKey, { name: dayName, visits: 0, orders: 0 });
                }

                weekVisits?.forEach(v => {
                    const k = v.check_in_time.split('T')[0];
                    if (activityMap.has(k)) {
                        const entry = activityMap.get(k)!;
                        entry.visits++;
                    }
                });

                weekOrders?.forEach(o => {
                    const k = o.created_at.split('T')[0];
                    if (activityMap.has(k)) {
                        const entry = activityMap.get(k)!;
                        entry.orders++;
                    }
                });

                const activityArray = Array.from(activityMap.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([_, val]) => val);

                setWeeklyActivity(activityArray);

                // 3. Zone Distribution
                const { data: monthVisits } = await supabase
                    .from('visits')
                    .select('clients(zone)')
                    .eq('sales_rep_id', profile.id)
                    .gte('check_in_time', firstDayOfMonth)
                    .lte('check_in_time', lastDayOfMonth);

                const zoneCount = new Map<string, number>();
                monthVisits?.forEach(v => {
                    const zone = (v.clients as any)?.zone || 'Sin Zona';
                    zoneCount.set(zone, (zoneCount.get(zone) || 0) + 1);
                });

                const zoneArray = Array.from(zoneCount.entries())
                    .map(([name, value]) => ({ name, value }))
                    .sort((a, b) => b.value - a.value);

                setZoneData(zoneArray);

                // Fetch Tasks
                const { data: tasksData } = await supabase
                    .from('tasks')
                    .select('*')
                    .eq('user_id', profile.id)
                    .eq('status', 'pending')
                    .lte('due_date', new Date(new Date().setHours(23, 59, 59, 999)).toISOString())
                    .order('due_date', { ascending: true });
                setTasks(tasksData || []);

                // C. Neglected Clients
                let clientsQuery = supabase.from('clients').select('id, name');
                if (!hasPermission('VIEW_ALL_CLIENTS')) {
                    clientsQuery = clientsQuery.eq('created_by', profile.id);
                }
                const { data: allClients } = await clientsQuery;

                if (allClients) {
                    const { data: lastVisits } = await supabase
                        .from('visits')
                        .select('client_id, check_in_time')
                        .in('client_id', allClients.map(c => c.id))
                        .eq('status', 'completed')
                        .order('check_in_time', { ascending: false });

                    const now = new Date();
                    const neglected = allClients.map(client => {
                        const lastVisit = lastVisits?.find(v => v.client_id === client.id);
                        const lastDate = lastVisit ? new Date(lastVisit.check_in_time) : null;
                        const days = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : 999;
                        return { ...client, daysSinceLastVisit: days, lastVisitDate: lastDate };
                    }).filter(c => c.daysSinceLastVisit >= 15)
                        .sort((a, b) => b.daysSinceLastVisit - a.daysSinceLastVisit);

                    setNeglectedClients(neglected);
                }
            }

            // GLOBAL: Fetch detailed visits for the table
            let visitsQuery = supabase
                .from('visits')
                .select('*, clients(name, zone, comuna), profiles(full_name, email)')
                .gte('check_in_time', isoStart)
                .lte('check_in_time', isoEnd)
                .order('check_in_time', { ascending: false });

            if (!hasPermission('VIEW_TEAM_STATS') && profile) {
                visitsQuery = visitsQuery.eq('sales_rep_id', profile.id);
            }

            const { data: visitsData, error: visitsError } = await visitsQuery;
            if (visitsData) {
                const seenActiveClients = new Set();
                const filteredVisits = visitsData.filter(v => {
                    const key = `${v.sales_rep_id}-${v.client_id}`;
                    if (v.status !== 'completed' && !v.check_out_time) {
                        if (seenActiveClients.has(key)) return false;
                        seenActiveClients.add(key);
                        return true;
                    }
                    return true;
                });
                setDailyVisits(filteredVisits);
            } else if (visitsError) {
                console.error("Error fetching detail visits:", visitsError);
            }

            if (hasPermission('VIEW_TEAM_STATS')) {
                // Admin/Supervisor Logic
                const { data: sellers } = await supabase
                    .from('profiles')
                    .select('id, email, full_name, role');

                const summary = await Promise.all((sellers || []).map(async (seller) => {
                    const now = new Date(); // Re-declare now locally inside map async

                    // 1. Visits
                    const { data: vData } = await supabase.from('visits').select('client_id, check_in_time, check_out_time').eq('sales_rep_id', seller.id).gte('check_in_time', isoStart).lte('check_in_time', isoEnd);
                    // 2. Orders
                    const { data: oData } = await supabase.from('orders').select('id, client_id, total_amount, visit_id').eq('user_id', seller.id).gte('created_at', isoStart).lte('created_at', isoEnd);
                    // 3. Calls
                    const { data: lData } = await supabase.from('call_logs').select('client_id').eq('user_id', seller.id).gte('created_at', isoStart).lte('created_at', isoEnd);
                    // 4. Quotations
                    const { data: qData } = await supabase.from('quotations').select('client_id, interaction_type').eq('seller_id', seller.id).gte('created_at', isoStart).lte('created_at', isoEnd);
                    // 5. New Clients
                    const { count: cCount, data: cData } = await supabase.from('clients').select('name', { count: 'exact' }).eq('created_by', seller.id).gte('created_at', isoStart).lte('created_at', isoEnd);
                    // 6. Goal & Sales
                    const currentMonth = now.getMonth() + 1;
                    const currentYear = now.getFullYear();
                    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
                    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
                    const { data: sellerGoal } = await supabase.from('goals').select('target_amount').eq('user_id', seller.id).eq('month', currentMonth).eq('year', currentYear).maybeSingle();
                    const { data: mOrders } = await supabase.from('orders').select('total_amount').eq('user_id', seller.id).gte('created_at', firstDayOfMonth).lte('created_at', lastDayOfMonth);

                    let sellerMonthSales = 0;
                    mOrders?.forEach(o => sellerMonthSales += o.total_amount || 0);

                    // 7. Last Zone
                    const { data: lastV } = await supabase.from('visits').select('clients(zone)').eq('sales_rep_id', seller.id).order('check_in_time', { ascending: false }).limit(1).maybeSingle();

                    // Calculate Time
                    let totalMinutes = 0;
                    const handledClientIds = new Set();
                    vData?.forEach(v => {
                        handledClientIds.add(v.client_id);
                        const start = new Date(v.check_in_time).getTime();
                        const end = v.check_out_time ? new Date(v.check_out_time).getTime() : new Date().getTime();
                        totalMinutes += Math.max(0, Math.floor((end - start) / 60000));
                    });
                    oData?.forEach(o => { if (!o.visit_id) { handledClientIds.add(o.client_id); totalMinutes += 15; } });
                    lData?.forEach(l => { handledClientIds.add(l.client_id); totalMinutes += 7; });
                    qData?.forEach(q => {
                        handledClientIds.add(q.client_id);
                        if (q.interaction_type === 'WhatsApp' || q.interaction_type === 'Teléfono') totalMinutes += 7;
                        else if (!vData?.some(v => v.client_id === q.client_id)) totalMinutes += 20;
                    });

                    const hours = totalMinutes / 60;
                    return {
                        id: seller.id,
                        name: seller.full_name || seller.email?.split('@')[0].toUpperCase(),
                        role: seller.role,
                        visits: handledClientIds.size,
                        clientsCreated: cCount || 0,
                        newClientNames: (cData || []).map(c => c.name),
                        quoteAmount: oData?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0,
                        quoteCount: oData?.length || 0,
                        hours: `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`,
                        zone: (lastV?.clients as any)?.zone || 'N/A',
                        monthlyGoal: sellerGoal?.target_amount || 0,
                        monthlySales: sellerMonthSales
                    };
                }));
                setAdminSummary(summary);
            } else if (profile && !hasPermission('VIEW_TEAM_STATS')) {
                // Seller Stats
                const { data: visits } = await supabase.from('visits').select('*, clients(name, zone)').eq('sales_rep_id', profile.id).gte('check_in_time', isoStart).lte('check_in_time', isoEnd).order('check_in_time', { ascending: false });
                const { data: orders } = await supabase.from('orders').select('*, clients(name, zone)').eq('user_id', profile.id).gte('created_at', isoStart).lte('created_at', isoEnd);
                const { data: logs } = await supabase.from('call_logs').select('*, clients(name, zone)').eq('user_id', profile.id).gte('created_at', isoStart).lte('created_at', isoEnd);
                const { data: quotations } = await supabase.from('quotations').select('*, clients(name, zone)').eq('seller_id', profile.id).gte('created_at', isoStart).lte('created_at', isoEnd);

                let totalMinutes = 0;
                const handledClientIds = new Set();
                visits?.forEach(v => {
                    handledClientIds.add(v.client_id);
                    const start = new Date(v.check_in_time).getTime();
                    const end = v.check_out_time ? new Date(v.check_out_time).getTime() : new Date().getTime();
                    totalMinutes += Math.max(0, Math.floor((end - start) / 60000));
                });
                orders?.forEach(o => { if (!o.visit_id) { handledClientIds.add(o.client_id); totalMinutes += 15; } });
                logs?.forEach(l => { handledClientIds.add(l.client_id); totalMinutes += 7; });
                quotations?.forEach(q => {
                    handledClientIds.add(q.client_id);
                    if (q.interaction_type === 'WhatsApp' || q.interaction_type === 'Teléfono') totalMinutes += 7;
                    else if (!visits?.some(v => v.client_id === q.client_id)) totalMinutes += 20;
                });

                const hours = totalMinutes / 60;
                const combinedActivity = [
                    ...(visits?.map(v => ({ ...v, type: 'Visita', time: v.check_in_time })) || []),
                    ...(orders?.filter(o => !o.visit_id).map(o => ({ ...o, type: 'Pedido Digital', time: o.created_at, status: 'Completado' })) || []),
                    ...(logs?.map(l => ({ ...l, type: 'Llamada', time: l.created_at, status: l.status || 'Finalizada' })) || []),
                    ...(quotations?.map(q => ({ ...q, type: 'Cotización', time: q.created_at, status: q.interaction_type || 'Digital' })) || [])
                ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

                const zones = Array.from(new Set([
                    ...(visits?.map(v => (v.clients as any)?.zone).filter(Boolean) || []),
                    ...(orders?.map(o => (o.clients as any)?.zone).filter(Boolean) || []),
                ])) as string[];

                setStats({
                    todayVisits: handledClientIds.size,
                    effectiveHours: `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`,
                    zones: zones,
                    recentVisits: combinedActivity,
                    newClientsToday: 0,
                    quotationsToday: quotations?.length || 0
                });
            }
        } catch (error) {
            console.error("Dashboard error:", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent animate-spin rounded-full"></div>
            <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Cargando Inteligencia de Negocios...</p>
        </div>
    );

    const renderDailyTable = () => (
        <div className="premium-card overflow-hidden mt-8">
            <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h3 className="text-xl font-bold text-gray-900 flex items-center">
                    <Clock size={20} className="mr-3 text-indigo-600" />
                    Detalle de Visitas - Hoy
                </h3>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-white px-3 py-1.5 rounded-lg border border-gray-100">
                    {dailyVisits.length} Registros
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-white border-b border-gray-50">
                        <tr>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Hora de Entrada</th>
                            {hasPermission('VIEW_TEAM_STATS') && <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Vendedor</th>}
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Cliente</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Comuna / Zona</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Tiempo</th>
                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {dailyVisits.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 font-medium italic">
                                    No hay visitas registradas hoy.
                                </td>
                            </tr>
                        ) : (
                            dailyVisits.map((visit) => (
                                <tr key={visit.id} className="hover:bg-indigo-50/30 transition-colors border-b border-gray-50/50 last:border-0">
                                    <td className="px-6 py-4 text-sm font-bold text-gray-900">
                                        {new Date(visit.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                    {hasPermission('VIEW_TEAM_STATS') && (
                                        <td className="px-6 py-4">
                                            <div className="flex items-center space-x-2">
                                                <div className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-[10px] font-black">
                                                    {(
                                                        adminSummary.find(s => s.id === visit.sales_rep_id)?.name ||
                                                        visit.profiles?.full_name ||
                                                        visit.profiles?.email?.split('@')[0] ||
                                                        '?'
                                                    ).substring(0, 1).toUpperCase()}
                                                </div>
                                                <span className="text-xs font-bold text-gray-600">
                                                    {adminSummary.find(s => s.id === visit.sales_rep_id)?.name || visit.profiles?.full_name || visit.profiles?.email?.split('@')[0] || 'Sin Asignar'}
                                                </span>
                                            </div>
                                        </td>
                                    )}
                                    <td className="px-6 py-4 font-bold text-gray-900">
                                        {(visit.clients as any)?.name}
                                    </td>
                                    <td className="px-6 py-4 text-xs font-medium text-gray-500">
                                        {(visit.clients as any)?.comuna || (visit.clients as any)?.zone || '-'}
                                    </td>
                                    <td className="px-6 py-4 text-sm font-medium text-gray-600">
                                        {visit.check_out_time ? (
                                            (() => {
                                                const start = new Date(visit.check_in_time);
                                                const end = new Date(visit.check_out_time);
                                                const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
                                                return (
                                                    <div>
                                                        <span className="text-indigo-600 font-bold block">{durationMinutes} min</span>
                                                        {visit.notes && (
                                                            <div className="mt-1 max-w-[200px] truncate text-[10px] text-gray-500 italic" title={visit.notes}>
                                                                "{visit.notes}"
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })()
                                        ) : (
                                            <ActiveVisitTimer startTime={visit.check_in_time} />
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="flex gap-2">
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${visit.status === 'completed'
                                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                                    : 'bg-amber-50 text-amber-600 border border-amber-100'
                                                    }`}>
                                                    {visit.status === 'completed' ? 'Completada' : 'En Ruta'}
                                                </span>
                                                {visit.status === 'completed' && (
                                                    <button
                                                        onClick={() => setSelectedVisitForEvidence(visit)}
                                                        className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 text-[10px] font-bold uppercase tracking-wide border border-indigo-100 hover:bg-indigo-100 transition-colors"
                                                        title="Ver Evidencia Visual"
                                                    >
                                                        <Search size={14} />
                                                    </button>
                                                )}
                                            </div>
                                            {visit.status !== 'completed' && (
                                                <button
                                                    onClick={async () => {
                                                        if (confirm('¿Forzar término de esta visita?')) {
                                                            const { error } = await supabase.from('visits').update({
                                                                check_out_time: new Date().toISOString(),
                                                                status: 'completed'
                                                            } as any).eq('id', visit.id);

                                                            if (error) {
                                                                alert('Error al terminar visita: ' + error.message);
                                                            } else {
                                                                fetchDashboardData();
                                                            }
                                                        }
                                                    }}
                                                    className="text-[10px] font-bold text-red-500 hover:text-red-700 underline decoration-dotted"
                                                >
                                                    Terminar Ahora
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Visual Evidence Modal */}
            {selectedVisitForEvidence && (
                <VisualEvidence
                    visitId={selectedVisitForEvidence.id}
                    clientName={selectedVisitForEvidence.clients?.name}
                    onClose={() => setSelectedVisitForEvidence(null)}
                />
            )}
        </div>
    );

    return (
        <div className="space-y-8 w-full mx-auto px-4 pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight">
                        {hasPermission('VIEW_TEAM_STATS') ? 'Panel de Control' : 'Mi Tablero'}
                    </h1>
                    <p className="text-gray-400 font-medium text-lg mt-1">
                        Visión general de rendimiento y objetivos.
                    </p>
                </div>
                <div className="flex items-center space-x-3">
                    <div className="relative">
                        <CalendarIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="date"
                            value={selectedDate.toISOString().split('T')[0]}
                            onChange={(e) => {
                                if (!e.target.value) return;
                                const [y, m, d] = e.target.value.split('-').map(Number);
                                const newDate = new Date(y, m - 1, d);
                                setSelectedDate(newDate);
                            }}
                            className="pl-10 pr-4 py-3 bg-white border border-gray-100 rounded-2xl font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                        />
                    </div>

                    {hasPermission('MANAGE_PERMISSIONS') && (
                        <button
                            onClick={async () => {
                                if (confirm('PELIGRO CRÍTICO: Se borrarán TODAS las VISITAS y sus PEDIDOS asociados.\n\n¿Confirmar limpieza total?')) {
                                    const { error: orderError } = await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                                    if (orderError) { alert('Error borrando pedidos: ' + orderError.message); return; }
                                    const { error } = await supabase.from('visits').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                                    if (error) alert('Error borrando visitas: ' + error.message);
                                    else { alert('Sistema limpio.'); fetchDashboardData(); }
                                }
                            }}
                            className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl font-bold text-xs hover:bg-red-100 transition-all flex items-center border border-red-100"
                        >
                            <AlertCircle size={14} className="mr-2" />
                            Limpiar DB
                        </button>
                    )}

                    <Link to="/clients" className="bg-gray-900 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-xl hover:shadow-2xl active:scale-95 transition-all flex items-center">
                        <Plus size={18} className="mr-2" />
                        Nueva Clínica
                    </Link>
                </div>
            </div>

            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard
                    title="Venta Mensual"
                    value={`$${monthlyStats.currentSales.toLocaleString()}`}
                    icon={ShoppingCart}
                    color="indigo"
                    trend={monthlyStats.goal > 0 ? `${Math.round((monthlyStats.currentSales / monthlyStats.goal) * 100)}% de Meta` : undefined}
                    trendUp={monthlyStats.currentSales > 0}
                />
                <KPICard
                    title="Visitas (Hoy)"
                    value={stats.todayVisits}
                    icon={MapPin}
                    color="emerald"
                />
                <KPICard
                    title="Cotizaciones"
                    value={stats.quotationsToday}
                    icon={Package}
                    color="amber"
                />
                <KPICard
                    title="Clientes Nuevos"
                    value={stats.newClientsToday}
                    icon={Users}
                    color="blue"
                />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Sale Trends */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="premium-card p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center">
                                <TrendingUp size={20} className="mr-2 text-indigo-600" />
                                Tendencia de Ventas (Este Mes)
                            </h3>
                        </div>
                        <SalesTrendChart data={salesTrend} />
                    </div>

                    <div className="premium-card p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center">
                                <BarChart2 size={20} className="mr-2 text-emerald-600" />
                                Actividad Semanal
                            </h3>
                        </div>
                        <ActivityChart data={weeklyActivity} />
                    </div>
                </div>

                {/* Side Stats */}
                <div className="space-y-6">
                    <div className="premium-card p-6 flex flex-col items-center">
                        <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center self-start">
                            <Target size={20} className="mr-2 text-violet-600" />
                            Progreso de Meta
                        </h3>
                        <GoalProgressChart current={monthlyStats.currentSales} target={monthlyStats.goal || 1} />

                        <div className="w-full mt-4 flex justify-between text-xs font-bold text-gray-500 border-t border-gray-100 pt-4">
                            <span>Comisión Est.:</span>
                            <span className="text-emerald-600">${Math.round(monthlyStats.currentSales * monthlyStats.commissionRate).toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="premium-card p-6">
                        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                            <PieIcon size={20} className="mr-2 text-rose-600" />
                            Distribución por Zona
                        </h3>
                        <ZoneDistributionChart data={zoneData} />
                    </div>
                </div>
            </div>

            {/* Neglected Clients Alert */}
            {neglectedClients.length > 0 && (
                <div className="premium-card bg-gradient-to-r from-red-600 to-red-700 text-white p-6 relative overflow-hidden group shadow-xl shadow-red-200">
                    <div className="absolute top-0 right-0 p-6 opacity-20 group-hover:rotate-12 transition-transform">
                        <AlertCircle size={60} />
                    </div>
                    <div className="relative flex items-center justify-between">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-1 opacity-80">Alerta de Fidelización</p>
                            <h3 className="text-xl font-black">Tienes {neglectedClients.length} clientes desatendidos</h3>
                            <p className="text-sm font-medium opacity-90 mt-1">Llevan más de 15 días sin una visita registrada.</p>
                        </div>
                        <Link to="/clients?filter=neglected" className="bg-white text-red-600 px-6 py-3 rounded-xl font-bold text-sm hover:bg-red-50 transition-all flex items-center whitespace-nowrap shadow-lg">
                            Ver Lista
                        </Link>
                    </div>
                </div>
            )}

            {/* Detailed Tables */}
            <div className="grid grid-cols-1 gap-8">
                {/* Daily Visits */}
                {renderDailyTable()}

                {/* Admin Summary Table (Only for Admins) */}
                {hasPermission('VIEW_TEAM_STATS') && (
                    <div className="premium-card overflow-hidden">
                        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                            <h3 className="text-xl font-bold text-gray-900 flex items-center">
                                <Users size={20} className="mr-3 text-indigo-600" />
                                Resumen del Equipo
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-white border-b border-gray-50">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Vendedor</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Visitas</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Pedidos</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Monto</th>
                                        <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Meta</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {adminSummary.map(seller => (
                                        <tr key={seller.id} className="hover:bg-gray-50 border-b border-gray-50 last:border-0">
                                            <td className="px-6 py-4 font-bold text-gray-900">{seller.name}</td>
                                            <td className="px-6 py-4 text-center font-bold">{seller.visits}</td>
                                            <td className="px-6 py-4 text-center font-bold">{seller.quoteCount}</td>
                                            <td className="px-6 py-4 text-right font-bold text-emerald-600">${seller.quoteAmount.toLocaleString()}</td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="w-24 mx-auto h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-indigo-500 rounded-full"
                                                        style={{ width: `${Math.min((seller.monthlySales / (seller.monthlyGoal || 1)) * 100, 100)}%` }}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Visual Evidence Modal */}
            {selectedVisitForEvidence && (
                <VisualEvidence
                    visitId={selectedVisitForEvidence.id}
                    clientName={selectedVisitForEvidence.clients?.name}
                    onClose={() => setSelectedVisitForEvidence(null)}
                />
            )}
        </div>
    );
};

export default Dashboard;
