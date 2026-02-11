import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Calendar as CalendarIcon, Clock, MapPin, RefreshCw, Plus, ChevronLeft, ChevronRight, CheckCircle2, Bell, Users, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import ScheduleVisitModal from '../components/modals/ScheduleVisitModal';
import ScheduleActivityModal from '../components/modals/ScheduleActivityModal';

interface CalendarEvent {
    id: string;
    summary: string;
    description?: string;
    start: { dateTime?: string; date?: string };
    location?: string;
    source: 'google' | 'crm' | 'internal';
    clientId?: string;
}

const Schedule = () => {
    const navigate = useNavigate();
    const { profile, isSupervisor, hasPermission } = useUser();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Supervisor Features
    const [sellers, setSellers] = useState<any[]>([]);
    const [selectedSellerId, setSelectedSellerId] = useState<string>('');
    const [showAddModal, setShowAddModal] = useState(false);

    useEffect(() => {
        if (profile?.id && !selectedSellerId) {
            setSelectedSellerId(profile.id);
        }
    }, [profile]);

    useEffect(() => {
        const fetchSellers = async () => {
            if (isSupervisor || hasPermission('VIEW_ALL_TEAM_STATS')) {
                const { data } = await supabase.from('profiles')
                    .select('id, full_name, email, role')
                    .order('full_name');
                if (data) setSellers(data);
            }
        };
        fetchSellers();
    }, [isSupervisor, hasPermission]);


    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => {
        const day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1;
    };

    const fetchAllEvents = async () => {
        if (!selectedSellerId) return;

        setLoading(true);
        const allEvents: CalendarEvent[] = [];
        const isSelf = selectedSellerId === profile?.id;
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString();
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59).toISOString();

        // 1. Google Events (Only Self)
        if (isSelf) {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.provider_token) {
                    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${startOfMonth}&timeMax=${endOfMonth}&singleEvents=true`, {
                        headers: { Authorization: `Bearer ${session.provider_token}` }
                    });
                    const data = await response.json();
                    if (data.items) {
                        allEvents.push(...data.items.map((item: any) => ({
                            id: item.id,
                            summary: item.summary,
                            description: item.description,
                            start: item.start,
                            location: item.location,
                            source: 'google' as const
                        })));
                    }
                }
            } catch (err) {
                console.warn("Google Calendar sync skipped/failed");
            }
        }

        // 2. CRM Visits
        try {
            const { data: visits } = await supabase
                .from('visits')
                .select('*, clients(name, address)')
                .eq('sales_rep_id', selectedSellerId)
                .eq('status', 'scheduled')
                .gte('check_in_time', startOfMonth)
                .lte('check_in_time', endOfMonth);

            if (visits) {
                const knownGoogleEventIds = new Set(visits.map(v => v.google_event_id).filter(Boolean));
                const uniqueGoogleEvents = allEvents.filter(e => e.source === 'google' && !knownGoogleEventIds.has(e.id));

                allEvents.length = 0;
                allEvents.push(...uniqueGoogleEvents);

                allEvents.push(...visits.map(visit => ({
                    id: visit.id,
                    summary: visit.title || `Visita: ${visit.clients?.name || 'Cliente'}`,
                    description: visit.notes || '',
                    start: { dateTime: visit.check_in_time },
                    location: visit.clients?.address || '',
                    source: 'crm' as const,
                    clientId: visit.client_id
                })));
            }
        } catch (err) {
            console.error("CRM Visits error:", err);
        }

        // 3. Internal Meetings (crm_tasks)
        try {
            const { data: internalTasks } = await supabase
                .from('crm_tasks')
                .select('*')
                .eq('assigned_to', selectedSellerId)
                .gte('due_date', startOfMonth)
                .lte('due_date', endOfMonth)
                .not('due_date', 'is', null);

            if (internalTasks) {
                allEvents.push(...internalTasks.map(task => ({
                    id: task.id,
                    summary: task.title || 'Reunión Interna',
                    description: task.description || '',
                    start: { dateTime: task.due_date },
                    location: 'Interno / Oficina',
                    source: 'internal' as const
                })));
            }
        } catch (err) {
            console.error("Internal Tasks error:", err);
        }

        setEvents(allEvents);
        setLoading(false);
    };

    const fetchTasks = async () => {
        if (!selectedSellerId) return;
        const { data } = await supabase.from('crm_tasks')
            .select('*, clients(name)')
            .eq('assigned_to', selectedSellerId)
            .eq('status', 'pending');
        if (data) setTasks(data);
    };

    const deleteVisit = async (visitId: string) => {
        if (!window.confirm('¿Estás seguro de eliminar esta visita de la agenda? Esta acción es irreversible.')) return;

        try {
            console.log("Attempting to delete visit:", visitId);
            const { error } = await supabase.from('visits').delete().eq('id', visitId);
            if (error) {
                console.error("Supabase Deletion Error:", error);
                throw error;
            }
            console.log("Deletion successful, refreshing events...");
            fetchAllEvents();
        } catch (error: any) {
            console.error("Error deleting visit:", error);
            alert(`Error al eliminar la visita: ${error.message}. Verifica permisos.`);
        }
    };

    useEffect(() => {
        fetchAllEvents();
        fetchTasks();
    }, [currentDate, selectedSellerId]);

    const handlePrevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const handleNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    const handleToday = () => setCurrentDate(new Date());

    const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
    const firstDay = getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth());
    const emptySlots = Array(firstDay).fill(null);
    const daySlots = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const isToday = (day: number) => {
        const today = new Date();
        return day === today.getDate() && currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear();
    };

    const getEventsForDay = (day: number) => {
        return events.filter(event => {
            const eventDate = new Date(event.start.dateTime || event.start.date || '');
            return eventDate.getDate() === day && eventDate.getMonth() === currentDate.getMonth() && eventDate.getFullYear() === currentDate.getFullYear();
        });
    };

    return (
        <div className="flex h-full gap-8">
            <div className="flex-1 space-y-6 flex flex-col">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-4xl font-black text-gray-900">Agenda</h2>
                        {isSupervisor && <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">Vista de Supervisor</p>}
                    </div>

                    <div className="flex items-center gap-4">
                        {(isSupervisor || hasPermission('VIEW_ALL_TEAM_STATS')) && sellers.length > 0 && (
                            <div className="relative bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center px-4 py-2 group hover:border-indigo-200 transition-colors">
                                <Users size={16} className="text-gray-400 mr-3" />
                                <div className="text-xs">
                                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Viendo Agenda de</p>
                                    <select
                                        value={selectedSellerId}
                                        onChange={(e) => setSelectedSellerId(e.target.value)}
                                        className="bg-transparent border-none text-gray-800 font-bold text-sm focus:ring-0 p-0 pr-6 w-40 cursor-pointer outline-none"
                                    >
                                        {sellers.map(s => (
                                            <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        <div className="flex items-center bg-white rounded-2xl border border-gray-100 p-1.5 shadow-sm">
                            <button onClick={handlePrevMonth} className="p-2 hover:bg-gray-50 rounded-xl"><ChevronLeft size={18} /></button>
                            <button onClick={handleToday} className="px-6 py-2 text-sm font-bold text-dental-600 bg-dental-50 rounded-xl mx-2">
                                {currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
                            </button>
                            <button onClick={handleNextMonth} className="p-2 hover:bg-gray-50 rounded-xl"><ChevronRight size={18} /></button>
                        </div>

                        <button
                            onClick={() => setShowAddModal(true)}
                            className="bg-orange-500 text-white p-4 rounded-2xl shadow-lg hover:bg-orange-600 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 font-bold"
                            title="Asignar Reunión/Actividad"
                        >
                            <Plus size={20} />
                            <span className="hidden xl:inline">Asignar</span>
                        </button>
                    </div>
                </div>

                <div className="premium-card flex-1 overflow-hidden flex flex-col p-0">
                    <div className="grid grid-cols-7 border-b border-gray-100 py-4 bg-gray-50/50">
                        {['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'].map(day => (
                            <div key={day} className="text-center text-[10px] font-black text-gray-400 tracking-widest">{day}</div>
                        ))}
                    </div>
                    <div className="flex-1 grid grid-cols-7 grid-rows-5 auto-rows-fr">
                        {emptySlots.map((_, i) => (
                            <div key={`empty-${i}`} className="border-r border-b border-gray-50 p-2 bg-gray-50/30"></div>
                        ))}
                        {daySlots.map((day) => {
                            const dayEvents = getEventsForDay(day);
                            return (
                                <div key={day} className={`border-r border-b border-gray-50 p-2 flex flex-col gap-1 transition-colors hover:bg-gray-50/50 ${isToday(day) ? 'bg-dental-50/30' : ''}`}>
                                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mb-1
                                        ${isToday(day) ? 'bg-dental-600 text-white shadow-lg shadow-dental-200' : 'text-gray-400'}`}>
                                        {day}
                                    </span>

                                    <div className="space-y-1 overflow-y-auto max-h-[100px] no-scrollbar">
                                        {dayEvents.map(event => (
                                            <div key={event.id} className={`p-1.5 rounded-lg text-[10px] truncate cursor-pointer group relative font-bold
                                                ${event.source === 'crm' ? 'bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100' :
                                                    event.source === 'internal' ? 'bg-orange-50 text-orange-700 border border-orange-100 hover:bg-orange-100' :
                                                        'bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100'}`}>

                                                <div className="flex items-center gap-1">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${event.source === 'crm' ? 'bg-purple-500' :
                                                        event.source === 'internal' ? 'bg-orange-500' : 'bg-blue-500'}`}></div>
                                                    {event.start.dateTime && new Date(event.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                                <div className="truncate font-medium" title={event.summary}>{event.summary}</div>
                                                <div className="absolute hidden group-hover:block z-50 left-0 top-full mt-1 w-48 bg-gray-800 text-white p-2 rounded-lg shadow-xl text-xs whitespace-normal">
                                                    <p className="font-bold mb-1">{event.summary} {event.source === 'internal' && '(Interno)'}</p>
                                                    {event.description && <p className="opacity-80 italic mb-2">{event.description.substring(0, 50)}...</p>}

                                                    {/* Actions */}
                                                    {(event.source === 'crm' && (isSupervisor || selectedSellerId === profile?.id)) && (
                                                        <div className="flex gap-2 border-t border-white/20 pt-2 mt-1">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); deleteVisit(event.id); }}
                                                                className="flex items-center gap-1 text-red-300 hover:text-red-100"
                                                            >
                                                                Eliminar
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="w-80 flex flex-col space-y-6 shrink-0">
                <div className="premium-card p-6 bg-gray-900 text-white space-y-4">
                    <div className="flex justify-between items-center text-white/40">
                        <span className="text-[10px] font-black uppercase tracking-widest">Actividades Pendientes</span>
                        <Bell size={14} className="animate-pulse" />
                    </div>
                    {tasks.length === 0 ? (
                        <p className="text-xs text-white/30 italic py-4">Sin actividades pendientes.</p>
                    ) : (
                        <div className="space-y-4">
                            {tasks.slice(0, 5).map(task => (
                                <div key={task.id} className="bg-white/5 border border-white/10 p-4 rounded-2xl group hover:bg-white/10 transition-all cursor-pointer">
                                    <div className="flex justify-between items-start">
                                        <p className="text-xs font-black text-white">{task.title}</p>
                                    </div>
                                    <p className="text-[9px] text-white/40 mt-1 uppercase font-bold">
                                        {task.clients?.name ? `Cliente: ${task.clients.name}` : 'Interno'}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-1 bg-white rounded-[2.5rem] shadow-sm border border-gray-100 p-6 space-y-6 flex flex-col">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-8 rounded-full bg-indigo-500"></div>
                            <div>
                                <h3 className="font-bold text-gray-900 text-lg leading-none">Próximos</h3>
                                <p className="text-[10px] uppercase font-black text-gray-400 tracking-widest">Eventos del Mes</p>
                            </div>
                        </div>
                        <button onClick={fetchAllEvents} className={`text-dental-500 hover:rotate-180 transition-transform duration-500 ${loading ? 'animate-spin' : ''}`}><RefreshCw size={14} /></button>
                    </div>

                    <div className="space-y-3 overflow-y-auto flex-1">
                        {events.sort((a, b) => new Date(a.start.dateTime || a.start.date || '').getTime() - new Date(b.start.dateTime || b.start.date || '').getTime())
                            .filter(e => new Date(e.start.dateTime || e.start.date || '') >= new Date())
                            .slice(0, 10)
                            .map(event => {
                                const eventDate = new Date(event.start.dateTime || event.start.date || '');
                                return (
                                    <div key={event.id} className="flex items-start space-x-3 p-3 hover:bg-gray-50 rounded-2xl transition-colors cursor-pointer group">
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm
                                        ${event.source === 'crm' ? 'bg-purple-100 text-purple-600' :
                                                event.source === 'internal' ? 'bg-orange-100 text-orange-600' :
                                                    'bg-blue-100 text-blue-600'}`}>
                                            <div className="text-center">
                                                <p className="text-[9px] font-black uppercase leading-none opacity-60">{eventDate.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3)}</p>
                                                <p className="text-lg font-black leading-none mt-0.5">{eventDate.getDate()}</p>
                                            </div>
                                        </div>
                                        <div className="min-w-0 flex-1 py-1">
                                            <p className="text-xs font-bold text-gray-900 truncate group-hover:text-indigo-600 transition-colors">{event.summary}</p>
                                            <p className="text-[10px] text-gray-400 font-medium truncate mt-0.5">{event.description || 'Sin detalles'}</p>
                                            <div className="flex items-center gap-2 mt-1.5">
                                                <span className="text-[10px] font-bold text-gray-500 bg-white border border-gray-100 px-1.5 py-0.5 rounded-md shadow-sm">
                                                    {event.start.dateTime
                                                        ? eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                                        : 'Todo el día'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        {events.length === 0 && !loading && <p className="text-xs text-gray-400 text-center py-4">No hay eventos próximos.</p>}
                    </div>
                </div>
            </div>

            <ScheduleActivityModal
                preSelectedAssigneeId={selectedSellerId}
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSaved={() => {
                    fetchAllEvents();
                    fetchTasks();
                }}
            />
        </div>
    );
};

export default Schedule;
