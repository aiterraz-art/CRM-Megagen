import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { ShoppingCart, Users, AlertCircle, Calendar as CalendarIcon, ChevronRight, Search, Bell, Plus, Package, MapPin, Clock, CheckCircle2, TrendingUp, User, Target, BarChart2, PieChart as PieIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import VisualEvidence from '../components/VisualEvidence';
import TaskModal from '../components/TaskModal';
import { useVisit } from '../contexts/VisitContext';

// Charts
import SalesTrendChart from '../components/charts/SalesTrendChart';
import GoalProgressChart from '../components/charts/GoalProgressChart';
import ActivityChart from '../components/charts/ActivityChart';
import ZoneDistributionChart from '../components/charts/ZoneDistributionChart';
import KPICard from '../components/KPICard';
import { getPreviousBusinessDay } from '../utils/businessDate';
import { grossToNet } from '../utils/amounts';
import { AUTO_REFRESH_ENABLED } from '../utils/runtimeFlags';

const gpsComunaCache = new Map<string, string>();

const isValidGpsNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && !(n === 0);
};

const hasMeaningfulZone = (value: unknown) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === '-' || normalized === 'sin zona' || normalized === 'n/a') return false;
    return true;
};

const getLatestIsoDate = (...values: Array<string | null | undefined>) => values
    .filter(Boolean)
    .reduce<string | null>((latest, current) => {
        if (!current) return latest;
        if (!latest) return current;
        return new Date(current).getTime() > new Date(latest).getTime() ? current : latest;
    }, null);

const isBillableOrderStatus = (status: string | null | undefined) =>
    String(status || '').toLowerCase() !== 'cancelled';

const buildMonthlySalesTrend = (
    orders: Array<{ created_at?: string | null; total_amount?: number | null; status?: string | null }>,
    year: number,
    monthOneBased: number,
    today: Date
) => {
    const salesByDay = new Map<number, number>();

    orders.forEach((order) => {
        if (!isBillableOrderStatus(order.status)) return;
        if (!order.created_at) return;

        const day = new Date(order.created_at).getDate();
        salesByDay.set(day, (salesByDay.get(day) || 0) + grossToNet(order.total_amount));
    });

    const trendData: Array<{ name: string; sales: number }> = [];
    const daysInMonth = new Date(year, monthOneBased, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
        if (today.getMonth() === monthOneBased - 1 && day > today.getDate()) break;
        trendData.push({
            name: `${day}`,
            sales: salesByDay.get(day) || 0
        });
    }

    return trendData;
};

const buildWeeklyActivitySeries = (
    visits: Array<{ check_in_time?: string | null }>,
    orders: Array<{ created_at?: string | null }>,
    endDate: Date
) => {
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const weekDays = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    const activityMap = new Map<string, { name: string; visits: number; orders: number }>();

    for (let day = new Date(startDate); day <= endDate; day.setDate(day.getDate() + 1)) {
        const dateKey = day.toISOString().split('T')[0];
        activityMap.set(dateKey, {
            name: weekDays[day.getDay()],
            visits: 0,
            orders: 0
        });
    }

    visits.forEach((visit) => {
        if (!visit?.check_in_time) return;
        const dateKey = visit.check_in_time.split('T')[0];
        if (!activityMap.has(dateKey)) return;
        activityMap.get(dateKey)!.visits += 1;
    });

    orders.forEach((order) => {
        if (!order?.created_at) return;
        const dateKey = order.created_at.split('T')[0];
        if (!activityMap.has(dateKey)) return;
        activityMap.get(dateKey)!.orders += 1;
    });

    return Array.from(activityMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, value]) => value);
};

