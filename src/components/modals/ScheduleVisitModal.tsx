import { useState, useEffect } from 'react';
import { X, Calendar, Clock, FileText, CheckCircle2, Search, User } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { googleService } from '../../services/googleService';
import { Database } from '../../types/supabase';

type Client = Database['public']['Tables']['clients']['Row'];

interface ScheduleVisitModalProps {
    client?: Client | null; // Optional now
    assigneeId?: string;    // ID of the seller (for supervisors)
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const ScheduleVisitModal = ({ client: initialClient, assigneeId, isOpen, onClose, onSaved }: ScheduleVisitModalProps) => {
    const [loading, setLoading] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(initialClient || null);

    // Client Search State
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<Client[]>([]);
    const [searching, setSearching] = useState(false);

    const [formData, setFormData] = useState({
        date: new Date().toISOString().split('T')[0],
        time: '10:00',
        title: '',
        notes: ''
    });

    // Reset state when opening/closing or changing client
    useEffect(() => {
        if (isOpen) {
            setSelectedClient(initialClient || null);
            setFormData({
                date: new Date().toISOString().split('T')[0],
                time: '10:00',
                title: initialClient ? `Visita: ${initialClient.name}` : '',
                notes: ''
            });
            setSearchTerm('');
            setSearchResults([]);
        }
    }, [isOpen, initialClient]);

    // Construct title automatically if not manually edited? 
    // For simplicity, we just set a default when client is selected.
    useEffect(() => {
        if (selectedClient && !formData.title) {
            setFormData(prev => ({ ...prev, title: `Visita: ${selectedClient.name}` }));
        }
    }, [selectedClient]);

    // Search Clients
    useEffect(() => {
        const searchClients = async () => {
            if (searchTerm.length < 2) {
                setSearchResults([]);
                return;
            }
            setSearching(true);
            try {
                const { data } = await supabase
                    .from('clients')
                    .select('*')
                    .ilike('name', `%${searchTerm}%`)
                    .limit(5);
                setSearchResults(data || []);
            } catch (error) {
                console.error("Search error:", error);
            } finally {
                setSearching(false);
            }
        };

        const timeoutId = setTimeout(searchClients, 300);
        return () => clearTimeout(timeoutId);
    }, [searchTerm]);


    if (!isOpen) return null;

    const handleSave = async () => {
        if (!selectedClient) {
            alert("Debes seleccionar un cliente para agendar la visita.");
            return;
        }

        setLoading(true);
        try {
            // 1. Calculate Timestamps
            const startDateTime = new Date(`${formData.date}T${formData.time}:00`);
            const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour duration default
            const isoStart = startDateTime.toISOString();
            const isoEnd = endDateTime.toISOString();

            // 2. Google Token Validity Check
            const validToken = await googleService.ensureSession();
            if (!validToken) {
                setLoading(false);
                return;
            }

            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                setLoading(false);
                alert("Sesión de usuario no encontrada.");
                return;
            }

            // Determine effective sales_rep_id
            const targetRepId = assigneeId || session.user.id;

            // 3. Save to Supabase (Visits Table with 'scheduled' status)
            const { error: dbError } = await supabase
                .from('visits')
                .insert({
                    client_id: selectedClient.id,
                    sales_rep_id: targetRepId,
                    check_in_time: isoStart,
                    check_out_time: null,
                    status: 'scheduled',
                    title: formData.title,
                    notes: formData.notes
                });

            if (dbError) throw dbError;

            // 4. Sync to Google Calendar
            // FIX: We now sync ALWAYS if we have a token, effectively behaving as the "Organizer".
            // If assigning to another rep, we add them as an 'attendee' so it injects into their calendar.
            if (session.provider_token) {
                try {
                    // Determine attendees
                    const attendees = [];
                    // If target is NOT self, fetch their email and add as attendee
                    if (targetRepId !== session.user.id) {
                        const { data: assigneeProfile } = await supabase
                            .from('profiles')
                            .select('email')
                            .eq('id', targetRepId)
                            .single();

                        if (assigneeProfile?.email) {
                            attendees.push({ email: assigneeProfile.email });
                        }
                    }

                    const gCalEvent: any = {
                        summary: formData.title,
                        description: `Cliente: ${selectedClient.name}\nDirección: ${selectedClient.address}\nNotas: ${formData.notes}\n\nAgendado por: ${session.user.email}`,
                        location: selectedClient.address,
                        start: { dateTime: isoStart },
                        end: { dateTime: isoEnd },
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

                    if (response.ok) {
                        const gData = await response.json();
                        // 5. Update Visit with Google Event ID
                        if (gData.id) {
                            await supabase.from('visits')
                                .update({ google_event_id: gData.id })
                                .eq('client_id', selectedClient.id)
                                .eq('sales_rep_id', targetRepId)
                                .eq('check_in_time', isoStart)
                                .eq('status', 'scheduled');
                        }
                    } else {
                        console.warn("Google Calendar sync failed", await response.text());
                    }
                } catch (gError) {
                    console.error("Google Calendar Error:", gError);
                }
            }

            onSaved();
            onClose();
            alert("Visita agendada correctamente.");

        } catch (error: any) {
            console.error("Error scheduling visit:", error);
            alert(`Error al agendar: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 space-y-6 animate-in zoom-in duration-300">
                <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-black text-gray-900">Agendar Visita {assigneeId ? '(Asignación)' : ''}</h3>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors"><X size={24} /></button>
                </div>

                <div className="space-y-5">

                    {/* Client Selection Section */}
                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Cliente</label>
                        {selectedClient ? (
                            <div className="flex justify-between items-center p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                                <div>
                                    <p className="font-bold text-gray-900">{selectedClient.name}</p>
                                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{selectedClient.address}</p>
                                </div>
                                <button onClick={() => { setSelectedClient(null); setFormData(p => ({ ...p, title: '' })); }} className="p-2 hover:bg-indigo-100 rounded-lg text-indigo-600">
                                    <X size={16} />
                                </button>
                            </div>
                        ) : (
                            <div className="relative">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    placeholder="Buscar cliente..."
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    autoFocus
                                />
                                {searchResults.length > 0 && (
                                    <div className="absolute top-full mt-2 left-0 right-0 bg-white shadow-xl rounded-2xl overflow-hidden z-10 border border-gray-100 max-h-48 overflow-y-auto">
                                        {searchResults.map(c => (
                                            <div
                                                key={c.id}
                                                onClick={() => { setSelectedClient(c); setSearchResults([]); setSearchTerm(''); }}
                                                className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-none"
                                            >
                                                <p className="font-bold text-sm text-gray-800">{c.name}</p>
                                                <p className="text-xs text-gray-400">{c.address}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Título</label>
                        <div className="relative">
                            <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                placeholder="Ej: Visita Mensual"
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
                            placeholder="Detalles sobre la visita..."
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
                        disabled={loading || !selectedClient}
                        className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
                    >
                        {loading ? 'Agendando...' : <><CheckCircle2 className="mr-2" size={20} /> Agendar</>}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScheduleVisitModal;
