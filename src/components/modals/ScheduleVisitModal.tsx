import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Calendar, Clock, FileText, CheckCircle2, Search, Building2, UserRound, MapPin, Stethoscope } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { googleService } from '../../services/googleService';
import { Database } from '../../types/supabase';
import { clearPersistedModalDraft, loadPersistedModalDraft, savePersistedModalDraft } from '../../utils/modalDrafts';

type Client = Database['public']['Tables']['clients']['Row'];
type VisitMode = 'existing' | 'cold';

interface ScheduleVisitModalProps {
    client?: Client | null;
    assigneeId?: string;
    initialDate?: string;
    initialStartTime?: string;
    initialEndTime?: string;
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const DEFAULT_START_TIME = '10:00';
const DEFAULT_END_TIME = '11:00';
const SCHEDULE_VISIT_MODAL_STORAGE_KEY = 'schedule-visit-modal';

const addHourToTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const next = new Date();
    next.setHours(hours || 0, minutes || 0, 0, 0);
    next.setMinutes(next.getMinutes() + 60);
    return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
};

const buildIsoFromDateTime = (date: string, time: string) => new Date(`${date}T${time}:00`);

const buildScheduleVisitDraft = (
    initialClient: Client | null | undefined,
    initialDateValue: string,
    initialStartValue: string,
    initialEndValue: string
) => ({
    visitMode: 'existing' as VisitMode,
    selectedClient: initialClient || null,
    searchTerm: '',
    formData: {
        date: initialDateValue,
        startTime: initialStartValue,
        endTime: initialEndValue,
        title: initialClient ? `Visita: ${initialClient.name}` : '',
        notes: '',
        clinicName: '',
        address: '',
        doctorName: '',
        doctorSpecialty: ''
    }
});

