import { useEffect, useState } from 'react';
import { PhoneCall, X } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { useUser } from '../../contexts/UserContext';
import { logClientInteraction } from '../../utils/clientInteractions';
import { clearPersistedModalDraft, loadPersistedModalDraft, savePersistedModalDraft } from '../../utils/modalDrafts';
import {
    ATTEMPT_CHANNELS,
    ATTEMPT_OUTCOMES,
    CALL_STATUS_BY_OUTCOME,
    MESSAGE_STATUS_BY_OUTCOME,
    type AttemptChannel,
    type AttemptOutcome
} from '../../utils/reactivation';

type ReactivationCase = {
    id: string;
    client_id: string;
    client_name: string;
    client_phone?: string | null;
    client_email?: string | null;
    attempts_count: number;
};

interface Props {
    caseRow: ReactivationCase | null;
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
}

const ReactivationAttemptModal = ({ caseRow, isOpen, onClose, onSaved }: Props) => {
    const { profile } = useUser();
    const [channel, setChannel] = useState<AttemptChannel>('call');
    const [outcome, setOutcome] = useState<AttemptOutcome>('no_answer');
    const [notes, setNotes] = useState('');
    const [nextActionAt, setNextActionAt] = useState('');
    const [saving, setSaving] = useState(false);

    const storageKey = caseRow ? `reactivation-attempt:${caseRow.id}` : '';

    useEffect(() => {
        if (!isOpen || !storageKey) return;

        const draft = loadPersistedModalDraft<{
            channel: AttemptChannel;
            outcome: AttemptOutcome;
            notes: string;
            nextActionAt: string;
        }>(storageKey);

        if (draft?.data) {
            setChannel(draft.data.channel || 'call');
            setOutcome(draft.data.outcome || 'no_answer');
            setNotes(draft.data.notes || '');
            setNextActionAt(draft.data.nextActionAt || '');
            return;
        }

        setChannel('call');
        setOutcome('no_answer');
        setNotes('');
        setNextActionAt('');
    }, [isOpen, storageKey]);

    useEffect(() => {
        if (!isOpen || !storageKey) return;
        savePersistedModalDraft(storageKey, { channel, outcome, notes, nextActionAt }, true);
    }, [isOpen, storageKey, channel, outcome, notes, nextActionAt]);

    if (!isOpen || !caseRow) return null;

    const registrar = async () => {
        if (!profile?.id) return;
        setSaving(true);

        try {
            /**
             * Se escriben dos cosas, y las dos importan.
             *
             * El registro histórico va a la tabla del canal, igual que cualquier otra
             * gestión, para que la ficha del cliente y su última actividad sean completas.
             * El intento va a la tabla del caso, con el resultado tipado, porque es lo que
             * cuenta para exigir un mínimo antes de poder descartar.
             *
             * Lo que no ocurre es cerrar el caso: eso solo lo hace una venta.
             */
            let logId: string | null = null;

            if (channel === 'call' || channel === 'whatsapp' || channel === 'email') {
                const registrado = await logClientInteraction({
                    clientId: caseRow.client_id,
                    userId: profile.id,
                    channel,
                    status: channel === 'call'
                        ? CALL_STATUS_BY_OUTCOME[outcome]
                        : MESSAGE_STATUS_BY_OUTCOME[outcome],
                    destination: channel === 'whatsapp' ? caseRow.client_phone : caseRow.client_email,
                    subject: 'Contacto de reactivación',
                    notes
                });
                logId = registrado.logId;
            }

            const { error } = await (supabase.from('client_reactivation_attempts') as any).insert({
                case_id: caseRow.id,
                client_id: caseRow.client_id,
                user_id: profile.id,
                channel,
                outcome,
                notes: notes.trim() || null,
                next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : null,
                call_log_id: channel === 'call' ? logId : null,
                email_log_id: channel === 'email' ? logId : null,
                lead_message_log_id: channel === 'whatsapp' ? logId : null
            });

            if (error) throw error;

            clearPersistedModalDraft(storageKey);
            onSaved();
            onClose();
        } catch (error: any) {
            alert(`No se pudo registrar el intento: ${error?.message || 'error desconocido'}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Registrar intento</p>
                        <h3 className="text-2xl font-black text-gray-900 mt-1">{caseRow.client_name}</h3>
                        <p className="text-xs font-bold text-gray-500 mt-1">
                            Intentos previos: {caseRow.attempts_count}
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Canal</label>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {ATTEMPT_CHANNELS.map((opcion) => (
                                <button
                                    key={opcion.value}
                                    type="button"
                                    onClick={() => setChannel(opcion.value)}
                                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                                        channel === opcion.value
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                                    }`}
                                >
                                    {opcion.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Resultado</label>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {ATTEMPT_OUTCOMES.map((opcion) => (
                                <button
                                    key={opcion.value}
                                    type="button"
                                    onClick={() => setOutcome(opcion.value)}
                                    className={`px-4 py-3 rounded-xl text-xs font-bold text-left transition-all ${
                                        outcome === opcion.value
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    {opcion.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Notas</label>
                        <textarea
                            rows={3}
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            placeholder="Qué se conversó, qué quedó pendiente"
                            className="mt-2 w-full p-4 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 rounded-2xl font-medium text-gray-700 outline-none resize-none"
                        />
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            Próximo contacto comprometido
                        </label>
                        <input
                            type="date"
                            value={nextActionAt}
                            onChange={(event) => setNextActionAt(event.target.value)}
                            className="mt-2 w-full p-4 bg-gray-50 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none"
                        />
                    </div>

                    <p className="text-[11px] font-medium text-gray-400 leading-tight">
                        Registrar un intento no cierra el caso. El cliente sigue en tu bandeja hasta que
                        vuelva a cotizar o comprar.
                    </p>

                    <button
                        onClick={registrar}
                        disabled={saving}
                        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-4 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-indigo-700 disabled:opacity-40"
                    >
                        <PhoneCall size={16} />
                        {saving ? 'Guardando...' : 'Registrar intento'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReactivationAttemptModal;
