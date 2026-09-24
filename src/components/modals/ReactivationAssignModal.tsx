import { useMemo, useState } from 'react';
import { AlertTriangle, UserCheck, X } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { formatMoney } from '../../utils/reactivation';

type Candidate = {
    client_id: string;
    name: string;
    lifetime_amount: number;
    segment: string;
    owner_name: string | null;
};

type Seller = {
    id: string;
    nombre: string;
    rol: string;
};

interface Props {
    isOpen: boolean;
    candidates: Candidate[];
    sellers: Seller[];
    onClose: () => void;
    onAssigned: () => void;
}

const ReactivationAssignModal = ({ isOpen, candidates, sellers, onClose, onAssigned }: Props) => {
    const [assignedTo, setAssignedTo] = useState('');
    const [transferOwnership, setTransferOwnership] = useState(true);
    const [saving, setSaving] = useState(false);

    const montoTotal = useMemo(
        () => candidates.reduce((total, c) => total + Number(c.lifetime_amount || 0), 0),
        [candidates]
    );

    const destinoEsVendedor = useMemo(
        () => sellers.find((s) => s.id === assignedTo)?.rol === 'seller',
        [sellers, assignedTo]
    );

    if (!isOpen) return null;

    const asignar = async () => {
        if (!assignedTo || candidates.length === 0) return;
        setSaving(true);

        try {
            const { data, error } = await supabase.rpc('assign_reactivation_cases', {
                p_client_ids: candidates.map((c) => c.client_id),
                p_assigned_to: assignedTo,
                p_transfer_ownership: transferOwnership
            } as any);

            if (error) throw error;

            const resultado = data as any;
            alert(
                `Reparto completado. Casos creados: ${resultado?.creados ?? 0}.`
                + (Number(resultado?.omitidos || 0) > 0
                    ? ` Omitidos por tener ya un caso abierto: ${resultado.omitidos}.`
                    : '')
            );

            onAssigned();
            onClose();
        } catch (error: any) {
            alert(`No se pudo repartir: ${error?.message || 'error desconocido'}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Repartir casos</p>
                        <h3 className="text-2xl font-black text-gray-900 mt-1">
                            {candidates.length} cliente(s) seleccionado(s)
                        </h3>
                        <p className="text-sm font-bold text-indigo-600 mt-1">
                            {formatMoney(montoTotal)} de facturación histórica en juego
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            Asignar a
                        </label>
                        <select
                            value={assignedTo}
                            onChange={(event) => setAssignedTo(event.target.value)}
                            className="mt-2 w-full p-4 bg-gray-50 focus:bg-white rounded-2xl font-bold text-gray-700 outline-none"
                        >
                            <option value="">Selecciona un vendedor</option>
                            {sellers.map((vendedor) => (
                                <option key={vendedor.id} value={vendedor.id}>{vendedor.nombre}</option>
                            ))}
                        </select>
                    </div>

                    <label className="flex items-start gap-3 rounded-2xl bg-gray-50 p-4 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={transferOwnership}
                            onChange={(event) => setTransferOwnership(event.target.checked)}
                            className="mt-1"
                        />
                        <span>
                            <span className="block text-sm font-black text-gray-800">
                                Traspasar también la propiedad del cliente
                            </span>
                            <span className="block text-xs font-medium text-gray-500 mt-1 leading-snug">
                                Un vendedor solo ve los clientes de su propia cartera. Sin esto, los casos
                                quedarían invisibles para él y la asignación será rechazada.
                            </span>
                        </span>
                    </label>

                    {!transferOwnership && destinoEsVendedor && (
                        <div className="flex gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4">
                            <AlertTriangle size={20} className="shrink-0 text-rose-600" />
                            <p className="text-xs font-bold text-rose-900 leading-snug">
                                El destinatario es un vendedor: sin traspasar la propiedad, la base rechazará
                                el reparto.
                            </p>
                        </div>
                    )}

                    <div className="rounded-2xl border border-gray-100 overflow-hidden">
                        <div className="bg-gray-50 px-4 py-3">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                Vista previa del lote
                            </p>
                        </div>
                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                            {candidates.slice(0, 40).map((candidato) => (
                                <div key={candidato.client_id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-gray-800 truncate">{candidato.name}</p>
                                        <p className="text-[11px] font-medium text-gray-400">
                                            Dueño actual: {candidato.owner_name || 'sin asignar'}
                                        </p>
                                    </div>
                                    <span className="text-xs font-black text-indigo-600 shrink-0">
                                        {formatMoney(candidato.lifetime_amount)}
                                    </span>
                                </div>
                            ))}
                            {candidates.length > 40 && (
                                <p className="px-4 py-3 text-xs font-bold text-gray-400">
                                    y {candidates.length - 40} más...
                                </p>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={asignar}
                        disabled={!assignedTo || saving}
                        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-4 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-indigo-700 disabled:opacity-40"
                    >
                        <UserCheck size={16} />
                        {saving ? 'Repartiendo...' : `Asignar ${candidates.length} caso(s)`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReactivationAssignModal;
