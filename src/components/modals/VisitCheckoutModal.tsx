import React, { useEffect, useState } from 'react';
import { Calendar, Stethoscope, User } from 'lucide-react';
import { clearPersistedModalDraft, loadPersistedModalDraft, savePersistedModalDraft } from '../../utils/modalDrafts';
import { getVirtualChannelLabel, VIRTUAL_OUTCOMES, VirtualCheckoutDetails, VirtualOutcome } from '../../utils/virtualVisits';

const toDateTimeLocalValue = (date: Date) => {
    const offsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

interface VisitCheckoutModalProps {
    isOpen: boolean;
    notes: string;
    onNotesChange: (notes: string) => void;
    // Receives the virtual checkout details when virtualChannel is set.
    onSave: (virtual?: VirtualCheckoutDetails) => void;
    onClose: () => void;
    onSchedule?: () => void;
    saving: boolean;
    showLeadScore?: boolean;
    leadScore?: number | null;
    onLeadScoreChange?: (score: number | null) => void;
    requireClientEmail?: boolean;
    clientEmail?: string;
    onClientEmailChange?: (email: string) => void;
    requireDoctorDetails?: boolean;
    doctorName?: string;
    onDoctorNameChange?: (name: string) => void;
    doctorSpecialty?: string;
    onDoctorSpecialtyChange?: (specialty: string) => void;
    persistenceKey?: string;
    // Set for virtual visits: asks for outcome, duration and next step.
    virtualChannel?: string | null;
    startedAt?: string | null;
}

const VisitCheckoutModal: React.FC<VisitCheckoutModalProps> = ({
    isOpen,
    notes,
    onNotesChange,
    onSave,
    onClose,
    onSchedule,
    saving,
    showLeadScore = false,
    leadScore = null,
    onLeadScoreChange,
    requireClientEmail = false,
    clientEmail = '',
    onClientEmailChange,
    requireDoctorDetails = false,
    doctorName = '',
    onDoctorNameChange,
    doctorSpecialty = '',
    onDoctorSpecialtyChange,
    persistenceKey,
    virtualChannel = null,
    startedAt = null
}) => {
    const [restoredOpen, setRestoredOpen] = useState(false);
    const [outcome, setOutcome] = useState<VirtualOutcome | ''>('');
    const [durationMinutes, setDurationMinutes] = useState('');
    const [nextActionAt, setNextActionAt] = useState('');
    const effectiveOpen = isOpen || restoredOpen;
    const isVirtual = Boolean(virtualChannel);
    const durationValue = durationMinutes.trim() === '' ? null : Number(durationMinutes);
    const durationIsValid = durationValue === null || (Number.isInteger(durationValue) && durationValue >= 0 && durationValue <= 600);
    const nextActionIsValid = !nextActionAt || !Number.isNaN(new Date(nextActionAt).getTime());
    const requiresLeadScore = showLeadScore;
    const emailIsValid = /\S+@\S+\.\S+/.test(clientEmail.trim());
    const doctorDetailsReady = doctorName.trim().length > 0 && doctorSpecialty.trim().length > 0;
    const canConfirm = notes.trim()
        && !saving
        && (!requiresLeadScore || leadScore !== null)
        && (!requireClientEmail || emailIsValid)
        && (!requireDoctorDetails || doctorDetailsReady)
        && (!isVirtual || (outcome !== '' && durationIsValid && nextActionIsValid));

    // The modal stays mounted across visits (GlobalVisitTimer): start clean for each one.
    useEffect(() => {
        setOutcome('');
        setDurationMinutes('');
        setNextActionAt('');
    }, [persistenceKey]);

    // Prefill the duration with the elapsed time the first time the modal opens.
    useEffect(() => {
        if (!effectiveOpen || !isVirtual || !startedAt || durationMinutes !== '') return;
        const elapsed = Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
        if (Number.isFinite(elapsed)) setDurationMinutes(String(Math.min(elapsed, 600)));
    }, [effectiveOpen, isVirtual, startedAt]);

    useEffect(() => {
        if (!effectiveOpen || !persistenceKey) return;

        const savedDraft = loadPersistedModalDraft<{
            notes: string;
            leadScore: number | null;
            clientEmail: string;
            doctorName: string;
            doctorSpecialty: string;
            outcome?: VirtualOutcome | '';
            durationMinutes?: string;
            nextActionAt?: string;
        }>(persistenceKey);

        if (!savedDraft?.data) return;

        onNotesChange(savedDraft.data.notes || '');
        onLeadScoreChange?.(savedDraft.data.leadScore ?? null);
        onClientEmailChange?.(savedDraft.data.clientEmail || '');
        onDoctorNameChange?.(savedDraft.data.doctorName || '');
        onDoctorSpecialtyChange?.(savedDraft.data.doctorSpecialty || '');
        setOutcome(savedDraft.data.outcome || '');
        if (savedDraft.data.durationMinutes) setDurationMinutes(savedDraft.data.durationMinutes);
        setNextActionAt(savedDraft.data.nextActionAt || '');

        if (!isOpen && savedDraft.isOpen !== false) {
            setRestoredOpen(true);
        }
    }, [
        effectiveOpen,
        isOpen,
        onClientEmailChange,
        onDoctorNameChange,
        onDoctorSpecialtyChange,
        onLeadScoreChange,
        onNotesChange,
        persistenceKey
    ]);

    useEffect(() => {
        if (!effectiveOpen || !persistenceKey) return;

        savePersistedModalDraft(persistenceKey, {
            notes,
            leadScore,
            clientEmail,
            doctorName,
            doctorSpecialty,
            outcome,
            durationMinutes,
            nextActionAt
        }, true);
    }, [clientEmail, doctorName, doctorSpecialty, effectiveOpen, leadScore, notes, persistenceKey, outcome, durationMinutes, nextActionAt]);

    const handleClose = () => {
        if (persistenceKey) {
            clearPersistedModalDraft(persistenceKey);
        }
        setRestoredOpen(false);
        onClose();
    };

    const handleSave = () => {
        if (persistenceKey) {
            clearPersistedModalDraft(persistenceKey);
        }
        setRestoredOpen(false);
        if (isVirtual && outcome) {
            onSave({
                outcome,
                durationMinutes: durationValue,
                nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : null
            });
            return;
        }
        onSave();
    };

    if (!effectiveOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl animate-in slide-in-from-bottom-10 duration-300">
                <h3 className="text-2xl font-black text-gray-900 mb-2">{isVirtual ? 'Finalizar Gestión Virtual' : 'Finalizar Visita'}</h3>
                <p className="text-gray-400 font-bold text-sm mb-6 uppercase tracking-wider">
                    {isVirtual ? `${getVirtualChannelLabel(virtualChannel)} · registra el resultado` : 'Registra la gestión realizada'}
                </p>

                <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                    {isVirtual && (
                        <div>
                            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Resultado <span className="text-red-500">*</span></label>
                            <div className="grid grid-cols-2 gap-2">
                                {VIRTUAL_OUTCOMES.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        disabled={saving}
                                        onClick={() => setOutcome(item.value)}
                                        className={`p-3 rounded-xl border text-xs font-black uppercase tracking-wider transition-all ${outcome === item.value
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'
                                            }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Notas / Comentarios <span className="text-red-500">*</span></label>
                        <textarea
                            value={notes}
                            onChange={(e) => onNotesChange(e.target.value)}
                            className="w-full h-32 p-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none resize-none transition-all placeholder:font-normal"
                            placeholder="Detalla los acuerdos, compromisos o resultados de la visita..."
                            autoFocus={!isVirtual}
                        />
                    </div>
                    {isVirtual && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Duración (min)</label>
                                <input
                                    type="number"
                                    min={0}
                                    max={600}
                                    inputMode="numeric"
                                    value={durationMinutes}
                                    onChange={(e) => setDurationMinutes(e.target.value)}
                                    className="w-full p-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none transition-all"
                                />
                                {!durationIsValid && (
                                    <p className="text-[11px] mt-2 font-bold text-red-500">Ingresa minutos enteros entre 0 y 600.</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Próximo paso</label>
                                <input
                                    type="datetime-local"
                                    min={toDateTimeLocalValue(new Date())}
                                    value={nextActionAt}
                                    onChange={(e) => setNextActionAt(e.target.value)}
                                    className="w-full p-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none transition-all"
                                />
                                <p className="text-[11px] mt-2 font-bold text-gray-400">Opcional. Crea una tarea de seguimiento.</p>
                            </div>
                        </div>
                    )}
                    {showLeadScore && (
                        <div>
                            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Nivel de Interés del Prospecto</label>
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { value: 1, label: 'Bajo' },
                                    { value: 2, label: 'Medio' },
                                    { value: 3, label: 'Alto' }
                                ].map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        disabled={saving}
                                        onClick={() => onLeadScoreChange?.(item.value)}
                                        className={`p-3 rounded-xl border text-xs font-black uppercase tracking-wider transition-all ${leadScore === item.value
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'
                                            }`}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {requireClientEmail && (
                        <div>
                            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Correo del Cliente <span className="text-red-500">*</span></label>
                            <input
                                type="email"
                                value={clientEmail}
                                onChange={(e) => onClientEmailChange?.(e.target.value)}
                                placeholder="cliente@clinica.cl"
                                className="w-full p-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none transition-all"
                            />
                            {!emailIsValid && clientEmail.trim().length > 0 && (
                                <p className="text-[11px] mt-2 font-bold text-red-500">Ingresa un correo válido para finalizar la visita.</p>
                            )}
                        </div>
                    )}
                    {requireDoctorDetails && (
                        <>
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Nombre del Doctor <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                                    <input
                                        type="text"
                                        value={doctorName}
                                        onChange={(e) => onDoctorNameChange?.(e.target.value)}
                                        placeholder="Ej. Dr. Juan Pérez"
                                        className="w-full pl-11 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Especialidad <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <Stethoscope size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                                    <input
                                        type="text"
                                        value={doctorSpecialty}
                                        onChange={(e) => onDoctorSpecialtyChange?.(e.target.value)}
                                        placeholder="Ej. Implantología"
                                        className="w-full pl-11 pr-4 py-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none transition-all"
                                    />
                                </div>
                                {!doctorDetailsReady && (
                                    <p className="text-[11px] mt-2 font-bold text-red-500">Debes registrar doctor y especialidad para cerrar la visita en frío.</p>
                                )}
                            </div>
                        </>
                    )}

                    {onSchedule && !isVirtual && (
                        <button
                            onClick={onSchedule}
                            disabled={saving}
                            className="w-full flex items-center justify-center space-x-3 p-4 bg-indigo-50 text-indigo-600 rounded-2xl font-bold hover:bg-indigo-100 transition-all border border-indigo-100 active:scale-95 px-6"
                        >
                            <Calendar size={18} />
                            <span>Agendar Gestión</span>
                        </button>
                    )}

                    <div className="grid grid-cols-2 gap-4 mt-6">
                        <button
                            onClick={handleClose}
                            className="p-4 rounded-xl font-black text-gray-400 hover:bg-gray-100 transition-all uppercase text-xs tracking-widest"
                            disabled={saving}
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!canConfirm}
                            className={`p-4 rounded-xl font-black text-white shadow-lg uppercase text-xs tracking-widest transition-all ${!canConfirm ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 active:scale-95 shadow-red-200'}`}
                        >
                            {saving ? 'Guardando...' : 'Confirmar Término'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default VisitCheckoutModal;
