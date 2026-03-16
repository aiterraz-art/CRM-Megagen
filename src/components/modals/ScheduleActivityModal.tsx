import { useState, useEffect } from 'react';
import { X, Calendar, Clock, FileText, CheckCircle2, User } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { googleService } from '../../services/googleService';

interface Profile {
    id: string;
    full_name: string;
    email: string;
}

interface ScheduleActivityModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    preSelectedAssigneeId?: string; // If supervisor was viewing a specific calendar
}

const ScheduleActivityModal = ({ isOpen, onClose, onSaved, preSelectedAssigneeId }: ScheduleActivityModalProps) => {
    const [loading, setLoading] = useState(false);
    const [sellers, setSellers] = useState<Profile[]>([]);
    const [inviteAll, setInviteAll] = useState(false);

    const getDefaultEndTime = (time: string) => {
        const [hours, minutes] = time.split(':').map(Number);
        const end = new Date();
        end.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
        end.setMinutes(end.getMinutes() + 60);
        return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    };

    const [formData, setFormData] = useState({
        assigneeIds: preSelectedAssigneeId ? [preSelectedAssigneeId] : [] as string[],
        date: new Date().toISOString().split('T')[0],
        time: '09:00',
        endTime: '10:00',
        title: '',
        notes: ''
    });

    // Fetch potential assignees (Sellers/Drivers/Etc)
    useEffect(() => {
        const fetchSellers = async () => {
            const { data } = await supabase.from('profiles')
                .select('id, full_name, email')
                .neq('role', 'super_admin_placeholder') // Filter if needed
                .order('full_name');
            if (data) setSellers(data);
        };
        fetchSellers();
    }, []);

    // Reset selection when opening from a specific calendar view
    useEffect(() => {
        if (!isOpen) return;
        setInviteAll(false);
        setFormData(prev => ({
            ...prev,
            assigneeIds: preSelectedAssigneeId ? [preSelectedAssigneeId] : []
        }));
    }, [isOpen, preSelectedAssigneeId]);

    const toggleAssignee = (sellerId: string) => {
        setInviteAll(false);
        setFormData(prev => {
            const alreadySelected = prev.assigneeIds.includes(sellerId);
            return {
                ...prev,
                assigneeIds: alreadySelected
                    ? prev.assigneeIds.filter(id => id !== sellerId)
                    : [...prev.assigneeIds, sellerId]
            };
        });
    };

    const selectedRecipients = inviteAll
        ? sellers
        : sellers.filter(seller => formData.assigneeIds.includes(seller.id));

    const selectionLabel = inviteAll
        ? `Equipo completo (${sellers.length})`
        : selectedRecipients.length === 0
            ? 'Sin vendedores seleccionados'
            : `${selectedRecipients.length} vendedor${selectedRecipients.length === 1 ? '' : 'es'} seleccionado${selectedRecipients.length === 1 ? '' : 's'}`;

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!inviteAll && formData.assigneeIds.length === 0) {
            alert("Debes seleccionar al menos un responsable o usar 'Todos'.");
            return;
        }
        if (selectedRecipients.length === 0) {
            alert("No hay vendedores seleccionados para esta reunión.");
            return;
        }
        if (!formData.title) {
            alert("Debes ingresar un título o motivo.");
            return;
        }

        setLoading(true);
        try {
            // 1. Calculate Timestamps
            const dueDateTime = new Date(`${formData.date}T${formData.time}:00`);
            const endDateTime = new Date(`${formData.date}T${formData.endTime}:00`);
            const isoDue = dueDateTime.toISOString();
            const isoEnd = endDateTime.toISOString();

            if (!(endDateTime.getTime() > dueDateTime.getTime())) {
                alert("La hora de finalización debe ser posterior a la hora de inicio.");
                setLoading(false);
                return;
            }

            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setLoading(false);
                alert("Sesión de usuario no encontrada.");
                return;
            }

            // 2. Insert into tasks
            let insertedTaskIds: string[] = [];
            const tasksToInsert = selectedRecipients.map((seller) => ({
                title: formData.title,
                description: formData.notes,
                user_id: seller.id,
                assigned_to: seller.id,
                assigned_by: session.user.id,
                status: 'pending',
                priority: 'medium',
                due_date: isoDue,
                end_date: isoEnd
            }));

            const { data, error } = await supabase
                .from('tasks')
                .insert(tasksToInsert)
                .select('id');

            if (error) throw error;
            insertedTaskIds = (data || []).map((task: any) => task.id);

            // 3. Sync to Google Calendar (Organizer Mode + Attendee Injection)
            let googleSyncNote = '';
            try {
                const sessionEmail = (session.user.email || '').trim().toLowerCase();
                if (!sessionEmail) {
                    googleSyncNote = ' (Sincronización Google omitida)';
                } else {
                    const attendeeEmails = Array.from(new Set(
                        selectedRecipients
                            .map((seller) => (seller.email || '').trim().toLowerCase())
                            .filter((email) => !!email && email !== sessionEmail)
                    ));

                    const attendees = attendeeEmails.map((email) => ({ email }));
                    const gCalEvent: any = {
                        summary: formData.title,
                        description: `${formData.notes}\n\nAsignado por: ${session.user.email}`,
                        location: 'Reunión / Actividad Interna',
                        start: { dateTime: isoDue },
                        end: { dateTime: isoEnd },
                    };

                    if (attendees.length > 0) {
                        gCalEvent.attendees = attendees;
                    }

                    const gData = await googleService.fetchGoogleJson<any>('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(gCalEvent)
                    });

                    if (gData?.id && insertedTaskIds.length > 0) {
                        await supabase
                            .from('tasks')
                            .update({
                                google_event_id: gData.id,
                                google_calendar_id: sessionEmail,
                                google_html_link: gData.htmlLink || null,
                            })
                            .in('id', insertedTaskIds);
                    }
                }
            } catch (gError) {
                console.error("Google Calendar Error:", gError);
                googleSyncNote = ' (Actividad creada, pero Google falló)';
            }

            onSaved();
            onClose();
            // Reset crucial fields
            setInviteAll(false);
            setFormData(p => ({ ...p, assigneeIds: preSelectedAssigneeId ? [preSelectedAssigneeId] : [], time: '09:00', endTime: '10:00', title: '', notes: '' }));
            alert(`Actividad asignada correctamente.${googleSyncNote}`);

        } catch (error: any) {
            console.error("Error creating activity:", error);
            alert(`Error al crear actividad: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 space-y-6 animate-in zoom-in duration-300">
                <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-black text-gray-900">Asignar Reunión</h3>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
                </div>

                <div className="space-y-5">

                    {/* Assignee Selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Asignar a</label>
                        <div className="rounded-2xl bg-gray-50 border border-transparent focus-within:bg-white focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setInviteAll((current) => !current)}
                                className={`w-full flex items-center justify-between px-4 py-4 border-b border-gray-100 transition-colors ${inviteAll ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-white/70'}`}
                            >
                                <span className="flex items-center gap-3 font-bold">
                                    <User size={18} className={inviteAll ? 'text-indigo-600' : 'text-gray-400'} />
                                    📢 Invitar a TODOS (Equipo Completo)
                                </span>
                                <span className={`w-5 h-5 rounded-md border flex items-center justify-center text-[10px] font-black ${inviteAll ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-transparent'}`}>
                                    ✓
                                </span>
                            </button>
                            <div className="max-h-52 overflow-y-auto divide-y divide-gray-100">
                                {sellers.map((seller) => {
                                    const isSelected = inviteAll || formData.assigneeIds.includes(seller.id);
                                    return (
                                        <button
                                            key={seller.id}
                                            type="button"
                                            onClick={() => toggleAssignee(seller.id)}
                                            className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${isSelected && !inviteAll ? 'bg-white text-indigo-700' : 'text-gray-700 hover:bg-white/70'} ${inviteAll ? 'opacity-60' : ''}`}
                                        >
                                            <span className="font-bold">{seller.full_name || seller.email}</span>
                                            <span className={`w-5 h-5 rounded-md border flex items-center justify-center text-[10px] font-black ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-transparent'}`}>
                                                ✓
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <p className="text-[11px] text-gray-500 font-bold ml-1">{selectionLabel}</p>
                        {!inviteAll && selectedRecipients.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {selectedRecipients.map((seller) => (
                                    <span key={seller.id} className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-black">
                                        {seller.full_name || seller.email}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Motivo / Título</label>
                        <div className="relative">
                            <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                placeholder="Ej: Reunión de Feedback"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Fecha</label>
                        <div className="relative">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="date"
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                value={formData.date}
                                onChange={e => setFormData({ ...formData, date: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Hora Inicio</label>
                            <div className="relative">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="time"
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                    value={formData.time}
                                    onChange={e => {
                                        const nextTime = e.target.value;
                                        setFormData(prev => {
                                            const next = { ...prev, time: nextTime };
                                            if (!prev.endTime || prev.endTime <= nextTime) {
                                                next.endTime = getDefaultEndTime(nextTime);
                                            }
                                            return next;
                                        });
                                    }}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Hora Fin</label>
                            <div className="relative">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="time"
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                    value={formData.endTime}
                                    onChange={e => setFormData({ ...formData, endTime: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Notas (Opcional)</label>
                        <textarea
                            rows={3}
                            placeholder="Detalles sobre la reunión..."
                            className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none resize-none"
                            value={formData.notes}
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                        />
                    </div>
                </div>

                <div className="pt-4 flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-4 font-bold text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
                    >
                        {loading ? 'Guardando...' : <><CheckCircle2 className="mr-2" size={20} /> Asignar</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScheduleActivityModal;
