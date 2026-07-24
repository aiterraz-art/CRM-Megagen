import { useMemo, useState } from 'react';
import { CheckCircle2, Mail, MessageCircle, Phone, PhoneOff, Voicemail, X, HelpCircle } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useUser } from '../../contexts/UserContext';

type ManagementType = 'call' | 'whatsapp' | 'email';
type CallStatus = 'contestada' | 'no_contesto' | 'ocupado' | 'equivocado' | 'buzon';
type MessageStatus = 'sent' | 'failed' | 'opened_external';

interface ClientManagementModalProps {
    client: {
        id: string;
        name: string;
        phone?: string | null;
        email?: string | null;
    };
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const MESSAGE_STATUS_OPTIONS: Array<{ value: MessageStatus; label: string }> = [
    { value: 'sent', label: 'Enviado' },
    { value: 'opened_external', label: 'Abierto externamente' },
    { value: 'failed', label: 'Fallido' }
];

const CALL_OPTIONS = [
    { id: 'contestada', label: 'Contestó', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
    { id: 'no_contesto', label: 'No contestó', icon: PhoneOff, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
    { id: 'buzon', label: 'Buzón', icon: Voicemail, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
    { id: 'ocupado', label: 'Ocupado', icon: Phone, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
    { id: 'equivocado', label: 'Equivocado', icon: HelpCircle, color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' },
] as const;

const ClientManagementModal = ({ client, isOpen, onClose, onSaved }: ClientManagementModalProps) => {
    const { profile } = useUser();
    const [managementType, setManagementType] = useState<ManagementType>('call');
    const [callStatus, setCallStatus] = useState<CallStatus | null>(null);
    const [messageStatus, setMessageStatus] = useState<MessageStatus>('sent');
    const [destination, setDestination] = useState('');
    const [subject, setSubject] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);

    const defaultDestination = useMemo(() => {
        if (managementType === 'email') return client.email || '';
        if (managementType === 'whatsapp') return client.phone || '';
        return client.phone || '';
    }, [client.email, client.phone, managementType]);

    if (!isOpen) return null;

    const resetState = () => {
        setManagementType('call');
        setCallStatus(null);
        setMessageStatus('sent');
        setDestination('');
        setSubject('');
        setNotes('');
    };

    const handleClose = () => {
        resetState();
        onClose();
    };

    const handleTypeChange = (type: ManagementType) => {
        setManagementType(type);
        setDestination('');
        setSubject('');
        setNotes('');
        setCallStatus(null);
        setMessageStatus('sent');
    };

    const handleSave = async () => {
        if (!profile?.id) {
            alert('No se pudo identificar al usuario. Recarga la página.');
            return;
        }

        if (managementType === 'call' && !callStatus) {
            alert('Selecciona el resultado de la llamada.');
            return;
        }

        const finalDestination = (destination || defaultDestination).trim();
        if (managementType !== 'call' && !finalDestination) {
            alert(`Falta ${managementType === 'email' ? 'correo' : 'número de WhatsApp'} del cliente.`);
            return;
        }

        setLoading(true);
        try {
            if (managementType === 'call') {
                const { error } = await supabase.from('call_logs').insert({
                    client_id: client.id,
                    user_id: profile.id,
                    status: callStatus,
                    notes: notes || null
                } as any);
                if (error) throw error;
            } else if (managementType === 'whatsapp') {
                const { error } = await supabase.from('lead_message_logs').insert({
                    client_id: client.id,
                    user_id: profile.id,
                    channel: 'whatsapp',
                    destination: finalDestination,
                    status: messageStatus,
                    error_message: notes || null
                });
                if (error) throw error;
            } else {
                const { error } = await (supabase.from('email_logs') as any).insert({
                    client_id: client.id,
                    user_id: profile.id,
                    subject: subject || 'Correo registrado manualmente',
                    snippet: notes || null
                });
                if (error) throw error;
            }

            onSaved();
            handleClose();
        } catch (error: any) {
            console.error('Error saving management log:', error);
            alert(`No se pudo guardar la gestión: ${error?.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[115] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-2xl font-black text-gray-900">Registrar Gestión</h3>
                        <p className="text-sm text-gray-500">Cliente: {client.name}</p>
                    </div>
                    <button onClick={handleClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-6">
                    <button
                        onClick={() => handleTypeChange('call')}
                        className={`p-4 rounded-2xl border-2 font-bold flex flex-col items-center gap-2 transition-all ${managementType === 'call' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                    >
                        <Phone size={22} />
                        Llamada
                    </button>
                    <button
                        onClick={() => handleTypeChange('whatsapp')}
                        className={`p-4 rounded-2xl border-2 font-bold flex flex-col items-center gap-2 transition-all ${managementType === 'whatsapp' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                    >
                        <MessageCircle size={22} />
                        WhatsApp
                    </button>
                    <button
                        onClick={() => handleTypeChange('email')}
                        className={`p-4 rounded-2xl border-2 font-bold flex flex-col items-center gap-2 transition-all ${managementType === 'email' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                    >
                        <Mail size={22} />
                        Correo
                    </button>
                </div>

                {managementType === 'call' ? (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                            {CALL_OPTIONS.map((option) => (
                                <button
                                    key={option.id}
                                    onClick={() => setCallStatus(option.id as CallStatus)}
                                    className={`p-3 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${callStatus === option.id ? `${option.border} ${option.bg} ring-2 ring-offset-2 ring-indigo-500` : 'border-gray-100 hover:bg-gray-50'}`}
                                >
                                    <option.icon className={option.color} size={22} />
                                    <span className={`text-xs font-bold text-center ${option.color}`}>{option.label}</span>
                                </button>
                            ))}
                        </div>
                        <div>
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">Notas</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={4}
                                className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="Resumen de la llamada, compromisos o resultado..."
                            />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-5">
                        <div>
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">
                                {managementType === 'email' ? 'Correo destino' : 'Número WhatsApp'}
                            </label>
                            <input
                                type="text"
                                value={destination || defaultDestination}
                                onChange={(e) => setDestination(e.target.value)}
                                className="w-full px-4 py-3 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                                placeholder={managementType === 'email' ? 'cliente@clinica.cl' : '+56 9 ...'}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">Estado</label>
                            <div className="grid grid-cols-3 gap-3">
                                {MESSAGE_STATUS_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setMessageStatus(option.value)}
                                        className={`px-4 py-3 rounded-2xl border-2 font-bold text-sm transition-all ${messageStatus === option.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        {managementType === 'email' && (
                            <div>
                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">Asunto</label>
                                <input
                                    type="text"
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                                    placeholder="Asunto del correo"
                                />
                            </div>
                        )}
                        <div>
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest block mb-2">
                                {managementType === 'email' ? 'Detalle / resumen' : messageStatus === 'failed' ? 'Motivo del fallo' : 'Detalle opcional'}
                            </label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={4}
                                className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder={managementType === 'email' ? 'Breve resumen del correo enviado...' : 'Opcional: contexto del WhatsApp...'}
                            />
                        </div>
                    </div>
                )}

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={handleClose}
                        className="px-5 py-3 rounded-2xl bg-gray-100 text-gray-600 font-bold hover:bg-gray-200 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-6 py-3 rounded-2xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? 'Guardando...' : 'Guardar Gestión'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClientManagementModal;
