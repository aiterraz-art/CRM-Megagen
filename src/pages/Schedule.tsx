import { useEffect, useMemo, useState } from 'react';
import { Calendar as CalendarIcon, Clock, RefreshCw, Plus, ChevronLeft, ChevronRight, Bell, Users } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import ScheduleActivityModal from '../components/modals/ScheduleActivityModal';
import ScheduleEventDetailsModal from '../components/modals/ScheduleEventDetailsModal';
import { googleService } from '../services/googleService';
import { CalendarEvent, GoogleCalendarAttendee } from '../types/calendar';

const mapGoogleAttendees = (attendees: any[] | undefined): GoogleCalendarAttendee[] =>
    Array.isArray(attendees)
        ? attendees.map((attendee) => ({
            email: attendee.email,
            displayName: attendee.displayName,
            responseStatus: attendee.responseStatus,
            self: attendee.self,
            organizer: attendee.organizer,
        }))
        : [];

const mapGoogleEvent = (item: any, calendarId: string): CalendarEvent => {
    const attendees = mapGoogleAttendees(item.attendees);
    return {
        id: `google:${calendarId}:${item.id}`,
        summary: item.summary || 'Evento Google',
        description: item.description || '',
        start: item.start || {},
        end: item.end || undefined,
        location: item.location || '',
        source: 'google',
        linkedEntityType: 'google',
        googleBacked: true,
        googleEventId: item.id,
        calendarId,
        htmlLink: item.htmlLink,
        meetLink: item.hangoutLink || item.conferenceData?.entryPoints?.find((entry: any) => entry.entryPointType === 'video')?.uri,
        attendees,
        organizerName: item.organizer?.displayName,
        organizerEmail: item.organizer?.email,
        creatorName: item.creator?.displayName,
        creatorEmail: item.creator?.email,
        selfResponseStatus: attendees.find((attendee) => attendee.self)?.responseStatus,
    };
};