const ScheduleVisitModal = ({
    client: initialClient,
    assigneeId,
    initialDate,
    initialStartTime,
    initialEndTime,
    isOpen,
    onClose,
    onSaved
}: ScheduleVisitModalProps) => {
    const [loading, setLoading] = useState(false);
    const [visitMode, setVisitMode] = useState<VisitMode>('existing');
    const [selectedClient, setSelectedClient] = useState<Client | null>(initialClient || null);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<Client[]>([]);
    const [searching, setSearching] = useState(false);
    const [restoredOpen, setRestoredOpen] = useState(false);
    const [formData, setFormData] = useState(() => buildScheduleVisitDraft(initialClient, new Date().toISOString().split('T')[0], DEFAULT_START_TIME, DEFAULT_END_TIME).formData);
    const hasInitializedRef = useRef(false);

    const effectiveDate = initialDate || new Date().toISOString().split('T')[0];
    const effectiveStartTime = initialStartTime || DEFAULT_START_TIME;
    const effectiveEndTime = initialEndTime || addHourToTime(effectiveStartTime) || DEFAULT_END_TIME;
    const effectiveOpen = isOpen || restoredOpen;
    const storageKey = `${SCHEDULE_VISIT_MODAL_STORAGE_KEY}:${initialClient?.id || 'cold'}:${assigneeId || 'self'}`;

    useEffect(() => {
        if (!effectiveOpen) {
            hasInitializedRef.current = false;
            return;
        }

        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const baseDraft = buildScheduleVisitDraft(initialClient, effectiveDate, effectiveStartTime, effectiveEndTime);
        const savedDraft = loadPersistedModalDraft<typeof baseDraft>(storageKey);
        const nextDraft = savedDraft?.data
            ? {
                ...baseDraft,
                ...savedDraft.data,
                formData: {
                    ...baseDraft.formData,
                    ...savedDraft.data.formData
                }
            }
            : baseDraft;

        setVisitMode(nextDraft.visitMode);
        setSelectedClient(nextDraft.selectedClient);
        setSearchTerm(nextDraft.searchTerm);
        setSearchResults([]);
        setFormData(nextDraft.formData);

        if (!isOpen && savedDraft?.isOpen !== false) {
            setRestoredOpen(true);
        }
    }, [effectiveDate, effectiveEndTime, effectiveOpen, effectiveStartTime, initialClient, isOpen, storageKey]);

    useEffect(() => {
        if (!effectiveOpen) return;
        savePersistedModalDraft(storageKey, {
            visitMode,
            selectedClient,
            searchTerm,
            formData
        }, true);
    }, [effectiveOpen, formData, searchTerm, selectedClient, storageKey, visitMode]);

    useEffect(() => {
        if (selectedClient && visitMode === 'existing' && !formData.title) {
            setFormData((prev) => ({ ...prev, title: `Visita: ${selectedClient.name}` }));
        }
    }, [selectedClient, visitMode, formData.title]);

    useEffect(() => {
        const searchClients = async () => {
            if (!effectiveOpen) return;
            if (visitMode !== 'existing' || searchTerm.trim().length < 2) {
                setSearchResults([]);
                return;
            }

            setSearching(true);
            try {
                const { data } = await supabase
                    .from('clients')
                    .select('*')
                    .ilike('name', `%${searchTerm.trim()}%`)
                    .limit(8);
                setSearchResults(data || []);
            } catch (error) {
                console.error('Search error:', error);
            } finally {
                setSearching(false);
            }
        };

        const timeoutId = setTimeout(searchClients, 300);
        return () => clearTimeout(timeoutId);
    }, [effectiveOpen, searchTerm, visitMode]);

    const canSubmit = useMemo(() => {
        if (visitMode === 'existing') {
            return Boolean(selectedClient && formData.date && formData.startTime && formData.endTime);
        }
        return Boolean(
            formData.date
            && formData.startTime
            && formData.endTime
            && formData.clinicName.trim()
            && formData.doctorName.trim()
        );
    }, [visitMode, selectedClient, formData]);

    const handleClose = () => {
        clearPersistedModalDraft(storageKey);
        hasInitializedRef.current = false;
        setRestoredOpen(false);
        onClose();
    };

    if (!effectiveOpen) return null;

    const syncToGoogleCalendar = async (
        targetRepId: string,
        isoStart: string,
        isoEnd: string,
        title: string,
        description: string,
        location: string,
        visitId: string
    ) => {
        try {
            const attendees: Array<{ email: string }> = [];
            const { data: sessionData } = await supabase.auth.getSession();
            const sessionUserId = sessionData.session?.user?.id;

            if (targetRepId !== sessionUserId) {
                const { data: assigneeProfile } = await supabase
                    .from('profiles')
                    .select('email')
                    .eq('id', targetRepId)
                    .single();
                if (assigneeProfile?.email) attendees.push({ email: assigneeProfile.email });
            }

            const gCalEvent = {
                summary: title,
                description,
                location,
                start: { dateTime: isoStart },
                end: { dateTime: isoEnd },
                attendees
            };

            const gData = await googleService.fetchGoogleJson<any>('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gCalEvent)
            });

            if (gData?.id) {
                await supabase.from('visits').update({ google_event_id: gData.id } as any).eq('id', visitId);
            }
        } catch (gError) {
            console.error('Google Calendar Error:', gError);
        }
    };

    const handleSave = async () => {
        const startDateTime = buildIsoFromDateTime(formData.date, formData.startTime);
        const endDateTime = buildIsoFromDateTime(formData.date, formData.endTime);

        if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
            alert('Debes indicar una fecha y hora válidas.');
            return;
        }

        if (endDateTime <= startDateTime) {
            alert('La hora de término debe ser mayor a la hora de inicio.');
            return;
        }

        if (visitMode === 'existing' && !selectedClient) {
            alert('Debes seleccionar un cliente para agendar la visita.');
            return;
        }

        if (visitMode === 'cold' && (!formData.clinicName.trim() || !formData.doctorName.trim())) {
            alert('Para una visita en frío debes completar el lugar y el nombre del doctor.');
            return;
        }

        setLoading(true);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) {
                alert('Sesión de usuario no encontrada.');
                return;
            }

            const targetRepId = assigneeId || session.user.id;
            const isoStart = startDateTime.toISOString();
            const isoEnd = endDateTime.toISOString();

            const title = (formData.title || '').trim() || (
                visitMode === 'existing'
                    ? `Visita: ${selectedClient?.name || 'Cliente'}`
                    : `Visita en frío: ${formData.clinicName.trim()}`
            );

            let visitPayload: Record<string, any>;
            let googleDescription = '';
            let googleLocation = '';

            if (visitMode === 'existing' && selectedClient) {
                googleDescription = [
                    `Cliente: ${selectedClient.name}`,
                    `Dirección: ${selectedClient.address || 'Sin dirección'}`,
                    formData.notes ? `Notas: ${formData.notes}` : null,
                    `Agendado por: ${session.user.email || 'usuario CRM'}`
                ].filter(Boolean).join('\n');

                googleLocation = selectedClient.address || '';
                visitPayload = {
                    client_id: selectedClient.id,
                    sales_rep_id: targetRepId,
                    scheduled_at: isoStart,
                    check_in_time: isoStart,
                    check_out_time: null,
                    status: 'scheduled',
                    title,
                    notes: formData.notes.trim() || null,
                    purpose: 'Visita agendada'
                };
            } else {
                const clinicName = formData.clinicName.trim();
                const address = formData.address.trim();
                const doctorName = formData.doctorName.trim();
                const doctorSpecialty = formData.doctorSpecialty.trim();

                googleDescription = [
                    `Visita en frío agendada`,
                    `Clínica / Lugar: ${clinicName}`,
                    `Doctor: ${doctorName}`,
                    doctorSpecialty ? `Especialidad: ${doctorSpecialty}` : null,
                    address ? `Dirección: ${address}` : null,
                    formData.notes ? `Notas: ${formData.notes}` : null,
                    `Agendado por: ${session.user.email || 'usuario CRM'}`
                ].filter(Boolean).join('\n');

                googleLocation = address;
                visitPayload = {
                    client_id: null,
                    sales_rep_id: targetRepId,
                    scheduled_at: isoStart,
                    check_in_time: isoStart,
                    check_out_time: null,
                    status: 'scheduled',
                    type: 'cold_visit',
                    title,
                    purpose: 'Visita en frío agendada',
                    notes: formData.notes.trim() || null,
                    doctor_name: doctorName,
                    cold_visit_clinic_name: clinicName,
                    cold_visit_address: address || null,
                    cold_visit_doctor_name: doctorName,
                    cold_visit_doctor_specialty: doctorSpecialty || null
                };
            }

            const { data: insertedVisit, error: dbError } = await (supabase
                .from('visits') as any)
                .insert(visitPayload)
                .select('id')
                .single();

            if (dbError) throw dbError;

            onSaved();
            clearPersistedModalDraft(storageKey);
            hasInitializedRef.current = false;
            setRestoredOpen(false);
            onClose();
            alert('Visita agendada correctamente.');

            if (insertedVisit?.id) {
                void syncToGoogleCalendar(
                    targetRepId,
                    isoStart,
                    isoEnd,
                    title,
                    googleDescription,
                    googleLocation,
                    insertedVisit.id
                );
            }
        } catch (error: any) {
            console.error('Error scheduling visit:', error);
            alert(`Error al agendar: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl p-8 space-y-6 animate-in zoom-in duration-300 max-h-[92vh] overflow-y-auto">
                <div className="flex justify-between items-center">
                    <div>
                        <h3 className="text-2xl font-black text-gray-900">Agendar Visita {assigneeId ? '(Asignación)' : ''}</h3>
                        <p className="text-sm text-gray-400 font-medium mt-1">Puedes agendar con un cliente existente o preparar una visita en frío desde la agenda.</p>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => setVisitMode('existing')}
                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${visitMode === 'existing' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-lg shadow-indigo-100' : 'border-gray-100 bg-white text-gray-500 hover:border-indigo-200'}`}
                    >
                        <p className="text-xs font-black uppercase tracking-widest">Cliente existente</p>
                        <p className="text-sm font-bold mt-1">Agendar visita comercial</p>
                    </button>
                    <button
                        type="button"
                        onClick={() => setVisitMode('cold')}
                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${visitMode === 'cold' ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-lg shadow-blue-100' : 'border-gray-100 bg-white text-gray-500 hover:border-blue-200'}`}
                    >
                        <p className="text-xs font-black uppercase tracking-widest">Visita en frío</p>
                        <p className="text-sm font-bold mt-1">Agendar con datos del doctor</p>
                    </button>
                </div>

                <div className="space-y-5">
                    {visitMode === 'existing' ? (
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Cliente</label>
                            {selectedClient ? (
                                <div className="flex justify-between items-center p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
                                    <div>
                                        <p className="font-bold text-gray-900">{selectedClient.name}</p>
                                        <p className="text-xs text-gray-500 truncate max-w-[320px]">{selectedClient.address || 'Sin dirección'}</p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setSelectedClient(null);
                                            setFormData((prev) => ({ ...prev, title: '' }));
                                        }}
                                        className="p-2 hover:bg-indigo-100 rounded-lg text-indigo-600"
                                    >
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
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        autoFocus
                                    />
                                    {(searchResults.length > 0 || searching) && (
                                        <div className="absolute top-full mt-2 left-0 right-0 bg-white shadow-xl rounded-2xl overflow-hidden z-10 border border-gray-100 max-h-56 overflow-y-auto">
                                            {searching && (
                                                <div className="p-3 text-xs font-bold text-gray-400">Buscando clientes...</div>
                                            )}
                                            {searchResults.map((client) => (
                                                <button
                                                    key={client.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedClient(client);
                                                        setSearchResults([]);
                                                        setSearchTerm('');
                                                    }}
                                                    className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-50 last:border-none"
                                                >
                                                    <p className="font-bold text-sm text-gray-800">{client.name}</p>
                                                    <p className="text-xs text-gray-400">{client.address || 'Sin dirección'}</p>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Clínica / Lugar</label>
                                <div className="relative">
                                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                        value={formData.clinicName}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, clinicName: e.target.value }))}
                                        placeholder="Ej: Clínica Dental Norte"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Dirección</label>
                                <div className="relative">
                                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                        value={formData.address}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                                        placeholder="Ej: Av. Providencia 1234"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Doctor</label>
                                <div className="relative">
                                    <UserRound className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                        value={formData.doctorName}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, doctorName: e.target.value }))}
                                        placeholder="Nombre del doctor"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Especialidad</label>
                                <div className="relative">
                                    <Stethoscope className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                        value={formData.doctorSpecialty}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, doctorSpecialty: e.target.value }))}
                                        placeholder="Ej: Implantología"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Título</label>
                        <div className="relative">
                            <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                value={formData.title}
                                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                                placeholder={visitMode === 'existing' ? 'Ej: Visita Comercial' : 'Ej: Presentación de productos'}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Fecha</label>
                            <div className="relative">
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="date"
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                    value={formData.date}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Desde</label>
                            <div className="relative">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="time"
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                    value={formData.startTime}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, startTime: e.target.value }))}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Hasta</label>
                            <div className="relative">
                                <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="time"
                                    className="w-full pl-12 pr-4 py-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                    value={formData.endTime}
                                    onChange={(e) => setFormData((prev) => ({ ...prev, endTime: e.target.value }))}
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
                            onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
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
                        disabled={loading || !canSubmit}
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
