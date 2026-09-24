import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { DISCARD_REASONS, type DiscardReason } from '../../utils/reactivation';

type ReactivationCase = {
    id: string;
    client_name: string;
    attempts_count: number;
};

interface Props {
    caseRow: ReactivationCase | null;
    isOpen: boolean;
    minAttempts: number;
    canOverride: boolean;
    onClose: () => void;
    onDiscarded: () => void;
}

const ReactivationDiscardModal = ({
    caseRow,
    isOpen,
    minAttempts,
    canOverride,
    onClose,
    onDiscarded
}: Props) => {
    const [reason, setReason] = useState<DiscardReason | ''>('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    if (!isOpen || !caseRow) return null;

    const intentosFaltantes = Math.max(0, minAttempts - caseRow.attempts_count);
    const bloqueadoPorIntentos = intentosFaltantes > 0 && !canOverride;
    // "Otro motivo" sin explicación no sirve a nadie: la base también lo rechaza.
    const faltaDetalle = reason === 'otro' && notes.trim().length === 0;
    const puedeDescartar = Boolean(reason) && !bloqueadoPorIntentos && !faltaDetalle;

    const descartar = async () => {
        if (!puedeDescartar) return;
        setSaving(true);

        try {
            const { error } = await supabase.rpc('discard_reactivation_case', {
                p_case_id: caseRow.id,
                p_reason: reason,
                p_notes: notes.trim() || null
            } as any);

            if (error) throw error;

            onDiscarded();
            onClose();
        } catch (error: any) {
            alert(`No se pudo descartar el caso: ${error?.message || 'error desconocido'}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Descartar caso</p>
                        <h3 className="text-2xl font-black text-gray-900 mt-1">{caseRow.client_name}</h3>
                    </div>
                    <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
                        <X size={20} />
                    </button>
                </div>

                {bloqueadoPorIntentos && (
                    <div className="mb-6 flex gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                        <AlertTriangle size={20} className="shrink-0 text-amber-600" />
                        <p className="text-xs font-bold text-amber-900 leading-snug">
                            Faltan {intentosFaltantes} intento(s) por registrar antes de poder descartar este
                            caso. Se exigen {minAttempts} para que un cliente no se dé por perdido sin haberlo
                            trabajado.
                        </p>
                    </div>
                )}

                <div className="space-y-5">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Motivo</label>
                        <select
                            value={reason}
                            onChange={(event) => setReason(event.target.value as DiscardReason)}
                            disabled={bloqueadoPorIntentos}
                            className="mt-2 w-full p-4 bg-gray-50 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none disabled:opacity-40"
                        >
                            <option value="">Selecciona un motivo</option>
                            {DISCARD_REASONS.map((opcion) => (
                                <option key={opcion.value} value={opcion.value}>{opcion.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            Detalle {reason === 'otro' ? '(obligatorio)' : '(opcional)'}
                        </label>
                        <textarea
                            rows={3}
                            value={notes}
                            onChange={(event) => setNotes(event.target.value)}
                            disabled={bloqueadoPorIntentos}
                            className="mt-2 w-full p-4 bg-gray-50 focus:bg-white rounded-2xl font-medium text-gray-700 outline-none resize-none disabled:opacity-40"
                        />
                    </div>

                    <button
                        onClick={descartar}
                        disabled={!puedeDescartar || saving}
                        className="w-full rounded-2xl bg-rose-600 px-6 py-4 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Descartando...' : 'Descartar caso'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReactivationDiscardModal;
