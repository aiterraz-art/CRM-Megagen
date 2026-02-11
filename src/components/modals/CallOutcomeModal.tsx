import { useState } from 'react';
import { X, Phone, PhoneOff, Voicemail, HelpCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { Database } from '../../types/supabase';
import { useUser } from '../../contexts/UserContext';

type CallStatus = 'contestada' | 'no_contesto' | 'ocupado' | 'equivocado' | 'buzon';

interface CallOutcomeModalProps {
    client: { id: string, name: string };
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const CallOutcomeModal = ({ client, isOpen, onClose, onSaved }: CallOutcomeModalProps) => {
    const [status, setStatus] = useState<CallStatus | null>(null);
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const { profile } = useUser();

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!status) return;

        if (!profile?.id) {
            alert("No se pudo identificar al usuario. Recarga la página.");
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.from('call_logs').insert({
                client_id: client.id,
                user_id: profile.id,
                status: status,
                notes: notes
            });

            if (error) throw error;
            onSaved();
            onClose();
        } catch (error: any) {
            console.error('Error saving call log:', error);
            alert(`Error al guardar: ${error.message || JSON.stringify(error)}`);
        } finally {
            setLoading(false);
        }
    };

    const options = [
        { id: 'contestada', label: 'Contestó', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
        { id: 'no_contesto', label: 'No Contestó', icon: PhoneOff, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
        { id: 'buzon', label: 'Buzón de Voz', icon: Voicemail, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
        { id: 'ocupado', label: 'Ocupado', icon: Phone, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
        { id: 'equivocado', label: 'Número Equivocado', icon: HelpCircle, color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' },
    ];

    return (
        <div className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-black text-gray-900">Resultado de la Llamada</h3>
                        <p className="text-sm text-gray-500">Cliente: {client.name}</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                    {options.map((opt) => (
                        <button
                            key={opt.id}
                            onClick={() => setStatus(opt.id as CallStatus)}
                            className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${status === opt.id
                                ? `${opt.border} ${opt.bg} ring-2 ring-offset-2 ring-indigo-500`
                                : 'border-gray-100 hover:bg-gray-50'
                                }`}
                        >
                            <opt.icon className={opt.color} size={24} />
                            <span className={`font-bold text-sm ${opt.color}`}>{opt.label}</span>
                        </button>
                    ))}
                </div>

                <div className="mb-6">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Notas (Opcional)</label>
                    <textarea
                        className="w-full p-3 bg-gray-50 rounded-xl border-none focus:ring-2 focus:ring-indigo-500 text-sm font-medium"
                        rows={3}
                        placeholder="Detalles de la conversación..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </div>

                <button
                    onClick={handleSave}
                    disabled={!status || loading}
                    className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-200"
                >
                    {loading ? 'Guardando...' : 'Guardar Registro'}
                </button>
            </div>
        </div>
    );
};

export default CallOutcomeModal;
