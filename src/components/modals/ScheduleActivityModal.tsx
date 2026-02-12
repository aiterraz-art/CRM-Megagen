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

    const [formData, setFormData] = useState({
        assigneeId: preSelectedAssigneeId || '',
        date: new Date().toISOString().split('T')[0],
        time: '09:00',
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

    // Update form if preSelectedAssigneeId changes
    useEffect(() => {
        if (preSelectedAssigneeId) {
            setFormData(prev => ({ ...prev, assigneeId: preSelectedAssigneeId }));
        }
    }, [preSelectedAssigneeId]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!formData.assigneeId) {
            alert("Debes seleccionar un responsable o 'Todos'.");
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
            const isoDue = dueDateTime.toISOString();

            // 1.5 Pre-flight Google Check
            const validToken = await googleService.ensureSession();
            if (!validToken) {
                setLoading(false);
                return;
            }

            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setLoading(false);
                alert("Sesión de usuario no encontrada.");
                return;
            }

            // 2. Insert into crm_tasks
            if (formData.assigneeId === 'all') {
                // Bulk Insert for ALL sellers
                const tasksToInsert = sellers.map(seller => ({
                    title: formData.title,
                    description: formData.notes,
                    assigned_to: seller.id,
                    status: 'pending',
                    priority: 'medium',
                    due_date: isoDue,
                    task_type: 'meeting'
                }));

                const { error } = await supabase
                    .from('crm_tasks')
                    .insert(tasksToInsert);

                if (error) throw error;
            } else {
                // Single Insert
                const { error } = await supabase
                    .from('crm_tasks')
                    .insert({
                        title: formData.title,
                        description: formData.notes,
                        assigned_to: formData.assigneeId,
                        status: 'pending',
                        priority: 'medium', // Default
                        due_date: isoDue,
                        task_type: 'meeting' // Custom type if schema supports, else just generic
                    });

                if (error) throw error;
            }

            // 3. Sync to Google Calendar (Organizer Mode + Attendee Injection)
            // Session is already fetched above
            // Only sync if single assignment (not 'all') to avoid spamming self with N events
            if (formData.assigneeId !== 'all' && session?.provider_token) {
                try {
                    const attendees = [];
                    // If not self, add as attendee
                    if (formData.assigneeId !== session.user.id) {
                        const assignee = sellers.find(s => s.id === formData.assigneeId);
                        if (assignee?.email) {
                            attendees.push({ email: assignee.email });
                        }
                    }

                    const gCalEvent: any = {
                        summary: formData.title,
                        description: `${formData.notes}\n\nAsignado por: ${session.user.email}`,
                        location: 'Reunión / Actividad Interna',
                        start: { dateTime: isoDue },
                        end: { dateTime: new Date(dueDateTime.getTime() + 60 * 60 * 1000).toISOString() }, // Default 1 hour
                        attendees: attendees
                    };

                    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${validToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(gCalEvent)
                    });

                    if (!response.ok) {
                        console.warn("Google Calendar sync failed", await response.text());
                    }
                } catch (gError) {
                    console.error("Google Calendar Error:", gError);
                }
            }

            onSaved();
            onClose();
            // Reset crucial fields
            setFormData(p => ({ ...p, title: '', notes: '' }));
            alert("Actividad asignada correctamente.");

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
                        <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <select
                                value={formData.assigneeId}
                                onChange={e => setFormData({ ...formData, assigneeId: e.target.value })}
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none appearance-none"
                            >
                                <option value="">Seleccionar miembro del equipo...</option>
                                <option value="all" className="font-black text-indigo-600">📢 Invitar a TODOS (Equipo Completo)</option>
                                {sellers.map(s => (
                                    <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
                                ))}
                            </select>
                        </div>
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

                    <div className="grid grid-cols-2 gap-4">
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
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Hora</label>
                            <div className="relative">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="time"
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                    value={formData.time}
                                    onChange={e => setFormData({ ...formData, time: e.target.value })}
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