const resolveComunaFromGps = async (lat: number, lng: number): Promise<string | null> => {
    const roundedLat = lat.toFixed(5);
    const roundedLng = lng.toFixed(5);
    const key = `${roundedLat},${roundedLng}`;
    const cached = gpsComunaCache.get(key);
    if (cached) return cached;

    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${roundedLat}&lon=${roundedLng}&format=jsonv2&accept-language=es`;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) return null;
        const payload = await response.json();
        const address = payload?.address || {};
        const comuna =
            address?.city_district ||
            address?.suburb ||
            address?.town ||
            address?.city ||
            address?.municipality ||
            address?.county ||
            null;
        const comunaLabel = typeof comuna === 'string' ? comuna.trim() : '';
        if (!comunaLabel) return null;
        gpsComunaCache.set(key, comunaLabel);
        return comunaLabel;
    } catch {
        return null;
    }
};

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
    const { profile, isSupervisor, hasPermission, effectiveRole } = useUser();
    const { activeVisit, endVisit } = useVisit();
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
    const [teamDashboardTotals, setTeamDashboardTotals] = useState({
        todayVisits: 0,
        todaySalesNet: 0,
        averageDailyMonthSales: 0,
        pendingVisitsNoQuote: 0,
        pendingQuotesNoOrder: 0,
        monthSalesNet: 0,
        previousMonthToDateSalesNet: 0
    });
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

        if (!AUTO_REFRESH_ENABLED) {
            return;
        }

        // Realtime subscription to update visits list automatically
        const subscription = supabase
            .channel('dashboard-visits')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => {
                fetchDashboardData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'goals' }, () => {
                fetchDashboardData();
            })
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [profile, selectedDate]);

    const [monthlyStats, setMonthlyStats] = useState({ goal: 0, currentSales: 0, commissionRate: 0 });

    const teamSalesRanking = useMemo(
        () => [...adminSummary].sort((a, b) => {
            const monthDiff = Number(b.monthSalesNet || 0) - Number(a.monthSalesNet || 0);
            if (monthDiff !== 0) return monthDiff;
            const todayDiff = Number(b.todaySalesNet || 0) - Number(a.todaySalesNet || 0);
            if (todayDiff !== 0) return todayDiff;
            return Number(b.todayVisits || 0) - Number(a.todayVisits || 0);
        }),
        [adminSummary]
    );

    const formatDateInput = (date: Date) => {
        const y = date.getFullYear();
        const m = `${date.getMonth() + 1}`.padStart(2, '0');
        const d = `${date.getDate()}`.padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

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
                const firstDayOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)).toISOString();
                const lastDayOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

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
                    .not('quotation_id', 'is', null)
                    .gte('created_at', firstDayOfMonth)
                    .lte('created_at', lastDayOfMonth);

                let monthSales = 0;
                let activeOrdersCount = 0; // Not strictly used but kept for logic structure

                monthOrders?.forEach(o => {
                    if (isBillableOrderStatus(o.status)) {
                        monthSales += grossToNet(o.total_amount);
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
                setSalesTrend(buildMonthlySalesTrend(
                    (monthOrders || []) as Array<{ created_at?: string | null; total_amount?: number | null; status?: string | null }>,
                    currentYear,
                    currentMonth,
                    now
                ));

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
                    .not('quotation_id', 'is', null)
                    .gte('created_at', sevenDaysAgo.toISOString());

                setWeeklyActivity(buildWeeklyActivitySeries(
                    (weekVisits || []) as Array<{ check_in_time?: string | null }>,
                    (weekOrders || []) as Array<{ created_at?: string | null }>,
                    now
                ));

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
                let { data: tasksData } = await supabase
                    .from('tasks')
                    .select('*')
                    .eq('user_id', profile.id)
                    .eq('status', 'pending')
                    .lte('due_date', new Date(new Date().setHours(23, 59, 59, 999)).toISOString())
                    .order('due_date', { ascending: true });

                if (!tasksData || tasksData.length === 0) {
                    const { data: legacyTasks } = await supabase
                        .from('tasks')
                        .select('*')
                        .eq('assigned_to', profile.id)
                        .eq('status', 'pending')
                        .lte('due_date', new Date(new Date().setHours(23, 59, 59, 999)).toISOString())
                        .order('due_date', { ascending: true });
                    tasksData = legacyTasks;
                }
                setTasks(tasksData || []);

                // C. Neglected Clients
                let clientsQuery = supabase.from('clients').select('id, name');
                if (!hasPermission('VIEW_ALL_CLIENTS')) {
                    clientsQuery = clientsQuery.eq('created_by', profile.id);
                }
                const { data: allClients } = await clientsQuery;

                if (allClients) {
                    const clientIds = allClients.map(c => c.id);
                    const [
                        { data: followupSettingsRow },
                        { data: lastVisits },
                        { data: lastOrders },
                        { data: lastQuotes },
                        { data: lastCalls },
                        { data: lastEmails },
                        { data: lastWhatsapp }
                    ] = await Promise.all([
                        supabase
                            .from('client_followup_settings')
                            .select('active_warning_days')
                            .eq('id', 'default')
                            .maybeSingle(),
                        supabase
                            .from('visits')
                            .select('client_id, check_in_time')
                            .in('client_id', clientIds)
                            .eq('status', 'completed')
                            .order('check_in_time', { ascending: false }),
                        supabase
                            .from('orders')
                            .select('client_id, created_at')
                            .in('client_id', clientIds)
                            .order('created_at', { ascending: false }),
                        supabase
                            .from('quotations')
                            .select('client_id, created_at')
                            .in('client_id', clientIds)
                            .order('created_at', { ascending: false }),
                        supabase
                            .from('call_logs')
                            .select('client_id, created_at')
                            .in('client_id', clientIds)
                            .order('created_at', { ascending: false }),
                        supabase
                            .from('email_logs')
                            .select('client_id, created_at')
                            .in('client_id', clientIds)
                            .order('created_at', { ascending: false }),
                        supabase
                            .from('lead_message_logs')
                            .select('client_id, created_at, channel, status')
                            .in('client_id', clientIds)
                            .eq('channel', 'whatsapp')
                            .in('status', ['sent', 'opened_external'])
                            .order('created_at', { ascending: false })
                    ]);

                    const warningDays = Number(followupSettingsRow?.active_warning_days || 15);
                    const now = new Date();
                    const latestVisitByClient = new Map<string, string>();
                    const latestOrderByClient = new Map<string, string>();
                    const latestQuoteByClient = new Map<string, string>();
                    const latestCallByClient = new Map<string, string>();
                    const latestEmailByClient = new Map<string, string>();
                    const latestWhatsappByClient = new Map<string, string>();

                    (lastVisits || []).forEach((visit: any) => {
                        if (!visit.client_id) return;
                        latestVisitByClient.set(visit.client_id, getLatestIsoDate(latestVisitByClient.get(visit.client_id) || null, visit.check_in_time) || visit.check_in_time);
                    });
                    (lastOrders || []).forEach((order: any) => {
                        if (!order.client_id) return;
                        latestOrderByClient.set(order.client_id, getLatestIsoDate(latestOrderByClient.get(order.client_id) || null, order.created_at) || order.created_at);
                    });
                    (lastQuotes || []).forEach((quote: any) => {
                        if (!quote.client_id) return;
                        latestQuoteByClient.set(quote.client_id, getLatestIsoDate(latestQuoteByClient.get(quote.client_id) || null, quote.created_at) || quote.created_at);
                    });
                    (lastCalls || []).forEach((call: any) => {
                        if (!call.client_id) return;
                        latestCallByClient.set(call.client_id, getLatestIsoDate(latestCallByClient.get(call.client_id) || null, call.created_at) || call.created_at);
                    });
                    (lastEmails || []).forEach((email: any) => {
                        if (!email.client_id) return;
                        latestEmailByClient.set(email.client_id, getLatestIsoDate(latestEmailByClient.get(email.client_id) || null, email.created_at) || email.created_at);
                    });
                    (lastWhatsapp || []).forEach((message: any) => {
                        if (!message.client_id) return;
                        latestWhatsappByClient.set(message.client_id, getLatestIsoDate(latestWhatsappByClient.get(message.client_id) || null, message.created_at) || message.created_at);
                    });

                    const neglected = allClients.map(client => {
                        const lastActivityAt = getLatestIsoDate(
                            latestVisitByClient.get(client.id) || null,
                            latestOrderByClient.get(client.id) || null,
                            latestQuoteByClient.get(client.id) || null,
                            latestCallByClient.get(client.id) || null,
                            latestEmailByClient.get(client.id) || null,
                            latestWhatsappByClient.get(client.id) || null
                        );
                        const lastDate = lastActivityAt ? new Date(lastActivityAt) : null;
                        const days = lastDate ? Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : 999;
                        return { ...client, daysSinceLastVisit: days, lastVisitDate: lastDate };
                    }).filter(c => c.daysSinceLastVisit >= warningDays)
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
                    const status = String(v.status || '').toLowerCase();
                    const isOpen = (status === 'in_progress' || status === 'in-progress') && !v.check_out_time;
                    if (isOpen) {
                        if (seenActiveClients.has(key)) return false;
                        seenActiveClients.add(key);
                        return true;
                    }
                    return true;
                });
                const pendingClientGeoBackfill = new Map<string, { comuna?: string; zone?: string }>();
                const enrichedVisits = await Promise.all(
                    filteredVisits.map(async (visit: any) => {
                        const currentComuna = (visit.clients as any)?.comuna;
                        const currentZone = (visit.clients as any)?.zone;

                        const hasComuna = hasMeaningfulZone(currentComuna);
                        const hasZone = hasMeaningfulZone(currentZone);

                        if (hasComuna || hasZone) {
                            return { ...visit, dashboardComuna: hasComuna ? currentComuna : currentZone };
                        }

                        const latCandidate = visit.check_out_lat ?? visit.lat;
                        const lngCandidate = visit.check_out_lng ?? visit.lng;

                        if (!isValidGpsNumber(latCandidate) || !isValidGpsNumber(lngCandidate)) {
                            return { ...visit, dashboardComuna: 'Sin Zona' };
                        }

                        const resolvedComuna = await resolveComunaFromGps(Number(latCandidate), Number(lngCandidate));
                        if (resolvedComuna && visit.client_id) {
                            pendingClientGeoBackfill.set(visit.client_id, {
                                comuna: resolvedComuna,
                                zone: resolvedComuna
                            });
                        }
                        return { ...visit, dashboardComuna: resolvedComuna || 'Sin Zona' };
                    })
                );

                setDailyVisits(enrichedVisits);

                if (pendingClientGeoBackfill.size > 0) {
                    void Promise.all(
                        Array.from(pendingClientGeoBackfill.entries()).map(async ([clientId, values]) => {
                            const { error } = await supabase
                                .from('clients')
                                .update(values)
                                .eq('id', clientId);
                            if (error) {
                                console.warn('Dashboard: no se pudo persistir comuna/zona desde GPS para client_id=', clientId, error.message);
                            }
                        })
                    );
                }
            } else if (visitsError) {
                console.error("Error fetching detail visits:", visitsError);
            }

            if (hasPermission('VIEW_TEAM_STATS')) {
                const canViewAllTeam = effectiveRole === 'admin' || effectiveRole === 'jefe';
                let sellers: any[] = [];
                let sellerLookupError: any = null;
                let preloadedTodayVisitsRows: any[] = [];
                let preloadedTodayOrdersRows: any[] = [];
                let preloadedMonthOrdersRows: any[] = [];
                let preloadedYesterdayVisitsRows: any[] = [];
                let preloadedYesterdayQuotesRows: any[] = [];
                let preloadedTeamGoalsRows: any[] = [];

                if (canViewAllTeam) {
                    const { data, error } = await supabase
                        .from('profiles')
                        .select('id, email, full_name, role, status')
                        .in('role', ['seller', 'jefe', 'admin']);
                    sellerLookupError = error;
                    if (error) {
                        console.warn('Dashboard: no se pudo leer el roster de vendedores desde profiles.', error.message);
                    }
                    sellers = data || [];
                } else if (profile?.id) {
                    const scopedResponse = await supabase
                        .from('profiles')
                        .select('id, email, full_name, role, status')
                        .eq('supervisor_id', profile.id)
                        .eq('role', 'seller');

                    if (scopedResponse.error) {
                        console.warn('Dashboard: fallback to all active sellers because supervisor scope is unavailable.', scopedResponse.error.message);
                    }

                    sellers = scopedResponse.data || [];

                }

                let activeSellers = (sellers || []).filter((seller: any) => seller.status === 'active');
                let sellerIds = activeSellers.map((seller: any) => seller.id);

                if (canViewAllTeam && (sellerLookupError || sellerIds.length === 0)) {
                    const teamNow = new Date();
                    const teamFirstDayOfMonth = new Date(Date.UTC(teamNow.getFullYear(), teamNow.getMonth(), 1, 0, 0, 0, 0)).toISOString();
                    const teamLastDayOfMonth = new Date(Date.UTC(teamNow.getFullYear(), teamNow.getMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
                    const startOfToday = new Date(selectedDate);
                    startOfToday.setHours(0, 0, 0, 0);
                    const endOfToday = new Date(selectedDate);
                    endOfToday.setHours(23, 59, 59, 999);

                    const yesterdayDate = getPreviousBusinessDay(startOfToday);
                    const startOfYesterday = new Date(yesterdayDate);
                    startOfYesterday.setHours(0, 0, 0, 0);
                    const endOfYesterday = new Date(yesterdayDate);
                    endOfYesterday.setHours(23, 59, 59, 999);

                    const [
                        todayVisitsFallback,
                        todayOrdersFallback,
                        monthOrdersFallback,
                        yesterdayVisitsFallback,
                        yesterdayQuotesFallback,
                        teamGoalsFallback,
                    ] = await Promise.all([
                        supabase
                            .from('visits')
                            .select('id, sales_rep_id, client_id, check_in_time, status, profiles(full_name, email)')
                            .gte('check_in_time', startOfToday.toISOString())
                            .lte('check_in_time', endOfToday.toISOString())
                            .neq('status', 'cancelled'),
                        supabase
                            .from('orders')
                            .select('id, user_id, total_amount, status, quotation_id, created_at')
                            .not('quotation_id', 'is', null)
                            .gte('created_at', startOfToday.toISOString())
                            .lte('created_at', endOfToday.toISOString()),
                        supabase
                            .from('orders')
                            .select('id, user_id, total_amount, status, quotation_id, created_at')
                            .not('quotation_id', 'is', null)
                            .gte('created_at', teamFirstDayOfMonth)
                            .lte('created_at', teamLastDayOfMonth),
                        supabase
                            .from('visits')
                            .select('id, sales_rep_id, client_id, check_in_time, clients(name, comuna, zone)')
                            .eq('status', 'completed')
                            .not('client_id', 'is', null)
                            .gte('check_in_time', startOfYesterday.toISOString())
                            .lte('check_in_time', endOfYesterday.toISOString()),
                        supabase
                            .from('quotations')
                            .select('id, folio, seller_id, client_id, status, total_amount, created_at, clients(name)')
                            .in('status', ['sent', 'approved'])
                            .gte('created_at', startOfYesterday.toISOString())
                            .lte('created_at', endOfYesterday.toISOString()),
                        supabase
                            .from('goals')
                            .select('user_id, target_amount')
                            .eq('month', teamNow.getMonth() + 1)
                            .eq('year', teamNow.getFullYear()),
                    ]);

                    preloadedTodayVisitsRows = todayVisitsFallback.data || [];
                    preloadedTodayOrdersRows = todayOrdersFallback.data || [];
                    preloadedMonthOrdersRows = monthOrdersFallback.data || [];
                    preloadedYesterdayVisitsRows = yesterdayVisitsFallback.data || [];
                    preloadedYesterdayQuotesRows = yesterdayQuotesFallback.data || [];
                    preloadedTeamGoalsRows = teamGoalsFallback.data || [];

                    const discoveredSellerIds = Array.from(new Set([
                        ...preloadedTodayVisitsRows.map((row: any) => row.sales_rep_id).filter(Boolean),
                        ...preloadedTodayOrdersRows.map((row: any) => row.user_id).filter(Boolean),
                        ...preloadedMonthOrdersRows.map((row: any) => row.user_id).filter(Boolean),
                        ...preloadedYesterdayVisitsRows.map((row: any) => row.sales_rep_id).filter(Boolean),
                        ...preloadedYesterdayQuotesRows.map((row: any) => row.seller_id).filter(Boolean),
                        ...preloadedTeamGoalsRows.map((row: any) => row.user_id).filter(Boolean),
                    ]));

                    if (discoveredSellerIds.length > 0) {
                        const { data: fallbackProfiles, error: fallbackProfilesError } = await supabase
                            .from('profiles')
                            .select('id, email, full_name, role, status')
                            .in('id', discoveredSellerIds);

                        if (fallbackProfilesError) {
                            console.warn('Dashboard: no se pudieron enriquecer los vendedores desde profiles.', fallbackProfilesError.message);
                        }

                        const visitProfileMap = new Map<string, { email: string | null; full_name: string | null }>();
                        preloadedTodayVisitsRows.forEach((row: any) => {
                            const embeddedProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                            if (!row.sales_rep_id || !embeddedProfile) return;
                            visitProfileMap.set(row.sales_rep_id, {
                                email: embeddedProfile.email || null,
                                full_name: embeddedProfile.full_name || null,
                            });
                        });

                        const fallbackProfileMap = new Map<string, any>(
                            ((fallbackProfiles || []) as any[]).map((seller) => [seller.id, seller])
                        );

                        activeSellers = discoveredSellerIds.map((sellerId) => {
                            const profileRow = fallbackProfileMap.get(sellerId);
                            const visitProfile = visitProfileMap.get(sellerId);
                            return {
                                id: sellerId,
                                email: profileRow?.email || visitProfile?.email || null,
                                full_name: profileRow?.full_name || visitProfile?.full_name || null,
                                role: profileRow?.role || 'seller',
                                status: profileRow?.status || 'active',
                            };
                        });
                        sellerIds = activeSellers.map((seller: any) => seller.id);
                    }
                }

                if (sellerIds.length === 0) {
                    setAdminSummary([]);
                    setTeamDashboardTotals({
                        todayVisits: 0,
                        todaySalesNet: 0,
                        averageDailyMonthSales: 0,
                        pendingVisitsNoQuote: 0,
                        pendingQuotesNoOrder: 0,
                        monthSalesNet: 0,
                        previousMonthToDateSalesNet: 0
                    });
                    setStats({
                        todayVisits: 0,
                        effectiveHours: 'Resumen de equipo',
                        zones: [],
                        recentVisits: [],
                        newClientsToday: 0,
                        quotationsToday: 0
                    });
                } else {
                    const teamNow = new Date();
                    const teamCurrentMonth = teamNow.getMonth() + 1;
                    const teamCurrentYear = teamNow.getFullYear();
                    const teamFirstDayOfMonth = new Date(Date.UTC(teamNow.getFullYear(), teamNow.getMonth(), 1, 0, 0, 0, 0)).toISOString();
                    const teamLastDayOfMonth = new Date(Date.UTC(teamNow.getFullYear(), teamNow.getMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
                    const previousMonthLastDay = new Date(teamNow.getFullYear(), teamNow.getMonth(), 0).getDate();
                    const previousMonthComparableDay = Math.min(teamNow.getDate(), previousMonthLastDay);
                    const previousMonthStart = new Date(Date.UTC(teamNow.getFullYear(), teamNow.getMonth() - 1, 1, 0, 0, 0, 0)).toISOString();
                    const previousMonthComparableEnd = new Date(Date.UTC(teamNow.getFullYear(), teamNow.getMonth() - 1, previousMonthComparableDay, 23, 59, 59, 999)).toISOString();
                    const startOfToday = new Date(selectedDate);
                    startOfToday.setHours(0, 0, 0, 0);
                    const endOfToday = new Date(selectedDate);
                    endOfToday.setHours(23, 59, 59, 999);

                    const yesterdayDate = getPreviousBusinessDay(startOfToday);
                    const startOfYesterday = new Date(yesterdayDate);
                    startOfYesterday.setHours(0, 0, 0, 0);
                    const endOfYesterday = new Date(yesterdayDate);
                    endOfYesterday.setHours(23, 59, 59, 999);
                    const daysElapsedInMonth = Math.max(1, teamNow.getDate());
                    const weekStart = new Date(selectedDate);
                    weekStart.setDate(weekStart.getDate() - 6);
                    weekStart.setHours(0, 0, 0, 0);
                    const weekEnd = new Date(selectedDate);
                    weekEnd.setHours(23, 59, 59, 999);

                    const todayVisitsRows = preloadedTodayVisitsRows.length > 0
                        ? preloadedTodayVisitsRows
                        : (await supabase
                            .from('visits')
                            .select('id, sales_rep_id, client_id, check_in_time, status')
                            .in('sales_rep_id', sellerIds)
                            .gte('check_in_time', startOfToday.toISOString())
                            .lte('check_in_time', endOfToday.toISOString())
                            .neq('status', 'cancelled')).data || [];

                    const todayOrdersRows = preloadedTodayOrdersRows.length > 0
                        ? preloadedTodayOrdersRows
                        : (await supabase
                            .from('orders')
                            .select('id, user_id, total_amount, status, quotation_id, created_at')
                            .in('user_id', sellerIds)
                            .not('quotation_id', 'is', null)
                            .gte('created_at', startOfToday.toISOString())
                            .lte('created_at', endOfToday.toISOString())).data || [];

                    const weekVisitsRows = (await supabase
                        .from('visits')
                        .select('check_in_time, sales_rep_id')
                        .in('sales_rep_id', sellerIds)
                        .gte('check_in_time', weekStart.toISOString())
                        .lte('check_in_time', weekEnd.toISOString())
                        .neq('status', 'cancelled')).data || [];

                    const weekOrdersRows = (await supabase
                        .from('orders')
                        .select('created_at, user_id, status, quotation_id')
                        .in('user_id', sellerIds)
                        .not('quotation_id', 'is', null)
                        .gte('created_at', weekStart.toISOString())
                        .lte('created_at', weekEnd.toISOString())).data || [];

                    const monthOrdersRows = preloadedMonthOrdersRows.length > 0
                        ? preloadedMonthOrdersRows
                        : (await supabase
                            .from('orders')
                            .select('id, user_id, total_amount, status, quotation_id, created_at')
                            .in('user_id', sellerIds)
                            .not('quotation_id', 'is', null)
                            .gte('created_at', teamFirstDayOfMonth)
                            .lte('created_at', teamLastDayOfMonth)).data || [];

                    const previousMonthOrdersRows = (await supabase
                        .from('orders')
                        .select('id, user_id, total_amount, status, quotation_id, created_at')
                        .in('user_id', sellerIds)
                        .not('quotation_id', 'is', null)
                        .gte('created_at', previousMonthStart)
                        .lte('created_at', previousMonthComparableEnd)).data || [];

                    const yesterdayVisitsRows = preloadedYesterdayVisitsRows.length > 0
                        ? preloadedYesterdayVisitsRows
                        : (await supabase
                            .from('visits')
                            .select('id, sales_rep_id, client_id, check_in_time, clients(name, comuna, zone)')
                            .in('sales_rep_id', sellerIds)
                            .eq('status', 'completed')
                            .not('client_id', 'is', null)
                            .gte('check_in_time', startOfYesterday.toISOString())
                            .lte('check_in_time', endOfYesterday.toISOString())).data || [];

                    const yesterdayQuotesRows = preloadedYesterdayQuotesRows.length > 0
                        ? preloadedYesterdayQuotesRows
                        : (await supabase
                            .from('quotations')
                            .select('id, folio, seller_id, client_id, status, total_amount, created_at, clients(name)')
                            .in('seller_id', sellerIds)
                            .in('status', ['sent', 'approved'])
                            .gte('created_at', startOfYesterday.toISOString())
                            .lte('created_at', endOfYesterday.toISOString())).data || [];

                    const teamGoalsRows = preloadedTeamGoalsRows.length > 0
                        ? preloadedTeamGoalsRows
                        : (await supabase
                            .from('goals')
                            .select('user_id, target_amount')
                            .in('user_id', sellerIds)
                            .eq('month', teamCurrentMonth)
                            .eq('year', teamCurrentYear)).data || [];

                    const yesterdayVisitClientIds = Array.from(
                        new Set(((yesterdayVisitsRows || []) as any[]).map((visit: any) => visit.client_id).filter(Boolean))
                    );

                    let quotesForVisitedClients: any[] = [];
                    if (yesterdayVisitClientIds.length > 0) {
                        const { data } = await supabase
                            .from('quotations')
                            .select('seller_id, client_id, created_at')
                            .in('seller_id', sellerIds)
                            .in('client_id', yesterdayVisitClientIds)
                            .gte('created_at', startOfYesterday.toISOString());
                        quotesForVisitedClients = data || [];
                    }

                    const yesterdayQuoteIds = ((yesterdayQuotesRows || []) as any[]).map((quote: any) => quote.id);
                    let convertedQuoteIds = new Set<string>();
                    if (yesterdayQuoteIds.length > 0) {
                        const { data } = await supabase
                            .from('orders')
                            .select('quotation_id')
                            .in('quotation_id', yesterdayQuoteIds);
                        convertedQuoteIds = new Set((data || []).map((order: any) => order.quotation_id).filter(Boolean));
                    }

                    const goalsBySeller = new Map<string, number>();
                    (teamGoalsRows || []).forEach((goal: any) => {
                        goalsBySeller.set(goal.user_id, Number(goal.target_amount) || 0);
                    });

                    const summary = activeSellers.map((seller: any) => {
                        const sellerTodayVisits = ((todayVisitsRows || []) as any[]).filter((visit: any) => visit.sales_rep_id === seller.id);
                        const sellerTodayOrders = ((todayOrdersRows || []) as any[]).filter((order: any) => order.user_id === seller.id && isBillableOrderStatus(order.status));
                        const sellerMonthOrders = ((monthOrdersRows || []) as any[]).filter((order: any) => order.user_id === seller.id && isBillableOrderStatus(order.status));
                        const sellerYesterdayVisits = ((yesterdayVisitsRows || []) as any[]).filter((visit: any) => visit.sales_rep_id === seller.id);
                        const sellerYesterdayQuotes = ((yesterdayQuotesRows || []) as any[]).filter((quote: any) => quote.seller_id === seller.id);

                        const pendingVisitsNoQuote = sellerYesterdayVisits.filter((visit: any) => {
                            if (!visit.client_id || !visit.check_in_time) return false;
                            const visitAt = new Date(visit.check_in_time).getTime();
                            return !quotesForVisitedClients.some((quote: any) => {
                                if (quote.seller_id !== seller.id || quote.client_id !== visit.client_id || !quote.created_at) return false;
                                return new Date(quote.created_at).getTime() >= visitAt;
                            });
                        }).length;

                        const pendingQuotesNoOrder = sellerYesterdayQuotes.filter((quote: any) => !convertedQuoteIds.has(quote.id)).length;
                        const todaySalesNet = sellerTodayOrders.reduce((sum: number, order: any) => sum + grossToNet(order.total_amount), 0);
                        const monthSalesNet = sellerMonthOrders.reduce((sum: number, order: any) => sum + grossToNet(order.total_amount), 0);

                        return {
                            id: seller.id,
                            name: seller.full_name || seller.email?.split('@')[0].toUpperCase(),
                            role: seller.role,
                            todayVisits: sellerTodayVisits.length,
                            todaySalesNet,
                            averageDailyMonthSales: monthSalesNet / daysElapsedInMonth,
                            pendingVisitsNoQuote,
                            pendingQuotesNoOrder,
                            monthSalesNet,
                            monthlyGoal: goalsBySeller.get(seller.id) || 0
                        };
                    });

                    setAdminSummary(
                        [...summary].sort((a, b) => {
                            const monthDiff = Number(b.monthSalesNet || 0) - Number(a.monthSalesNet || 0);
                            if (monthDiff !== 0) return monthDiff;
                            const todayDiff = Number(b.todaySalesNet || 0) - Number(a.todaySalesNet || 0);
                            if (todayDiff !== 0) return todayDiff;
                            return Number(b.todayVisits || 0) - Number(a.todayVisits || 0);
                        })
                    );

                    const totals = {
                        todayVisits: summary.reduce((sum, seller) => sum + (seller.todayVisits || 0), 0),
                        todaySalesNet: summary.reduce((sum, seller) => sum + (seller.todaySalesNet || 0), 0),
                        averageDailyMonthSales: summary.reduce((sum, seller) => sum + (seller.averageDailyMonthSales || 0), 0),
                        pendingVisitsNoQuote: summary.reduce((sum, seller) => sum + (seller.pendingVisitsNoQuote || 0), 0),
                        pendingQuotesNoOrder: summary.reduce((sum, seller) => sum + (seller.pendingQuotesNoOrder || 0), 0),
                        monthSalesNet: summary.reduce((sum, seller) => sum + (seller.monthSalesNet || 0), 0),
                        previousMonthToDateSalesNet: ((previousMonthOrdersRows || []) as any[])
                            .filter((order: any) => isBillableOrderStatus(order.status))
                            .reduce((sum: number, order: any) => sum + grossToNet(order.total_amount), 0)
                    };
                    setTeamDashboardTotals(totals);
                    setWeeklyActivity(buildWeeklyActivitySeries(
                        (weekVisitsRows || []) as Array<{ check_in_time?: string | null }>,
                        ((weekOrdersRows || []) as any[]).filter((order: any) => isBillableOrderStatus(order.status)) as Array<{ created_at?: string | null }>,
                        weekEnd
                    ));
                    setSalesTrend(buildMonthlySalesTrend(
                        (monthOrdersRows || []) as Array<{ created_at?: string | null; total_amount?: number | null; status?: string | null }>,
                        teamCurrentYear,
                        teamCurrentMonth,
                        teamNow
                    ));

                    const uniqueZones = Array.from(
                        new Set(
                            ((dailyVisits || []) as any[])
                                .map((visit: any) => visit.dashboardComuna || (visit.clients as any)?.comuna || (visit.clients as any)?.zone)
                                .filter(Boolean)
                        )
                    );
                    setStats({
                        todayVisits: totals.todayVisits,
                        effectiveHours: 'Resumen de equipo',
                        zones: uniqueZones,
                        recentVisits: [],
                        newClientsToday: 0,
                        quotationsToday: 0
                    });
                }
            } else if (profile && !hasPermission('VIEW_TEAM_STATS')) {
                // Seller Stats
                const { data: visits } = await supabase.from('visits').select('*, clients(name, zone)').eq('sales_rep_id', profile.id).gte('check_in_time', isoStart).lte('check_in_time', isoEnd).order('check_in_time', { ascending: false });
                const { data: orders } = await supabase.from('orders').select('*, clients(name, zone)').eq('user_id', profile.id).not('quotation_id', 'is', null).gte('created_at', isoStart).lte('created_at', isoEnd);
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
                                        {visit.dashboardComuna || (visit.clients as any)?.comuna || (visit.clients as any)?.zone || 'Sin Zona'}
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
                                        ) : visit.status === 'cancelled' ? (
                                            <div>
                                                <span className="text-gray-500 font-bold block">Cancelada</span>
                                                {visit.notes && (
                                                    <div className="mt-1 max-w-[200px] truncate text-[10px] text-gray-500 italic" title={visit.notes}>
                                                        "{visit.notes}"
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <ActiveVisitTimer startTime={visit.check_in_time} />
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="flex gap-2">
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${visit.status === 'completed'
                                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                                    : visit.status === 'cancelled'
                                                        ? 'bg-gray-100 text-gray-600 border border-gray-200'
                                                        : 'bg-amber-50 text-amber-600 border border-amber-100'
                                                    }`}>
                                                    {visit.status === 'completed' ? 'Completada' : visit.status === 'cancelled' ? 'Cancelada' : 'En Ruta'}
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
                                                            try {
                                                                // Use endVisit from context if it's the active visit, 
                                                                // or direct update if it's another rep's visit (supervisor case)
                                                                if (visit.id === activeVisit?.id) {
                                                                    const closed = await endVisit({ notes: 'Cierre forzado desde Dashboard' });
                                                                    if (!closed) throw new Error('No fue posible cerrar la visita activa.');
                                                                } else {
                                                                    const { error } = await supabase.from('visits').update({
                                                                        check_out_time: new Date().toISOString(),
                                                                        status: 'completed',
                                                                        notes: 'Cierre forzado por supervisor'
                                                                    } as any).eq('id', visit.id);
                                                                    if (error) throw error;
                                                                }
                                                                fetchDashboardData();
                                                            } catch (error: any) {
                                                                alert('Error al terminar visita: ' + error.message);
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
                            value={formatDateInput(selectedDate)}
                            onChange={(e) => {
                                if (!e.target.value) return;
                                const [y, m, d] = e.target.value.split('-').map(Number);
                                const newDate = new Date(y, m - 1, d);
                                setSelectedDate(newDate);
                            }}
                            className="pl-10 pr-4 py-3 bg-white border border-gray-100 rounded-2xl font-bold text-gray-700 shadow-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                        />
                    </div>
                    <Link to="/clients" className="bg-gray-900 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-xl hover:shadow-2xl active:scale-95 transition-all flex items-center">
                        <Plus size={18} className="mr-2" />
                        Nueva Clínica
                    </Link>
                </div>
            </div>

            {/* KPI Cards Row */}
            {hasPermission('VIEW_TEAM_STATS') ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    <KPICard
                        title="Visitas Hoy"
                        value={teamDashboardTotals.todayVisits}
                        icon={MapPin}
                        color="emerald"
                    />
                    <KPICard
                        title="Facturado Hoy"
                        value={`$${Math.round(teamDashboardTotals.todaySalesNet).toLocaleString()}`}
                        icon={ShoppingCart}
                        color="blue"
                        trend="Monto facturado desde pedidos"
                        trendUp={teamDashboardTotals.todaySalesNet > 0}
                    />
                    <KPICard
                        title="Promedio Diario Mes"
                        value={`$${Math.round(teamDashboardTotals.averageDailyMonthSales).toLocaleString()}`}
                        icon={TrendingUp}
                        color="amber"
                        trend="Promedio facturado del mes"
                        trendUp={teamDashboardTotals.averageDailyMonthSales > 0}
                    />
                    <KPICard
                        title="Visitas Ayer sin Cotizar"
                        value={teamDashboardTotals.pendingVisitsNoQuote}
                        icon={AlertCircle}
                        color="indigo"
                        trend="Pendiente actual del equipo"
                        trendUp={teamDashboardTotals.pendingVisitsNoQuote === 0}
                    />
                    <KPICard
                        title="Cotizaciones Ayer sin Pedido"
                        value={teamDashboardTotals.pendingQuotesNoOrder}
                        icon={Package}
                        color="rose"
                        trend="Estados sent o approved"
                        trendUp={teamDashboardTotals.pendingQuotesNoOrder === 0}
                    />
                    <KPICard
                        title="Facturado Acumulado Mes"
                        value={`$${Math.round(teamDashboardTotals.monthSalesNet).toLocaleString()}`}
                        icon={CalendarIcon}
                        color="indigo"
                        detail={`Mes anterior a esta fecha: $${Math.round(teamDashboardTotals.previousMonthToDateSalesNet).toLocaleString()}`}
                        trend={`Variación: ${teamDashboardTotals.monthSalesNet >= teamDashboardTotals.previousMonthToDateSalesNet ? '+' : '-'}$${Math.round(Math.abs(teamDashboardTotals.monthSalesNet - teamDashboardTotals.previousMonthToDateSalesNet)).toLocaleString()}`}
                        trendLabel=""
                        trendUp={teamDashboardTotals.monthSalesNet >= teamDashboardTotals.previousMonthToDateSalesNet}
                    />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <KPICard
                        title="Facturado Mensual"
                        value={`$${monthlyStats.currentSales.toLocaleString()}`}
                        icon={ShoppingCart}
                        color="indigo"
                        trend={monthlyStats.goal > 0 ? `${Math.round((monthlyStats.currentSales / monthlyStats.goal) * 100)}% de meta` : undefined}
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
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Sale Trends */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="premium-card p-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center">
                                <TrendingUp size={20} className="mr-2 text-indigo-600" />
                                Tendencia de Facturación (Este Mes)
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
                            Progreso de Facturación
                        </h3>
                        <GoalProgressChart current={monthlyStats.currentSales} target={monthlyStats.goal || 1} />

                        <div className="w-full mt-4 flex justify-between text-xs font-bold text-gray-500 border-t border-gray-100 pt-4">
                            <span>Comisión est. s/facturado:</span>
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
                    <div className="space-y-8">
                        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                            <div className="xl:col-span-2 premium-card overflow-hidden">
                                <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                                    <h3 className="text-xl font-bold text-gray-900 flex items-center">
                                        <TrendingUp size={20} className="mr-3 text-emerald-600" />
                                        Ventas Ordenadas por Vendedor
                                    </h3>
                                    <p className="text-sm text-gray-500 font-medium mt-1">
                                        Ranking mensual del equipo según pedidos facturados.
                                    </p>
                                </div>
                                <div className="divide-y divide-gray-50">
                                    {teamSalesRanking.length === 0 ? (
                                        <div className="p-8 text-center text-gray-400 italic">
                                            Aún no hay ventas facturadas para ordenar.
                                        </div>
                                    ) : (
                                        teamSalesRanking.map((seller, index) => {
                                            const goal = Number(seller.monthlyGoal || 0);
                                            const progress = goal > 0 ? Math.round((Number(seller.monthSalesNet || 0) / goal) * 100) : 0;
                                            return (
                                                <div key={seller.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-black ${
                                                            index === 0
                                                                ? 'bg-amber-100 text-amber-700'
                                                                : index === 1
                                                                    ? 'bg-slate-100 text-slate-700'
                                                                    : index === 2
                                                                        ? 'bg-orange-100 text-orange-700'
                                                                        : 'bg-indigo-50 text-indigo-600'
                                                        }`}>
                                                            #{index + 1}
                                                        </div>
                                                        <div>
                                                            <p className="font-black text-gray-900">{seller.name}</p>
                                                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wide">
                                                                {seller.todayVisits} visitas hoy · ${Math.round(seller.todaySalesNet || 0).toLocaleString()} facturado hoy
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col md:items-end">
                                                        <p className="text-xl font-black text-emerald-600">
                                                            ${Math.round(seller.monthSalesNet || 0).toLocaleString()}
                                                        </p>
                                                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                                                            Meta {goal > 0 ? `$${Math.round(goal).toLocaleString()}` : 'Sin meta'} · {goal > 0 ? `${progress}% cumplido` : 'Sin objetivo'}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            <div className="premium-card p-6">
                                <h3 className="text-xl font-bold text-gray-900 flex items-center">
                                    <Users size={20} className="mr-3 text-indigo-600" />
                                    Lectura Comercial
                                </h3>
                                <div className="space-y-4 mt-6">
                                    <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-4">
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 mb-2">Líder del mes</p>
                                        <p className="text-lg font-black text-gray-900">
                                            {teamSalesRanking[0]?.name || 'Sin datos'}
                                        </p>
                                        <p className="text-sm font-bold text-indigo-700 mt-1">
                                            {teamSalesRanking[0] ? `$${Math.round(teamSalesRanking[0].monthSalesNet || 0).toLocaleString()}` : 'Sin ventas'}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 mb-2">Vendedores con ventas</p>
                                        <p className="text-2xl font-black text-gray-900">
                                            {teamSalesRanking.filter((seller) => Number(seller.monthSalesNet || 0) > 0).length}
                                        </p>
                                        <p className="text-xs font-bold text-gray-500 mt-1">
                                            De {teamSalesRanking.length} vendedor(es) en el panel.
                                        </p>
                                    </div>
                                    <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4">
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 mb-2">Mayor cumplimiento</p>
                                        {(() => {
                                            const bestGoalProgress = [...teamSalesRanking]
                                                .filter((seller) => Number(seller.monthlyGoal || 0) > 0)
                                                .sort((a, b) => (Number(b.monthSalesNet || 0) / Number(b.monthlyGoal || 1)) - (Number(a.monthSalesNet || 0) / Number(a.monthlyGoal || 1)))[0];

                                            if (!bestGoalProgress) {
                                                return <p className="text-sm font-bold text-gray-500">No hay metas configuradas.</p>;
                                            }

                                            const bestProgressPct = Math.round((Number(bestGoalProgress.monthSalesNet || 0) / Number(bestGoalProgress.monthlyGoal || 1)) * 100);

                                            return (
                                                <>
                                                    <p className="text-lg font-black text-gray-900">{bestGoalProgress.name}</p>
                                                    <p className="text-sm font-bold text-amber-700 mt-1">{bestProgressPct}% de su meta mensual</p>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="premium-card overflow-hidden">
                            <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                                <h3 className="text-xl font-bold text-gray-900 flex items-center">
                                    <Users size={20} className="mr-3 text-indigo-600" />
                                    Resumen Comercial del Equipo
                                </h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-white border-b border-gray-50">
                                        <tr>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Ranking</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Vendedor</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Visitas Hoy</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Facturado Hoy</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Prom. Diario Mes</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Visitas Ayer sin Cotizar</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Cotizaciones Ayer sin Pedido</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Meta Mes</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Cumplimiento</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Facturado Acum. Mes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {teamSalesRanking.map((seller, index) => {
                                            const goal = Number(seller.monthlyGoal || 0);
                                            const progress = goal > 0 ? Math.round((Number(seller.monthSalesNet || 0) / goal) * 100) : 0;
                                            return (
                                                <tr key={seller.id} className="hover:bg-gray-50 border-b border-gray-50 last:border-0">
                                                    <td className="px-6 py-4 font-black text-indigo-600">#{index + 1}</td>
                                                    <td className="px-6 py-4 font-bold text-gray-900">{seller.name}</td>
                                                    <td className="px-6 py-4 text-center font-bold">{seller.todayVisits}</td>
                                                    <td className="px-6 py-4 text-right font-bold text-emerald-600">${Math.round(seller.todaySalesNet || 0).toLocaleString()}</td>
                                                    <td className="px-6 py-4 text-right font-bold text-amber-600">${Math.round(seller.averageDailyMonthSales || 0).toLocaleString()}</td>
                                                    <td className="px-6 py-4 text-center font-bold">{seller.pendingVisitsNoQuote}</td>
                                                    <td className="px-6 py-4 text-center font-bold">{seller.pendingQuotesNoOrder}</td>
                                                    <td className="px-6 py-4 text-right font-bold text-slate-600">
                                                        {goal > 0 ? `$${Math.round(goal).toLocaleString()}` : 'Sin meta'}
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${
                                                            goal <= 0
                                                                ? 'bg-gray-100 text-gray-500'
                                                                : progress >= 100
                                                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                                                    : progress >= 70
                                                                        ? 'bg-amber-50 text-amber-600 border border-amber-100'
                                                                        : 'bg-rose-50 text-rose-600 border border-rose-100'
                                                        }`}>
                                                            {goal > 0 ? `${progress}%` : 'N/A'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right font-bold text-indigo-600">${Math.round(seller.monthSalesNet || 0).toLocaleString()}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
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
