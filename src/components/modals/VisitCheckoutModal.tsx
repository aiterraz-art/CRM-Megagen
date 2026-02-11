import React from 'react';

interface VisitCheckoutModalProps {
    notes: string;
    onNotesChange: (notes: string) => void;
    onSave: () => void;
    onClose: () => void;
    saving: boolean;
}

const VisitCheckoutModal: React.FC<VisitCheckoutModalProps> = ({ notes, onNotesChange, onSave, onClose, saving }) => {
    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-[2.5rem] p-8 shadow-2xl animate-in slide-in-from-bottom-10 duration-300">
                <h3 className="text-2xl font-black text-gray-900 mb-2">Finalizar Visita</h3>
                <p className="text-gray-400 font-bold text-sm mb-6 uppercase tracking-wider">Registra la gestión realizada</p>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Notas / Comentarios <span className="text-red-500">*</span></label>
                        <textarea
                            value={notes}
                            onChange={(e) => onNotesChange(e.target.value)}
                            className="w-full h-32 p-4 bg-gray-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none resize-none transition-all placeholder:font-normal"
                            placeholder="Detalla los acuerdos, compromisos o resultados de la visita..."
                            autoFocus
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-6">
                        <button
                            onClick={onClose}
                            className="p-4 rounded-xl font-black text-gray-400 hover:bg-gray-100 transition-all uppercase text-xs tracking-widest"
                            disabled={saving}
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={onSave}
                            disabled={!notes.trim() || saving}
                            className={`p-4 rounded-xl font-black text-white shadow-lg uppercase text-xs tracking-widest transition-all ${!notes.trim() ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 active:scale-95 shadow-red-200'}`}
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
