import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headset, Mail, MessageCircle, Phone, Video, X } from 'lucide-react';
import { useVisit } from '../../contexts/VisitContext';
import {
    buildVirtualChannelUrl,
    openVirtualChannel,
    VIRTUAL_CHANNELS,
    VIRTUAL_VISIT_TYPE,
    VirtualChannel
} from '../../utils/virtualVisits';

interface VirtualVisitStartModalProps {
    client: {
        id: string;
        name: string;
        phone?: string | null;
        email?: string | null;
    };
    isOpen: boolean;
    onClose: () => void;
}

const CHANNEL_ICONS: Record<VirtualChannel, typeof Phone> = {
    call: Phone,
    whatsapp: MessageCircle,
    video: Video,
    email: Mail
};

// Inicia una gestion virtual: una visita sin GPS que corre con el cronometro global y se
// cierra con resultado, duracion y proximo paso.
const VirtualVisitStartModal = ({ client, isOpen, onClose }: VirtualVisitStartModalProps) => {
    const navigate = useNavigate();
    const { activeVisit, startVisit } = useVisit();
    const [channel, setChannel] = useState<VirtualChannel>('call');
    const [openChannel, setOpenChannel] = useState(true);
    const [starting, setStarting] = useState(false);

    if (!isOpen) return null;

    const channelUrl = buildVirtualChannelUrl(channel, client);

    const handleStart = async () => {
        if (activeVisit) {
            alert('Ya tienes una visita o gestión en curso. Termínala antes de iniciar otra.');
            navigate(`/visit/${activeVisit.client_id}`);
            onClose();
            return;
        }

        setStarting(true);
        try {
            const visit = await startVisit(client.id, { type: VIRTUAL_VISIT_TYPE, channel });
            if (!visit) return;

            if (visit.client_id !== client.id || visit.type !== VIRTUAL_VISIT_TYPE) {
                // startVisit resumes a visit left open in the database.
                alert('Tenías una visita en curso sin cerrar. Termínala antes de iniciar la gestión virtual.');
                navigate(`/visit/${visit.client_id}`);
                onClose();
                return;
            }

            if (openChannel && channelUrl) openVirtualChannel(channelUrl);
            onClose();
            navigate(`/visit/${client.id}`);
        } finally {
            setStarting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[115] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-2xl font-black text-gray-900">Gestión Virtual</h3>
                        <p className="text-sm text-gray-500">Cliente: {client.name}</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-5">
                    {VIRTUAL_CHANNELS.map((item) => {
                        const Icon = CHANNEL_ICONS[item.value];
                        return (
                            <button
                                key={item.value}
                                onClick={() => setChannel(item.value)}
                                className={`p-4 rounded-2xl border-2 font-bold flex flex-col items-center gap-1 transition-all ${channel === item.value ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                            >
                                <Icon size={22} />
                                {item.label}
                                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{item.desc}</span>
                            </button>
                        );
                    })}
                </div>

                {channel !== 'video' && (
                    <label className={`flex items-center gap-3 p-4 rounded-2xl bg-gray-50 mb-5 ${channelUrl ? 'cursor-pointer' : 'opacity-60'}`}>
                        <input
                            type="checkbox"
                            checked={openChannel && Boolean(channelUrl)}
                            disabled={!channelUrl}
                            onChange={(e) => setOpenChannel(e.target.checked)}
                            className="w-4 h-4 accent-indigo-600"
                        />
                        <span className="text-sm font-bold text-gray-700">
                            {channelUrl
                                ? `Abrir ${channel === 'call' ? 'el marcador' : channel === 'whatsapp' ? 'WhatsApp' : 'el correo'} al iniciar`
                                : `La ficha no tiene ${channel === 'email' ? 'correo' : 'teléfono'} registrado`}
                        </span>
                    </label>
                )}

                <p className="text-xs text-gray-500 font-medium mb-5">
                    El cronómetro corre como en una visita. Al terminar registras el resultado, la duración y el próximo paso. Cuenta para tu meta diaria de visitas.
                </p>

                <button
                    onClick={handleStart}
                    disabled={starting}
                    className="w-full flex items-center justify-center gap-2 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg transition-all active:scale-95 disabled:opacity-50"
                >
                    <Headset size={18} />
                    {starting ? 'Iniciando...' : 'Iniciar gestión'}
                </button>
            </div>
        </div>
    );
};

export default VirtualVisitStartModal;