const Schedule = () => {
    const { profile, isSupervisor, hasPermission } = useUser();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [tasks, setTasks] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [googleCalendarNotice, setGoogleCalendarNotice] = useState<string | null>(null);
    const [sellers, setSellers] = useState<any[]>([]);
    const [selectedSellerId, setSelectedSellerId] = useState<string>('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

    const canViewSharedGoogleCalendars = hasPermission('VIEW_TEAM_CALENDARS');
    const canSelectOtherCalendars = isSupervisor || hasPermission('VIEW_ALL_TEAM_STATS') || canViewSharedGoogleCalendars;

    useEffect(() => {
        if (profile?.id && !selectedSellerId) {
            setSelectedSellerId(profile.id);
        }
    }, [profile, selectedSellerId]);

    useEffect(() => {
        const fetchSellers = async () => {
            if (!canSelectOtherCalendars) return;
            const { data } = await supabase.from('profiles')
                .select('id, full_name, email, role')
                .order('full_name');
            if (data) setSellers(data);
        };
        void fetchSellers();
    }, [canSelectOtherCalendars]);

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => {
        const day = new Date(year, month, 1).getDay();
        return day === 0 ? 6 : day - 1;
    };

    const fetchTasksCompat = async (options?: {
        withClientJoin?: boolean;
        pendingOnly?: boolean;
        requireDueDate?: boolean;
        startDate?: string;
        endDate?: string;
    }) => {
        if (!selectedSellerId) return [];

        const { withClientJoin, pendingOnly, requireDueDate, startDate, endDate } = options || {};
        const taskTables: Array<'tasks' | 'crm_tasks'> = ['tasks', 'crm_tasks'];
        const ownerStrategies: Array<'or' | 'user_id' | 'assigned_to'> = ['or', 'user_id', 'assigned_to'];
        let lastError: any = null;

        for (const table of taskTables) {
            for (const strategy of ownerStrategies) {
                try {
                    let query: any = supabase
                        .from(table)
                        .select(withClientJoin ? '*, clients(name)' : '*');

                    if (strategy === 'or') {
                        query = query.or(`user_id.eq.${selectedSellerId},assigned_to.eq.${selectedSellerId}`);
                    } else {
                        query = query.eq(strategy, selectedSellerId);
                    }

                    if (pendingOnly) query = query.eq('status', 'pending');
                    if (requireDueDate) query = query.not('due_date', 'is', null);
                    if (startDate) query = query.gte('due_date', startDate);
                    if (endDate) query = query.lte('due_date', endDate);

                    const { data, error } = await query;
                    if (!error) return data || [];
                    lastError = error;
                } catch (error) {
                    lastError = error;
                }
            }
        }

        if (lastError) {
            console.error("Tasks compatibility query failed:", lastError);
        }
        return [];
    };

    const fetchAllEvents = async () => {
        if (!selectedSellerId) return;

        setLoading(true);
        setGoogleCalendarNotice(null);

        const isSelf = selectedSellerId === profile?.id;
        const selectedSeller = sellers.find((seller) => seller.id === selectedSellerId);
        const selectedSellerEmail = (selectedSeller?.email || (isSelf ? profile?.email : '') || '').trim().toLowerCase();
        const calendarId = isSelf ? 'primary' : selectedSellerEmail;
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString();
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59).toISOString();

        const googleEvents: CalendarEvent[] = [];
        const googleEventsById = new Map<string, CalendarEvent>();
        const knownLinkedGoogleIds = new Set<string>();

        if (isSelf || (selectedSellerEmail && canViewSharedGoogleCalendars)) {
            try {
                const data = await googleService.fetchGoogleJson<any>(
                    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(startOfMonth)}&timeMax=${encodeURIComponent(endOfMonth)}&singleEvents=true&orderBy=startTime&fields=items(id,summary,description,start,end,location,htmlLink,hangoutLink,conferenceData,attendees(email,displayName,responseStatus,self,organizer),organizer(email,displayName),creator(email,displayName))`
                );

                (data.items || []).forEach((item: any) => {
                    const event = mapGoogleEvent(item, calendarId);
                    googleEvents.push(event);
                    if (event.googleEventId) {
                        googleEventsById.set(event.googleEventId, event);
                    }
                });
            } catch (error: any) {
                console.warn('Google Calendar fetch failed', error);
                if (!isSelf && selectedSellerEmail) {
                    setGoogleCalendarNotice(`No se pudo leer Google Calendar de ${selectedSeller?.full_name || selectedSellerEmail}. Verifica acceso compartido en Google Workspace.`);
                } else if (isSelf) {
                    setGoogleCalendarNotice(error.message || 'No se pudo sincronizar Google Calendar.');
                }
            }
        } else if (!isSelf && selectedSellerEmail) {
            setGoogleCalendarNotice('Tu rol no tiene permiso para leer Google Calendar de otros vendedores.');
        } else if (!isSelf) {
            setGoogleCalendarNotice('El vendedor seleccionado no tiene correo corporativo para consultar Google Calendar.');
        }

        const mergedEvents: CalendarEvent[] = [];

        try {
            const { data: visits } = await supabase
                .from('visits')
                .select('*, clients(name, address)')
                .eq('sales_rep_id', selectedSellerId)
                .eq('status', 'scheduled')
                .gte('check_in_time', startOfMonth)
                .lte('check_in_time', endOfMonth);

            (visits || []).forEach((visit: any) => {
                const linkedGoogleEvent = visit.google_event_id ? googleEventsById.get(visit.google_event_id) : undefined;
                if (visit.google_event_id) knownLinkedGoogleIds.add(visit.google_event_id);

                mergedEvents.push({
                    id: `visit:${visit.id}`,
                    summary: visit.title || visit.purpose || linkedGoogleEvent?.summary || `Visita: ${visit.clients?.name || 'Cliente'}`,
                    description: visit.notes || linkedGoogleEvent?.description || '',
                    start: linkedGoogleEvent?.start || { dateTime: visit.check_in_time },
                    end: linkedGoogleEvent?.end,
                    location: visit.clients?.address || linkedGoogleEvent?.location || '',
                    source: 'crm',
                    clientId: visit.client_id,
                    linkedEntityType: 'visit',
                    linkedEntityId: visit.id,
                    googleBacked: Boolean(linkedGoogleEvent || visit.google_event_id),
                    googleEventId: visit.google_event_id || linkedGoogleEvent?.googleEventId,
                    calendarId: linkedGoogleEvent?.calendarId,
                    htmlLink: linkedGoogleEvent?.htmlLink,
                    meetLink: linkedGoogleEvent?.meetLink,
                    attendees: linkedGoogleEvent?.attendees,
                    organizerName: linkedGoogleEvent?.organizerName,
                    organizerEmail: linkedGoogleEvent?.organizerEmail,
                    creatorName: linkedGoogleEvent?.creatorName,
                    creatorEmail: linkedGoogleEvent?.creatorEmail,
                    selfResponseStatus: linkedGoogleEvent?.selfResponseStatus,
                });
            });
        } catch (err) {
            console.error("CRM Visits error:", err);
        }

        try {
            const internalTasks = await fetchTasksCompat({
                requireDueDate: true,
                startDate: startOfMonth,
                endDate: endOfMonth
            });

            (internalTasks || []).forEach((task: any) => {
                const linkedGoogleEvent = task.google_event_id ? googleEventsById.get(task.google_event_id) : undefined;
                if (task.google_event_id) knownLinkedGoogleIds.add(task.google_event_id);

                mergedEvents.push({
                    id: `task:${task.id}`,
                    summary: task.title || linkedGoogleEvent?.summary || 'Reunión Interna',
                    description: task.description || linkedGoogleEvent?.description || '',
                    start: linkedGoogleEvent?.start || { dateTime: task.due_date },
                    end: linkedGoogleEvent?.end || (task.end_date ? { dateTime: task.end_date } : undefined),
                    location: linkedGoogleEvent?.location || 'Interno / Oficina',
                    source: 'internal',
                    linkedEntityType: 'task',
                    linkedEntityId: task.id,
                    googleBacked: Boolean(linkedGoogleEvent || task.google_event_id),
                    googleEventId: task.google_event_id || linkedGoogleEvent?.googleEventId,
                    calendarId: linkedGoogleEvent?.calendarId || task.google_calendar_id || undefined,
                    htmlLink: linkedGoogleEvent?.htmlLink || task.google_html_link || undefined,
                    meetLink: linkedGoogleEvent?.meetLink,
                    attendees: linkedGoogleEvent?.attendees,
                    organizerName: linkedGoogleEvent?.organizerName,
                    organizerEmail: linkedGoogleEvent?.organizerEmail,
                    creatorName: linkedGoogleEvent?.creatorName,
                    creatorEmail: linkedGoogleEvent?.creatorEmail,
                    selfResponseStatus: linkedGoogleEvent?.selfResponseStatus,
                });
            });
        } catch (err) {
            console.error("Internal Tasks error:", err);
        }

        const uniqueGoogleEvents = googleEvents.filter((event) => !knownLinkedGoogleIds.has(event.googleEventId || ''));
        setEvents([...uniqueGoogleEvents, ...mergedEvents]);
        setLoading(false);
    };

    const fetchTasks = async () => {
        if (!selectedSellerId) return;
        const data = await fetchTasksCompat({
            withClientJoin: true,
            pendingOnly: true
        });
        setTasks(data || []);
    };

    const deleteVisit = async (visitId: string) => {
        if (!window.confirm('¿Estás seguro de eliminar esta visita de la agenda? Esta acción es irreversible.')) return;

        try {
            const { data: visit, error: visitError } = await supabase
                .from('visits')
                .select('id, google_event_id')
                .eq('id', visitId)
                .maybeSingle();
            if (visitError) throw visitError;

            if (visit?.google_event_id && selectedSellerId === profile?.id) {
                try {
                    await googleService.fetchGoogle(
                        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(visit.google_event_id)}`,
                        { method: 'DELETE' }
                    );
                } catch (googleError) {
                    console.warn('No se pudo eliminar el evento Google asociado', googleError);
                }
            }

            const { error } = await supabase.from('visits').delete().eq('id', visitId);
            if (error) throw error;
            await fetchAllEvents();
        } catch (error: any) {
            console.error("Error deleting visit:", error);
            alert(`Error al eliminar la visita: ${error.message}. Verifica permisos.`);
        }
    };

    useEffect(() => {
        void fetchAllEvents();
        void fetchTasks();
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

    const getEventsForDay = (day: number) =>
        events.filter(event => {
            const eventDate = new Date(event.start.dateTime || event.start.date || '');
            return eventDate.getDate() === day && eventDate.getMonth() === currentDate.getMonth() && eventDate.getFullYear() === currentDate.getFullYear();
        });

    const formatEventTimeRange = (event: CalendarEvent) => {
        if (!event.start.dateTime) return 'Todo el día';
        const start = new Date(event.start.dateTime);
        const startLabel = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (!event.end?.dateTime) return startLabel;
        const end = new Date(event.end.dateTime);
        const endLabel = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${startLabel} - ${endLabel}`;
    };

    const sortedUpcomingEvents = useMemo(
        () => [...events]
            .sort((a, b) => new Date(a.start.dateTime || a.start.date || '').getTime() - new Date(b.start.dateTime || b.start.date || '').getTime())
            .filter((event) => new Date(event.start.dateTime || event.start.date || '') >= new Date())
            .slice(0, 10),
        [events]
    );

    return (
        <div className="flex h-full gap-8">
            <div className="flex-1 space-y-6 flex flex-col">
                <div className="flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-4xl font-black text-gray-900">Agenda</h2>
                        {isSupervisor && <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">Vista de Supervisor</p>}
                        {googleCalendarNotice && (
                            <p className="text-xs text-amber-600 font-bold mt-2 max-w-xl">{googleCalendarNotice}</p>
                        )}
                    </div>

                    <div className="flex items-center gap-4">
                        {canSelectOtherCalendars && sellers.length > 0 && (
                            <div className="relative bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center px-4 py-2 group hover:border-indigo-200 transition-colors">
                                <Users size={16} className="text-gray-400 mr-3" />
                                <div className="text-xs">
                                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Viendo Agenda de</p>
                                    <select
                                        value={selectedSellerId}
                                        onChange={(e) => setSelectedSellerId(e.target.value)}
                                        className="bg-transparent border-none text-gray-800 font-bold text-sm focus:ring-0 p-0 pr-6 w-40 cursor-pointer outline-none"
                                    >
                                        {sellers.map((seller) => (
                                            <option key={seller.id} value={seller.id}>{seller.full_name || seller.email}</option>
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
                                        {dayEvents.map((event) => (
                                            <button
                                                key={event.id}
                                                onClick={() => setSelectedEvent(event)}
                                                className={`w-full text-left p-1.5 rounded-lg text-[10px] truncate cursor-pointer group relative font-bold transition-colors
                                                ${event.source === 'crm' ? 'bg-purple-50 text-purple-700 border border-purple-100 hover:bg-purple-100' :
                                                    event.source === 'internal' ? 'bg-orange-50 text-orange-700 border border-orange-100 hover:bg-orange-100' :
                                                        'bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100'}`}
                                            >
                                                <div className="flex items-center gap-1">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${event.source === 'crm' ? 'bg-purple-500' :
                                                        event.source === 'internal' ? 'bg-orange-500' : 'bg-blue-500'}`}></div>
                                                    {formatEventTimeRange(event)}
                                                </div>
                                                <div className="truncate font-medium" title={event.summary}>{event.summary}</div>
                                            </button>
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
                        <button onClick={() => void fetchAllEvents()} className={`text-dental-500 hover:rotate-180 transition-transform duration-500 ${loading ? 'animate-spin' : ''}`}><RefreshCw size={14} /></button>
                    </div>

                    <div className="space-y-3 overflow-y-auto flex-1">
                        {sortedUpcomingEvents.map((event) => {
                            const eventDate = new Date(event.start.dateTime || event.start.date || '');
                            return (
                                <button
                                    key={event.id}
                                    onClick={() => setSelectedEvent(event)}
                                    className="w-full text-left flex items-start space-x-3 p-3 hover:bg-gray-50 rounded-2xl transition-colors cursor-pointer group"
                                >
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
                                                {formatEventTimeRange(event)}
                                            </span>
                                        </div>
                                    </div>
                                </button>
                            );
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
                    void fetchAllEvents();
                    void fetchTasks();
                }}
            />

            <ScheduleEventDetailsModal
                event={selectedEvent}
                isOpen={Boolean(selectedEvent)}
                isOwnCalendar={selectedSellerId === profile?.id}
                canDeleteVisit={Boolean(selectedEvent?.linkedEntityType === 'visit' && (isSupervisor || selectedSellerId === profile?.id))}
                onClose={() => setSelectedEvent(null)}
                onRefresh={() => {
                    void fetchAllEvents();
                    void fetchTasks();
                }}
                onDeleteVisit={deleteVisit}
            />
        </div>
    );
};

export default Schedule;
