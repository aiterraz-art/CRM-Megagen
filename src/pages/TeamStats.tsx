import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Users, TrendingUp, Calendar, MapPin, ChevronRight, LayoutDashboard, Clock, CheckCircle2, AlertCircle, Plus, X, Download } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const TeamStats = () => {
    const { hasPermission, loading: userLoading, profile: currentUser } = useUser();
    const [teamData, setTeamData] = useState<any[]>([]);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [stats, setStats] = useState({
        totalVisits: 0,
        pendingApprovals: 0,
        teamValue: 0,
        activeVisits: 0
    });
    const [loading, setLoading] = useState(true);
    const [showTaskModal, setShowTaskModal] = useState(false);
    const [selectedRep, setSelectedRep] = useState<any>(null);
    const [newTask, setNewTask] = useState({ title: '', description: '', clientId: '', dueDate: '' });
    const [clients, setClients] = useState<any[]>([]);

    // Goals Logic
    const [showGoalModal, setShowGoalModal] = useState(false);
    const [goalForm, setGoalForm] = useState({ targetAmount: '', commissionRate: '1.0', dailyVisitsGoal: '8' });
    const [loadingGoal, setLoadingGoal] = useState(false);
    const [exportFrom, setExportFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [exportTo, setExportTo] = useState(() => new Date().toISOString().split('T')[0]);
    const [exportSellerId, setExportSellerId] = useState<'all' | string>('all');
    const [exporting, setExporting] = useState(false);
    const [cleaningLeads, setCleaningLeads] = useState(false);
    const normalizedCurrentRole = (currentUser?.role || '').toLowerCase();
    const canCleanGhostLeads = normalizedCurrentRole === 'admin' || normalizedCurrentRole === 'jefe' || normalizedCurrentRole === 'manager';

    const handleOpenGoalModal = async (rep: any) => {
        setSelectedRep(rep);
        setLoadingGoal(true);
        setShowGoalModal(true);

        // Fetch existing goal for this month
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        const { data, error } = await supabase
            .from('goals')
            .select('*')
            .eq('user_id', rep.id)
            .eq('month', currentMonth)
            .eq('year', currentYear)
            .maybeSingle();

        if (data) {
            setGoalForm({
                targetAmount: data.target_amount.toString(),
                commissionRate: (data.commission_rate * 100).toString(), // Convert 0.01 to 1%
                dailyVisitsGoal: String(data.daily_visits_goal ?? 8)
            });
        } else {
            setGoalForm({ targetAmount: '0', commissionRate: '1.0', dailyVisitsGoal: '8' }); // Default goals
        }
        setLoadingGoal(false);
    };

    const handleSaveGoal = async () => {
        if (!selectedRep) return;

        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const rateDecimal = parseFloat(goalForm.commissionRate) / 100;
        const dailyVisitsGoal = Math.max(0, parseInt(goalForm.dailyVisitsGoal || '0', 10) || 0);

        const { error } = await supabase
            .from('goals')
            .upsert({
                user_id: selectedRep.id,
                month: currentMonth,
                year: currentYear,
                target_amount: parseFloat(goalForm.targetAmount),
                commission_rate: rateDecimal,
                daily_visits_goal: dailyVisitsGoal
            }, { onConflict: 'user_id, month, year' });

        if (!error) {
            alert('Meta actualizada correctamente');
            setShowGoalModal(false);
        } else {
            alert('Error al guardar meta: ' + error.message);
        }
    };

    useEffect(() => {
        if (hasPermission('VIEW_TEAM_STATS') && currentUser) {
            fetchTeamData();
            supabase.from('clients').select('id, name').then(({ data }) => setClients(data || []));
        }
    }, [hasPermission, currentUser, selectedDate]);

    const fetchTeamData = async () => {
        setLoading(true);
        const selected = new Date(`${selectedDate}T00:00:00`);
        const dayStart = new Date(selected);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(selected);
        dayEnd.setHours(23, 59, 59, 999);
        const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1, 0, 0, 0, 0);
        const monthEnd = new Date(selected.getFullYear(), selected.getMonth() + 1, 0, 23, 59, 59, 999);

        // 1. Fetch profiles
        let query = supabase.from('profiles').select('*');

        // SECURITY REINFORCEMENT:
        // Only admin role can bypass the supervisor filter.
        const userRole = (currentUser?.role || '').toLowerCase();
        const normalizedRole = userRole === 'manager' ? 'admin' : userRole;
        const isActuallyAdmin = normalizedRole === 'admin';
        const isActuallyChief = userRole === 'jefe';

        console.log("TeamStats DEBUG V7:", {
            email: currentUser?.email,
            dbRole: currentUser?.role,
            isActuallyAdmin,
            isActuallyChief,
            canViewAll: isActuallyAdmin && !isActuallyChief
        });

        // Fail-safe: If anything is ambiguous, we restrict to subordinates.
        let finalCanViewAll = isActuallyAdmin;
        if (isActuallyChief) finalCanViewAll = false; // Chief ALWAYS restricted

        if (!finalCanViewAll) {
            console.log("TeamStats: RADICAL FORCED supervisor filter for ID:", currentUser!.id);
            query = query.eq('supervisor_id', currentUser!.id);
        } else {
            console.log("TeamStats: Global visibility (Super Admin).");
            query = query.neq('id', currentUser!.id);
        }

        const { data: profilesData, error } = await query;
        console.log("TeamStats Profiles Query Result:", { count: profilesData?.length, error });

        if (error) {
            console.error("Error loading team profiles:", error);
            setLoading(false);
            return;
        }

        if (!profilesData || profilesData.length === 0) {
            setTeamData([]);
            setStats({ totalVisits: 0, pendingApprovals: 0, teamValue: 0, activeVisits: 0 });
            setLoading(false);
            return;
        }

        const subordinatesIds = profilesData.map((p: any) => p.id);

        // 2. Fetch tasks (user_id + assigned_to compatibility)
        const { data: tasksByUser } = await supabase
            .from('tasks')
            .select('*')
            .in('user_id', subordinatesIds)
            .eq('status', 'pending');

        const { data: tasksByAssignee } = await supabase
            .from('tasks')
            .select('*')
            .in('assigned_to', subordinatesIds)
            .eq('status', 'pending');

        const taskMap = new Map<string, any[]>();
        const allTasks = [...(tasksByUser || []), ...(tasksByAssignee || [])];
        const seenTaskIds = new Set<string>();
        allTasks.forEach((task: any) => {
            if (!task?.id || seenTaskIds.has(task.id)) return;
            seenTaskIds.add(task.id);
            const ownerId = task.user_id || task.assigned_to;
            if (!ownerId) return;
            if (!taskMap.has(ownerId)) taskMap.set(ownerId, []);
            taskMap.get(ownerId)!.push(task);
        });

        // 3. Fetch daily visits for selected date
        const { data: dayVisitsData } = await supabase
            .from('visits')
            .select('id, sales_rep_id, check_in_time, check_out_time, status, client_id, clients(name)')
            .in('sales_rep_id', subordinatesIds)
            .gte('check_in_time', dayStart.toISOString())
            .lte('check_in_time', dayEnd.toISOString())
            .order('check_in_time', { ascending: false });

        // 4. Fetch active visits
        const { data: activeVisitsData } = await supabase
            .from('visits')
            .select('id, sales_rep_id')
            .in('sales_rep_id', subordinatesIds)
            .eq('status', 'in_progress');

        // 5. Fetch month-to-date orders for value/pending counters
        const { data: monthOrdersData } = await supabase
            .from('orders')
            .select('id, user_id, status, total_amount, created_at')
            .in('user_id', subordinatesIds)
            .not('quotation_id', 'is', null)
            .gte('created_at', monthStart.toISOString())
            .lte('created_at', monthEnd.toISOString());

        const visitsByRep = new Map<string, any[]>();
        (dayVisitsData || []).forEach((visit: any) => {
            if (!visitsByRep.has(visit.sales_rep_id)) visitsByRep.set(visit.sales_rep_id, []);
            visitsByRep.get(visit.sales_rep_id)!.push(visit);
        });

        const activeRepSet = new Set((activeVisitsData || []).map((visit: any) => visit.sales_rep_id));
        const monthSalesByRep = new Map<string, number>();
        const pendingOrdersByRep = new Map<string, number>();

        (monthOrdersData || []).forEach((order: any) => {
            const repId = order.user_id;
            if (!repId) return;

            if (order.status !== 'cancelled' && order.status !== 'rejected') {
                monthSalesByRep.set(repId, (monthSalesByRep.get(repId) || 0) + (order.total_amount || 0));
            }

            if (order.status === 'pending') {
                pendingOrdersByRep.set(repId, (pendingOrdersByRep.get(repId) || 0) + 1);
            }
        });

        const fullTeamData = profilesData.map((rep: any) => ({
            ...rep,
            visits: visitsByRep.get(rep.id) || [],
            tasks: taskMap.get(rep.id) || [],
            monthSales: monthSalesByRep.get(rep.id) || 0,
            pendingOrders: pendingOrdersByRep.get(rep.id) || 0,
            isActive: activeRepSet.has(rep.id)
        }));

        setTeamData(fullTeamData);

        const totalVisits = fullTeamData.reduce((sum: number, rep: any) => sum + (rep.visits?.length || 0), 0);
        const pendingApprovals = fullTeamData.reduce((sum: number, rep: any) => sum + (rep.pendingOrders || 0), 0);
        const teamValue = fullTeamData.reduce((sum: number, rep: any) => sum + (rep.monthSales || 0), 0);
        const activeVisits = fullTeamData.filter((rep: any) => rep.isActive).length;

        setStats({
            totalVisits,
            pendingApprovals,
            teamValue,
            activeVisits
        });

        setLoading(false);
    };

    const handleAssignTask = async () => {
        if (!newTask.title || !selectedRep || !currentUser) return;

        let { error } = await (supabase.from('tasks') as any).insert({
            user_id: selectedRep.id,
            title: newTask.title,
            description: newTask.description,
            client_id: newTask.clientId || null,
            due_date: newTask.dueDate || null,
            status: 'pending'
        });

        if (error) {
            const retry = await (supabase.from('tasks') as any).insert({
                assigned_to: selectedRep.id,
                assigned_by: currentUser.id,
                title: newTask.title,
                description: newTask.description,
                client_id: newTask.clientId || null,
                due_date: newTask.dueDate || null,
                status: 'pending'
            });
            error = retry.error;
        }

        if (!error) {
            setShowTaskModal(false);
            setNewTask({ title: '', description: '', clientId: '', dueDate: '' });
            fetchTeamData();
        }
    };

    const getSelectedSellerIds = () => {
        const sellerIds = teamData.map((rep: any) => rep.id).filter(Boolean);
        if (exportSellerId === 'all') return sellerIds;
        return sellerIds.includes(exportSellerId) ? [exportSellerId] : [];
    };

    const exportSellerManagementReport = async () => {
        const sellerIds = getSelectedSellerIds();
        if (sellerIds.length === 0) {
            alert('No hay vendedores disponibles para exportar en tu alcance.');
            return;
        }
        if (!exportFrom || !exportTo) {
            alert('Debes indicar rango de fechas.');
            return;
        }

        const fromIso = new Date(`${exportFrom}T00:00:00`).toISOString();
        const toIso = new Date(`${exportTo}T23:59:59.999`).toISOString();
        const repMap: Record<string, string> = {};
        teamData.forEach((rep: any) => {
            repMap[rep.id] = rep.full_name || rep.email || rep.id;
        });

        setExporting(true);
        try {
            const [visitsRes, ordersRes, quotesRes, callsRes, emailsRes] = await Promise.all([
                supabase
                    .from('visits')
                    .select('id, sales_rep_id, client_id, check_in_time, check_out_time, status, notes, clients(name, address, comuna, zone)')
                    .in('sales_rep_id', sellerIds)
                    .gte('check_in_time', fromIso)
                    .lte('check_in_time', toIso)
                    .order('check_in_time', { ascending: false }),
                supabase
                    .from('orders')
                    .select('id, folio, user_id, client_id, status, total_amount, total_discount, delivery_status, created_at, clients(name, address, comuna, zone)')
                    .in('user_id', sellerIds)
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('quotations')
                    .select('id, folio, seller_id, client_id, status, total_amount, interaction_type, created_at, clients(name, address, comuna, zone)')
                    .in('seller_id', sellerIds)
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('call_logs')
                    .select('id, user_id, client_id, status, notes, created_at, clients(name, address, comuna, zone)')
                    .in('user_id', sellerIds)
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso)
                    .order('created_at', { ascending: false }),
                supabase
                    .from('email_logs')
                    .select('id, user_id, client_id, subject, created_at, clients(name, address, comuna, zone)')
                    .in('user_id', sellerIds)
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso)
                    .order('created_at', { ascending: false }),
            ]);

            if (visitsRes.error) throw visitsRes.error;
            if (ordersRes.error) throw ordersRes.error;
            if (quotesRes.error) throw quotesRes.error;
            if (callsRes.error) throw callsRes.error;
            if (emailsRes.error) throw emailsRes.error;

            const visits = visitsRes.data || [];
            const orders = ordersRes.data || [];
            const quotations = quotesRes.data || [];
            const calls = callsRes.data || [];
            const emails = emailsRes.data || [];

            const summaryBySeller = new Map<string, any>();
            sellerIds.forEach((sid) => {
                summaryBySeller.set(sid, {
                    seller_id: sid,
                    vendedor: repMap[sid] || sid,
                    visitas: 0,
                    clientes_visitados_unicos: 0,
                    ventas: 0,
                    monto_ventas: 0,
                    cotizaciones: 0,
                    llamadas: 0,
                    correos: 0,
                    descuentos_total: 0,
                    _clients: new Set<string>()
                });
            });

            visits.forEach((v: any) => {
                const row = summaryBySeller.get(v.sales_rep_id);
                if (!row) return;
                row.visitas += 1;
                if (v.client_id) row._clients.add(v.client_id);
            });
            orders.forEach((o: any) => {
                const row = summaryBySeller.get(o.user_id);
                if (!row) return;
                row.ventas += 1;
                row.monto_ventas += Number(o.total_amount || 0);
                row.descuentos_total += Number(o.total_discount || 0);
            });
            quotations.forEach((q: any) => {
                const row = summaryBySeller.get(q.seller_id);
                if (!row) return;
                row.cotizaciones += 1;
            });
            calls.forEach((c: any) => {
                const row = summaryBySeller.get(c.user_id);
                if (!row) return;
                row.llamadas += 1;
            });
            emails.forEach((m: any) => {
                const row = summaryBySeller.get(m.user_id);
                if (!row) return;
                row.correos += 1;
            });

            const summaryRows = Array.from(summaryBySeller.values()).map((r) => ({
                seller_id: r.seller_id,
                vendedor: r.vendedor,
                visitas: r.visitas,
                clientes_visitados_unicos: r._clients.size,
                ventas: r.ventas,
                monto_ventas: r.monto_ventas,
                descuentos_total: r.descuentos_total,
                cotizaciones: r.cotizaciones,
                llamadas: r.llamadas,
                correos: r.correos
            }));

            const visitsRows = visits.map((v: any) => ({
                vendedor: repMap[v.sales_rep_id] || v.sales_rep_id,
                cliente: v.clients?.name || 'N/A',
                comuna: v.clients?.comuna || '',
                zona: v.clients?.zone || '',
                direccion: v.clients?.address || '',
                fecha_inicio: v.check_in_time,
                fecha_fin: v.check_out_time,
                estado: v.status,
                notas: v.notes || ''
            }));

            const salesRows = orders.map((o: any) => ({
                vendedor: repMap[o.user_id] || o.user_id,
                folio: o.folio,
                cliente: o.clients?.name || 'N/A',
                comuna: o.clients?.comuna || '',
                zona: o.clients?.zone || '',
                direccion: o.clients?.address || '',
                fecha: o.created_at,
                estado: o.status,
                estado_despacho: o.delivery_status,
                total: Number(o.total_amount || 0),
                descuento: Number(o.total_discount || 0)
            }));

            const quotesRows = quotations.map((q: any) => ({
                vendedor: repMap[q.seller_id] || q.seller_id,
                folio: q.folio,
                cliente: q.clients?.name || 'N/A',
                comuna: q.clients?.comuna || '',
                zona: q.clients?.zone || '',
                fecha: q.created_at,
                estado: q.status,
                tipo_interaccion: q.interaction_type,
                total: Number(q.total_amount || 0)
            }));

            const callsRows = calls.map((c: any) => ({
                vendedor: repMap[c.user_id] || c.user_id,
                cliente: c.clients?.name || 'N/A',
                fecha: c.created_at,
                estado: c.status,
                notas: c.notes || ''
            }));

            const emailRows = emails.map((m: any) => ({
                vendedor: repMap[m.user_id] || m.user_id,
                cliente: m.clients?.name || 'N/A',
                fecha: m.created_at,
                asunto: m.subject || ''
            }));

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Resumen_Vendedores');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visitsRows), 'Visitas');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(salesRows), 'Ventas');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quotesRows), 'Cotizaciones');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(callsRows), 'Llamadas');
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(emailRows), 'Correos');
            XLSX.writeFile(wb, `gestion_vendedores_${exportFrom}_${exportTo}.xlsx`);
        } catch (err: any) {
            console.error('Export seller report error:', err);
            alert('Error exportando gestión de vendedores: ' + (err?.message || 'desconocido'));
        } finally {
            setExporting(false);
        }
    };

    const exportClientsIntelligenceReport = async () => {
        const sellerIds = getSelectedSellerIds();
        if (sellerIds.length === 0) {
            alert('No hay vendedores disponibles para exportar en tu alcance.');
            return;
        }
        if (!exportFrom || !exportTo) {
            alert('Debes indicar rango de fechas.');
            return;
        }

        const fromIso = new Date(`${exportFrom}T00:00:00`).toISOString();
        const toIso = new Date(`${exportTo}T23:59:59.999`).toISOString();
        const repMap: Record<string, string> = {};
        teamData.forEach((rep: any) => {
            repMap[rep.id] = rep.full_name || rep.email || rep.id;
        });

        setExporting(true);
        try {
            const [{ data: clientsData, error: clientsError }, visitsRes, ordersRes, callsRes, emailsRes, quotesRes] = await Promise.all([
                supabase
                    .from('clients')
                    .select('*')
                    .in('created_by', sellerIds)
                    .order('name'),
                supabase
                    .from('visits')
                    .select('client_id, check_in_time, status')
                    .gte('check_in_time', fromIso)
                    .lte('check_in_time', toIso),
                supabase
                    .from('orders')
                    .select('client_id, created_at, total_amount, status, delivery_status')
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso),
                supabase
                    .from('call_logs')
                    .select('client_id, created_at, status')
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso),
                supabase
                    .from('email_logs')
                    .select('client_id, created_at, subject')
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso),
                supabase
                    .from('quotations')
                    .select('client_id, created_at, status, total_amount')
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso),
            ]);

            if (clientsError) throw clientsError;
            if (visitsRes.error) throw visitsRes.error;
            if (ordersRes.error) throw ordersRes.error;
            if (callsRes.error) throw callsRes.error;
            if (emailsRes.error) throw emailsRes.error;
            if (quotesRes.error) throw quotesRes.error;

            const clients = clientsData || [];
            const visits = visitsRes.data || [];
            const orders = ordersRes.data || [];
            const calls = callsRes.data || [];
            const emails = emailsRes.data || [];
            const quotes = quotesRes.data || [];

            const now = new Date();
            const byClient = new Map<string, any>();

            clients.forEach((c: any) => {
                byClient.set(c.id, {
                    client_id: c.id,
                    cliente: c.name,
                    rut: c.rut || '',
                    estado_cliente: c.status || '',
                    giro: c.giro || '',
                    comuna: c.comuna || '',
                    zona: c.zone || '',
                    direccion: c.address || '',
                    vendedor_id: c.created_by || '',
                    vendedor: repMap[c.created_by || ''] || c.created_by || 'Sin asignar',
                    fecha_creacion: c.created_at || '',
                    ultima_visita: c.last_visit_date || '',
                    ultima_venta: '',
                    ultimo_contacto: '',
                    total_ventas: 0,
                    monto_ventas: 0,
                    total_visitas: 0,
                    total_llamadas: 0,
                    total_correos: 0,
                    total_cotizaciones: 0,
                    dias_sin_visita: null as number | null,
                    dias_sin_contacto: null as number | null,
                    cliente_no_visitado: false,
                    cliente_inactivo: false
                });
            });

            const maxDate = (current: string, candidate?: string | null) => {
                if (!candidate) return current;
                if (!current) return candidate;
                return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
            };

            visits.forEach((v: any) => {
                const row = byClient.get(v.client_id);
                if (!row) return;
                row.total_visitas += 1;
                row.ultima_visita = maxDate(row.ultima_visita, v.check_in_time);
                row.ultimo_contacto = maxDate(row.ultimo_contacto, v.check_in_time);
            });
            orders.forEach((o: any) => {
                const row = byClient.get(o.client_id);
                if (!row) return;
                row.total_ventas += 1;
                row.monto_ventas += Number(o.total_amount || 0);
                row.ultima_venta = maxDate(row.ultima_venta, o.created_at);
                row.ultimo_contacto = maxDate(row.ultimo_contacto, o.created_at);
            });
            calls.forEach((c: any) => {
                const row = byClient.get(c.client_id);
                if (!row) return;
                row.total_llamadas += 1;
                row.ultimo_contacto = maxDate(row.ultimo_contacto, c.created_at);
            });
            emails.forEach((m: any) => {
                const row = byClient.get(m.client_id);
                if (!row) return;
                row.total_correos += 1;
                row.ultimo_contacto = maxDate(row.ultimo_contacto, m.created_at);
            });
            quotes.forEach((q: any) => {
                const row = byClient.get(q.client_id);
                if (!row) return;
                row.total_cotizaciones += 1;
                row.ultimo_contacto = maxDate(row.ultimo_contacto, q.created_at);
            });

            const rows = Array.from(byClient.values()).map((r) => {
                if (r.ultima_visita) {
                    r.dias_sin_visita = Math.floor((now.getTime() - new Date(r.ultima_visita).getTime()) / 86400000);
                }
                if (r.ultimo_contacto) {
                    r.dias_sin_contacto = Math.floor((now.getTime() - new Date(r.ultimo_contacto).getTime()) / 86400000);
                }
                r.cliente_no_visitado = !r.ultima_visita || (r.dias_sin_visita ?? 999) >= 15;
                r.cliente_inactivo = ['inactive', 'inactivo'].includes(String(r.estado_cliente || '').toLowerCase()) || (r.dias_sin_contacto ?? 999) >= 60;
                return r;
            });

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Clientes_Resumen');
            XLSX.utils.book_append_sheet(
                wb,
                XLSX.utils.json_to_sheet(rows.filter(r => r.cliente_no_visitado)),
                'Clientes_No_Visitados'
            );
            XLSX.utils.book_append_sheet(
                wb,
                XLSX.utils.json_to_sheet(rows.filter(r => r.cliente_inactivo)),
                'Clientes_Inactivos'
            );
            XLSX.writeFile(wb, `informe_clientes_${exportFrom}_${exportTo}.xlsx`);
        } catch (err: any) {
            console.error('Export clients report error:', err);
            alert('Error exportando informe de clientes: ' + (err?.message || 'desconocido'));
        } finally {
            setExporting(false);
        }
    };

    const exportDataLakeReport = async () => {
        const sellerIds = getSelectedSellerIds();
        if (sellerIds.length === 0) {
            alert('No hay vendedores disponibles para exportar en tu alcance.');
            return;
        }
        if (!exportFrom || !exportTo) {
            alert('Debes indicar rango de fechas.');
            return;
        }

        const fromIso = new Date(`${exportFrom}T00:00:00`).toISOString();
        const toIso = new Date(`${exportTo}T23:59:59.999`).toISOString();
        const repMap: Record<string, string> = {};
        teamData.forEach((rep: any) => {
            repMap[rep.id] = rep.full_name || rep.email || rep.id;
        });

        setExporting(true);
        try {
            const wb = XLSX.utils.book_new();
            const failures: Array<{ sheet: string; error: string }> = [];
            const addSheet = (name: string, rows: any[]) => {
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows || []), name.slice(0, 31));
            };
            const safeFetch = async (sheet: string, fetcher: () => Promise<any[]>) => {
                try {
                    const rows = await fetcher();
                    addSheet(sheet, rows);
                    return rows;
                } catch (e: any) {
                    failures.push({ sheet, error: e?.message || 'unknown' });
                    addSheet(sheet, [{ warning: 'No disponible', detail: e?.message || 'Error al cargar datos' }]);
                    return [];
                }
            };

            addSheet('Meta', [{
                generated_at: new Date().toISOString(),
                from: exportFrom,
                to: exportTo,
                seller_scope: exportSellerId,
                sellers_count: sellerIds.length
            }]);
            addSheet('Sellers_Scope', sellerIds.map((id) => ({ seller_id: id, vendedor: repMap[id] || id })));

            const clientsRows = await safeFetch('Clients', async () => {
                const { data, error } = await supabase.from('clients').select('*').in('created_by', sellerIds).order('name');
                if (error) throw error;
                return data || [];
            });

            const visitsRows = await safeFetch('Visits', async () => {
                const { data, error } = await supabase
                    .from('visits')
                    .select('*')
                    .in('sales_rep_id', sellerIds)
                    .gte('check_in_time', fromIso)
                    .lte('check_in_time', toIso)
                    .order('check_in_time', { ascending: false });
                if (error) throw error;
                return data || [];
            });

            const ordersRows = await safeFetch('Orders', async () => {
                const { data, error } = await supabase
                    .from('orders')
                    .select('*')
                    .in('user_id', sellerIds)
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso)
                    .order('created_at', { ascending: false });
                if (error) throw error;
                return data || [];
            });

            const quotationsRows = await safeFetch('Quotations', async () => {
                const { data, error } = await supabase
                    .from('quotations')
                    .select('*')
                    .in('seller_id', sellerIds)
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso)
                    .order('created_at', { ascending: false });
                if (error) throw error;
                return data || [];
            });

            await safeFetch('Call_Logs', async () => {
                const { data, error } = await supabase.from('call_logs').select('*').in('user_id', sellerIds).gte('created_at', fromIso).lte('created_at', toIso);
                if (error) throw error;
                return data || [];
            });

            await safeFetch('Email_Logs', async () => {
                const { data, error } = await supabase.from('email_logs').select('*').in('user_id', sellerIds).gte('created_at', fromIso).lte('created_at', toIso);
                if (error) throw error;
                return data || [];
            });

            await safeFetch('Tasks', async () => {
                const { data: byUser, error: byUserError } = await supabase.from('tasks').select('*').in('user_id', sellerIds);
                if (byUserError) throw byUserError;
                const { data: byAssignee, error: byAssigneeError } = await supabase.from('tasks').select('*').in('assigned_to', sellerIds);
                if (byAssigneeError) throw byAssigneeError;
                const merged = [...(byUser || []), ...(byAssignee || [])];
                const map = new Map<string, any>();
                merged.forEach((t: any) => {
                    if (!t?.id) return;
                    if (!map.has(t.id)) map.set(t.id, t);
                });
                return Array.from(map.values());
            });

            await safeFetch('Route_Items', async () => {
                const orderIds = ordersRows.map((o: any) => o.id).filter(Boolean);
                if (orderIds.length === 0) return [];
                const { data, error } = await supabase.from('route_items').select('*').in('order_id', orderIds);
                if (error) throw error;
                return data || [];
            });

            await safeFetch('Delivery_Routes', async () => {
                const { data, error } = await supabase.from('delivery_routes').select('*').in('driver_id', sellerIds);
                if (error) throw error;
                return data || [];
            });

            await safeFetch('Approvals', async () => {
                const quoteIds = quotationsRows.map((q: any) => q.id).filter(Boolean);
                if (quoteIds.length === 0) return [];
                const { data, error } = await supabase.from('approval_requests').select('*').in('entity_id', quoteIds);
                if (error) throw error;
                return data || [];
            });

            await safeFetch('Client_Snapshot', async () => {
                const map = new Map<string, any>();
                clientsRows.forEach((c: any) => map.set(c.id, { client_id: c.id, client_name: c.name, status: c.status || '', created_by: c.created_by || '' }));
                visitsRows.forEach((v: any) => {
                    const r = map.get(v.client_id);
                    if (!r) return;
                    if (!r.last_visit || new Date(v.check_in_time).getTime() > new Date(r.last_visit).getTime()) r.last_visit = v.check_in_time;
                });
                ordersRows.forEach((o: any) => {
                    const r = map.get(o.client_id);
                    if (!r) return;
                    if (!r.last_sale || new Date(o.created_at).getTime() > new Date(r.last_sale).getTime()) r.last_sale = o.created_at;
                });
                return Array.from(map.values());
            });

            if (failures.length > 0) addSheet('Warnings', failures);
            XLSX.writeFile(wb, `datalake_crm_${exportFrom}_${exportTo}.xlsx`);
        } catch (err: any) {
            console.error('Export datalake error:', err);
            alert('Error exportando Data Lake CRM: ' + (err?.message || 'desconocido'));
        } finally {
            setExporting(false);
        }
    };

    const handleCleanGhostLeads = async () => {
        if (!canCleanGhostLeads) return;
        const confirmed = window.confirm('Esta acción archivará leads prospecto sin email/teléfono y sin movimiento por más de 60 días. ¿Deseas continuar?');
        if (!confirmed) return;

        setCleaningLeads(true);
        try {
            const { data, error } = await supabase.rpc('archive_abandoned_prospects');
            if (error) throw error;
            alert(`Limpieza ejecutada. Leads archivados: ${Number(data || 0)}.`);
        } catch (error: any) {
            alert(`No se pudo ejecutar la limpieza: ${error.message}`);
        } finally {
            setCleaningLeads(false);
        }
    };

    if (userLoading || (hasPermission('VIEW_TEAM_STATS') && loading && teamData.length === 0)) return <div className="p-8 text-center text-gray-500 italic font-black uppercase tracking-widest animate-pulse">Cargando ecosistema...</div>;
    if (!hasPermission('VIEW_TEAM_STATS')) return <Navigate to="/" />;

    return (
        <div className="space-y-8 max-w-6xl mx-auto pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 mb-2">Team Intelligence</h2>
                    <p className="text-gray-400 font-medium">Remote supervision & performance tracking</p>
                </div>
                <div className="flex items-center space-x-4">
                    <div className="bg-white border border-gray-100 rounded-2xl p-2 shadow-sm flex items-center">
                        <Calendar size={18} className="text-dental-500 ml-2 mr-3" />
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-transparent border-none outline-none font-bold text-gray-700 text-sm"
                        />
                    </div>
                </div>
            </div>

            <div className="premium-card p-5 border border-indigo-100">
                <div className="flex flex-col lg:flex-row lg:items-end gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Desde</label>
                            <input
                                type="date"
                                value={exportFrom}
                                onChange={(e) => setExportFrom(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 font-bold text-gray-700"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Hasta</label>
                            <input
                                type="date"
                                value={exportTo}
                                onChange={(e) => setExportTo(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 font-bold text-gray-700"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Vendedor</label>
                            <select
                                value={exportSellerId}
                                onChange={(e) => setExportSellerId(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 font-bold text-gray-700"
                            >
                                <option value="all">Todos</option>
                                {teamData.map((rep: any) => (
                                    <option key={rep.id} value={rep.id}>{rep.full_name || rep.email}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={exportSellerManagementReport}
                            disabled={exporting}
                            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-wider hover:bg-indigo-700 disabled:opacity-50 flex items-center"
                        >
                            <Download size={14} className="mr-2" />
                            {exporting ? 'Exportando...' : 'Exportar Gestión'}
                        </button>
                        <button
                            onClick={exportClientsIntelligenceReport}
                            disabled={exporting}
                            className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-black text-xs uppercase tracking-wider hover:bg-emerald-700 disabled:opacity-50 flex items-center"
                        >
                            <Download size={14} className="mr-2" />
                            {exporting ? 'Exportando...' : 'Exportar Clientes'}
                        </button>
                        <button
                            onClick={exportDataLakeReport}
                            disabled={exporting}
                            className="px-4 py-2.5 rounded-xl bg-amber-600 text-white font-black text-xs uppercase tracking-wider hover:bg-amber-700 disabled:opacity-50 flex items-center"
                        >
                            <Download size={14} className="mr-2" />
                            {exporting ? 'Exportando...' : 'Data Lake CRM'}
                        </button>
                        {canCleanGhostLeads && (
                            <button
                                onClick={handleCleanGhostLeads}
                                disabled={cleaningLeads}
                                className="px-4 py-2.5 rounded-xl bg-rose-600 text-white font-black text-xs uppercase tracking-wider hover:bg-rose-700 disabled:opacity-50"
                            >
                                {cleaningLeads ? 'Limpiando...' : 'Limpiar Leads Fantasma'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Live Status Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="premium-card p-6 border-l-4 border-l-blue-500 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                        <Clock size={48} />
                    </div>
                    <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-1">Live Activity</p>
                    <p className="text-3xl font-black text-gray-900">{stats.activeVisits}</p>
                    <p className="text-xs text-gray-400 font-bold mt-2">Active reps in field</p>
                </div>
                <div className="premium-card p-6 border-l-4 border-l-dental-500">
                    <p className="text-[10px] font-black text-dental-500 uppercase tracking-widest mb-1">Visits ({selectedDate})</p>
                    <p className="text-3xl font-black text-gray-900">{stats.totalVisits}</p>
                    <p className="text-xs text-gray-400 font-bold mt-2">Total daily logs</p>
                </div>
                <div className="premium-card p-6 border-l-4 border-l-orange-500">
                    <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">Action Required</p>
                    <p className="text-3xl font-black text-gray-900">{stats.pendingApprovals}</p>
                    <p className="text-xs text-gray-400 font-bold mt-2">Pending order reviews</p>
                </div>
                {hasPermission('VIEW_METAS') && (
                    <div className="premium-card p-6 border-l-4 border-l-green-500">
                        <p className="text-[10px] font-black text-green-500 uppercase tracking-widest mb-1">Sales Pipeline</p>
                        <p className="text-3xl font-black text-gray-900">${stats.teamValue.toLocaleString()}</p>
                        <p className="text-xs text-gray-400 font-bold mt-2">MTD Team Revenue</p>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                {/* Reps List */}
                <div className="xl:col-span-2 space-y-6">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center">
                        <Users size={20} className="mr-3 text-dental-500" />
                        Representative Performance
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {teamData.map(rep => {
                            const isActive = !!rep.isActive;
                            const pendingTasks = rep.tasks?.filter((t: any) => t.status === 'pending').length || 0;

                            return (
                                <div key={rep.id} className="premium-card p-6 space-y-4 group hover:ring-2 hover:ring-dental-100 transition-all">
                                    <div className="flex items-center justify-between">
                                        {/* ... User Info ... */}
                                        <div className="flex items-center space-x-3">
                                            <div className="relative">
                                                <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center font-bold text-gray-500 border border-gray-100 uppercase overflow-hidden shadow-sm">
                                                    {rep.email?.substring(0, 2)}
                                                </div>
                                                {isActive && (
                                                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white animate-pulse"></span>
                                                )}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-900 text-sm truncate w-32">{rep.email}</h4>
                                                <div className="flex items-center space-x-2">
                                                    <span className={`text-[9px] font-black uppercase tracking-tight ${isActive ? 'text-green-500' : 'text-gray-300'}`}>
                                                        {isActive ? 'Currently in Visit' : 'Available'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex space-x-2">
                                            {hasPermission('MANAGE_METAS') && (
                                                <button
                                                    onClick={() => handleOpenGoalModal(rep)}
                                                    className="p-3 bg-amber-50 text-amber-600 rounded-xl hover:bg-amber-500 hover:text-white transition-all shadow-sm"
                                                    title="Set Monthly Goal"
                                                >
                                                    <TrendingUp size={16} />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => { setSelectedRep(rep); setShowTaskModal(true); }}
                                                className="p-3 bg-dental-50 text-dental-600 rounded-xl hover:bg-dental-600 hover:text-white transition-all shadow-sm"
                                                title="Assign Task"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* ... metrics grid ... */}
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="bg-gray-50 p-3 rounded-2xl text-center">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase">Visits</p>
                                            <p className="text-sm font-black text-gray-900">{rep.visits?.length || 0}</p>
                                        </div>
                                        <div className="bg-gray-50 p-3 rounded-2xl text-center">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase">Tasks</p>
                                            <p className="text-sm font-black text-gray-900">{pendingTasks}</p>
                                        </div>
                                        <div className="bg-gray-50 p-3 rounded-2xl text-center">
                                            <p className="text-[9px] font-bold text-gray-400 uppercase">Sales</p>
                                            <p className="text-sm font-black text-dental-600">
                                                {hasPermission('VIEW_METAS') ? (
                                                    `$${(rep.monthSales || 0).toLocaleString()}`
                                                ) : '***'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* ... live path ... */}
                                    <div className="pt-2">
                                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3">Live Path</p>
                                        <div className="space-y-3">
                                            {rep.visits?.slice(0, 2).map((visit: any, idx: number) => (
                                                <div key={idx} className="flex items-start space-x-3">
                                                    <div className="w-1.5 h-1.5 bg-dental-500 rounded-full mt-1.5 shrink-0"></div>
                                                    <div className="min-w-0">
                                                        <p className="text-[11px] font-bold text-gray-800 truncate">{visit.clients?.name}</p>
                                                        <p className="text-[9px] text-gray-400 font-medium">Checked in: {new Date(visit.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                                    </div>
                                                </div>
                                            ))}
                                            {(!rep.visits || rep.visits.length === 0) && (
                                                <p className="text-[10px] text-gray-300 italic">No activity recorded for this rep yet.</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ... Tasks Queue ... */}
            </div>

            {/* Task Assignment Modal */}
            {showTaskModal && (
                // ... existing modal content ...
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
                    {/* ... (Keep existing modal code here, just verify closing tag) ... */}
                    <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-10 space-y-8 animate-in zoom-in duration-300 shadow-2xl">
                        {/* ... existing modal UI ... */}
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-3xl font-black text-gray-900">Assign Mission</h3>
                                <p className="text-gray-400 font-bold text-xs uppercase tracking-widest mt-1">Assigning to: {selectedRep?.email}</p>
                            </div>
                            <button onClick={() => setShowTaskModal(false)} className="p-4 bg-gray-50 text-gray-400 rounded-2xl">
                                <X size={24} />
                            </button>
                        </div>

                        {/* ... form content ... */}
                        <div className="space-y-5">
                            {/* ... */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Task Title</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Deliver Demo Unit"
                                    className="w-full p-5 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-dental-500 font-bold text-gray-700"
                                    value={newTask.title}
                                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                                />
                            </div>
                            {/* ... more fields ... */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Description (Optional)</label>
                                <textarea
                                    placeholder="Provide specific instructions..."
                                    className="w-full p-5 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-dental-500 font-bold text-gray-700 h-24 resize-none"
                                    value={newTask.description}
                                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-5">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Assign to Clinic</label>
                                    <select
                                        className="w-full p-5 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-dental-500 font-bold text-gray-500"
                                        value={newTask.clientId}
                                        onChange={(e) => setNewTask({ ...newTask, clientId: e.target.value })}
                                    >
                                        <option value="">Select Clinic</option>
                                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Due Date</label>
                                    <input
                                        type="date"
                                        className="w-full p-5 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-dental-500 font-bold text-gray-500"
                                        value={newTask.dueDate}
                                        onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <button
                                onClick={() => setShowTaskModal(false)}
                                className="flex-1 py-5 font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest text-xs"
                            >
                                Cancel Assignment
                            </button>
                            <button
                                onClick={handleAssignTask}
                                className="flex-[2] bg-dental-600 text-white py-5 rounded-[1.5rem] font-black shadow-2xl shadow-dental-200 active:scale-95 transition-all uppercase tracking-widest text-xs"
                            >
                                Deploy Mission
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* NEW: Goal Configuration Modal */}
            {showGoalModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-6 animate-in zoom-in duration-300 shadow-2xl">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-2xl font-black text-gray-900">Configurar Meta</h3>
                                <p className="text-gray-400 font-bold text-[10px] uppercase tracking-widest mt-1">
                                    {selectedRep?.email} • {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
                                </p>
                            </div>
                            <button onClick={() => setShowGoalModal(false)} className="p-3 bg-gray-50 text-gray-400 rounded-2xl">
                                <X size={20} />
                            </button>
                        </div>

                        {loadingGoal ? (
                            <div className="py-8 text-center text-gray-400 italic text-xs">Cargando meta actual...</div>
                        ) : (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Meta de Venta ($)</label>
                                    <input
                                        type="number"
                                        placeholder="0"
                                        className="w-full p-4 bg-emerald-50 text-emerald-800 border-none rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 font-black text-xl"
                                        value={goalForm.targetAmount}
                                        onChange={(e) => setGoalForm({ ...goalForm, targetAmount: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">% Comisión</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.1"
                                            placeholder="1.0"
                                            className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-dental-500 font-bold text-gray-700"
                                            value={goalForm.commissionRate}
                                            onChange={(e) => setGoalForm({ ...goalForm, commissionRate: e.target.value })}
                                        />
                                        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400 font-black">%</span>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Meta Visitas / Día</label>
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="8"
                                        className="w-full p-4 bg-indigo-50 text-indigo-800 border-none rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 font-black text-xl"
                                        value={goalForm.dailyVisitsGoal}
                                        onChange={(e) => setGoalForm({ ...goalForm, dailyVisitsGoal: e.target.value })}
                                    />
                                </div>

                                <button
                                    onClick={handleSaveGoal}
                                    className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black shadow-lg shadow-emerald-200 active:scale-95 transition-all uppercase tracking-widest text-xs mt-2"
                                >
                                    Guardar Meta
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TeamStats;
