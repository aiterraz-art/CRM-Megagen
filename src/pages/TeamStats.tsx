import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Users, TrendingUp, Calendar, MapPin, ChevronRight, LayoutDashboard, Clock, CheckCircle2, AlertCircle, Plus, X } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';

const TeamStats = () => {
    const { isSupervisor, isManager, isChief, hasPermission, permissions, loading: userLoading, profile: currentUser } = useUser();
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
    const [goalForm, setGoalForm] = useState({ targetAmount: '', commissionRate: '1.0' });
    const [loadingGoal, setLoadingGoal] = useState(false);

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
                commissionRate: (data.commission_rate * 100).toString() // Convert 0.01 to 1%
            });
        } else {
            setGoalForm({ targetAmount: '0', commissionRate: '1.0' }); // Default 1%
        }
        setLoadingGoal(false);
    };

    const handleSaveGoal = async () => {
        if (!selectedRep) return;

        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();
        const rateDecimal = parseFloat(goalForm.commissionRate) / 100;

        const { error } = await supabase
            .from('goals')
            .upsert({
                user_id: selectedRep.id,
                month: currentMonth,
                year: currentYear,
                target_amount: parseFloat(goalForm.targetAmount),
                commission_rate: rateDecimal
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
        // Start of the selected day
        const dayStart = `${selectedDate}T00:00:00Z`;
        const dayEnd = `${selectedDate}T23:59:59Z`;



        // 1. Fetch profiles + visits + orders
        let query = supabase.from('profiles').select(`
            *,
            visits(*, clients(name), orders(*))
        `);

        // SECURITY REINFORCEMENT V7 (RADICAL):
        // Only literal 'manager' or 'admin' roles can bypass the supervisor filter.
        // We do a triple check here.
        const userRole = (currentUser?.role || '').toLowerCase();
        const isActuallyManager = userRole === 'manager' || userRole === 'admin';
        const isActuallyChief = userRole === 'jefe';

        console.log("TeamStats DEBUG V7:", {
            email: currentUser?.email,
            dbRole: currentUser?.role,
            isActuallyManager,
            isActuallyChief,
            canViewAll: isActuallyManager && !isActuallyChief
        });

        // Fail-safe: If anything is ambiguous, we restrict to subordinates.
        let finalCanViewAll = isActuallyManager;
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

        if (profilesData) {
            // 2. SAFE MANUAL FETCH for Tasks to avoid FK issues
            // We'll try to fetch from 'tasks' table first as it's in the types, filter by assigned_to
            const subordinatesIds = profilesData.map((p: any) => p.id);

            // Try fetching from 'tasks' using 'assigned_to'
            const { data: tasksData, error: tasksError } = await supabase
                .from('tasks')
                .select('*')
                .in('assigned_to', subordinatesIds)
                .eq('status', 'pending');

            console.log("TeamStats DEBUG V5 (Tasks):", { tasksData, tasksError });

            // Merge tasks into profiles
            const fullTeamData = profilesData.map((rep: any) => {
                const repTasks = tasksData?.filter((t: any) => t.assigned_to === rep.id) || [];
                // We map it to the structure expected by the UI (calling it 'tasks' property)
                return { ...rep, tasks: repTasks };
            });

            setTeamData(fullTeamData);

            let totalV = 0;
            let pendingA = 0;
            let val = 0;
            let active = 0;

            fullTeamData.forEach((rep: any) => {
                // Total visits for selected date
                const dayVisits = rep.visits?.filter((v: any) => v.check_in_time >= dayStart && v.check_in_time <= dayEnd);
                totalV += dayVisits?.length || 0;

                // Active visits (no check-out)
                const isWorking = rep.visits?.some((v: any) => v.check_in_time && !v.check_out_time);
                if (isWorking) active++;

                // Orders via visits
                rep.visits?.forEach((v: any) => {
                    v.orders?.forEach((o: any) => {
                        if (o.status === 'pending') pendingA++;
                        val += o.total_amount || 0;
                    });
                });
            });

            setStats({ totalVisits: totalV, pendingApprovals: pendingA, teamValue: val, activeVisits: active });
        }


        setLoading(false);
    };

    const handleAssignTask = async () => {
        if (!newTask.title || !selectedRep || !currentUser) return;

        const { error } = await (supabase.from('tasks') as any).insert({
            assigned_to: selectedRep.id,
            assigned_by: currentUser.id,
            title: newTask.title,
            description: newTask.description,
            client_id: newTask.clientId || null,
            due_date: newTask.dueDate || null,
            status: 'pending'
        });

        if (!error) {
            setShowTaskModal(false);
            setNewTask({ title: '', description: '', clientId: '', dueDate: '' });
            fetchTeamData();
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
                            const isActive = rep.visits?.some((v: any) => v.check_in_time && !v.check_out_time);
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
                                                    <span className={`text - [9px] font - black uppercase tracking - tighter ${isActive ? 'text-green-500' : 'text-gray-300'} `}>
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
                                                    `$${rep.visits?.reduce((accV: number, visit: any) => {
                                                        return accV + (visit.orders?.reduce((accO: number, order: any) => accO + (order.total_amount || 0), 0) || 0);
                                                    }, 0).toLocaleString()}`
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
