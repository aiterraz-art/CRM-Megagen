import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { calculateDistance } from '../utils/geo';
import { checkGPSConnection } from '../utils/gps';

import { useUser } from '../contexts/UserContext';
import { Database } from '../types/supabase';
import { MapPin, Clock, Camera, CheckCircle, ChevronRight, AlertCircle, Navigation, ShoppingCart } from 'lucide-react';
import { useVisit } from '../contexts/VisitContext';
import VisualEvidence from '../components/VisualEvidence';
import VisitCheckoutModal from '../components/modals/VisitCheckoutModal';
import { APIProvider } from '@vis.gl/react-google-maps';
import ClientFormModal from '../components/modals/ClientFormModal';

type Client = Database['public']['Tables']['clients']['Row'];

const VisitLog = () => {
    const { clientId } = useParams<{ clientId: string }>();
    const { profile } = useUser();
    const { startVisit, activeVisit } = useVisit(); // Use context
    const navigate = useNavigate();
    const [client, setClient] = useState<Client | null>(null);
    // Use activeVisit if available, or fall back to local state if needed (though activeVisit is better)
    const [visitId, setVisitId] = useState<string | null>(null);
    const [isNear, setIsNear] = useState(false);

    // Missing state variables restored:
    const [loading, setLoading] = useState(true);
    const [visitStartTime, setVisitStartTime] = useState<Date | null>(null);
    const [elapsedTime, setElapsedTime] = useState<number>(0);
    const [showOrder, setShowOrder] = useState(false);
    const [showEvidence, setShowEvidence] = useState(false);
    const [finishing, setFinishing] = useState(false);
    const [showNotesModal, setShowNotesModal] = useState(false);
    const [visitNotes, setVisitNotes] = useState('');

    // Client Validation State
    // Client Validation State
    const [showClientForm, setShowClientForm] = useState(() => {
        return localStorage.getItem('visit_log_client_modal_open') === 'true';
    });

    // Persist Modal State
    useEffect(() => {
        if (showClientForm) {
            localStorage.setItem('visit_log_client_modal_open', 'true');
        } else {
            localStorage.removeItem('visit_log_client_modal_open');
        }
    }, [showClientForm]);

    useEffect(() => {
        const fetchClient = async () => {
            if (!clientId) return;
            const { data } = await (supabase.from('clients') as any).select('*').eq('id', clientId).single();
            if (data) {
                // Security Check
                const canViewAll = profile?.role === 'admin' || profile?.role === 'supervisor' || profile?.email === 'aterraza@imegagen.cl';
                if (!canViewAll && data.created_by !== profile?.id) {
                    alert('Acceso denegado: Este cliente no está en tu cartera.');
                    navigate('/');
                    return;
                }

                setClient(data as any as Client);
                checkGeofence(data as any as Client);
            }
            setLoading(false);
        };
        if (profile) fetchClient();
    }, [clientId, profile]);

    const checkGeofence = async (clientData: Client) => {
        try {
            // Non-blocking check for UI feedback
            const position = await checkGPSConnection();
            if (clientData.lat && clientData.lng) {
                const dist = calculateDistance(position.coords.latitude, position.coords.longitude, clientData.lat, clientData.lng);
                setIsNear(dist < 2000); // 2km toleranceance
            }
        } catch (e) {
            console.warn("Geofence check failed due to GPS", e);
            // Don't alert here to avoid spamming on mount, just default isNear to false (yellow state)
        }
    };

    // Sync local visitId with global activeVisit
    useEffect(() => {
        if (activeVisit && activeVisit.client_id === clientId && activeVisit.check_in_time) {
            setVisitId(activeVisit.id);
            setVisitStartTime(new Date(activeVisit.check_in_time));
        }
    }, [activeVisit, clientId]);

    useEffect(() => {
        let interval: any;
        if (visitId && visitStartTime) {
            interval = setInterval(() => {
                const now = new Date();
                const diff = Math.floor((now.getTime() - visitStartTime.getTime()) / 1000);
                setElapsedTime(diff);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [visitId, visitStartTime]);

    const handleCheckIn = async () => {
        console.log("Attempting check-in...", { clientId, profile });
        if (!clientId || !profile) {
            alert("Error: No se pudo identificar al cliente o al usuario. Intenta recargar la página.");
            return;
        }

        if (!isNear) {
            const confirmForce = window.confirm("⚠️ ADVERTENCIA DE DISTANCIA\n\nEstás a más de 2km del cliente.\n¿Deseas FORZAR el inicio de la visita de todos modos?\n\nEsta acción quedará registrada.");
            if (!confirmForce) return;
        }

        try {
            // Use Global Context to start visit
            const newVisit = await startVisit(clientId);

            if (newVisit) {
                console.log("Check-in success:", newVisit);
                setVisitId(newVisit.id);
                setVisitStartTime(new Date());
            }
        } catch (error: any) {
            console.error("Catch error:", error);
            alert(`Error inesperado: ${error.message || 'Error desconocido'}`);
        }
    };

    const formatTime = (totalSeconds: number) => {
        const isOvertime = totalSeconds > 20 * 60; // 20 minutes limit
        const displaySeconds = isOvertime ? totalSeconds - (20 * 60) : (20 * 60) - totalSeconds;

        const minutes = Math.floor(displaySeconds / 60);
        const seconds = displaySeconds % 60;
        const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        return { formatted, isOvertime };
    };

    const handleCheckOut = async () => {
        if (!visitId) return;
        setFinishing(true);

        try {
            // STRICT GPS ENFORCE FOR CHECKOUT
            const position = await checkGPSConnection();

            const checkoutPayload: any = {
                check_out_time: new Date().toISOString(),
                status: 'completed',
                notes: visitNotes || null,
                check_out_lat: position.coords.latitude,
                check_out_lng: position.coords.longitude
            };

            await (supabase.from('visits') as any).update(checkoutPayload).eq('id', visitId);
            navigate('/');
        } catch (error) {
            setFinishing(false); // Enable button again if failed
            // Alert already shown by checkGPSConnection
        }
    };

    const handleQuotationClick = () => {
        if (!client) return;

        // Validation Logic for Prospects
        // Check if status is prospect OR if critical fields are missing
        const isProspect = (client as any).status === 'prospect';
        const isMissingData = !client.rut || !client.email || !client.phone;

        if (isProspect || isMissingData) {
            alert("⚠️ DATOS INCOMPLETOS\n\nPara generar una cotización formal, debes completar la ficha del cliente (RUT, Email, Teléfono, etc.).");
            setShowClientForm(true);
        } else {
            navigate('/quotations', { state: { client } });
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Verifying Identity...</div>;
    if (!client) return <div className="p-8 text-center text-red-500 font-bold">Client not found</div>;

    // Previous conditional visual return was removed here.

    return (
        <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY} libraries={['places']}>
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Visual Evidence Modal */}
                {showEvidence && visitId && (
                    <VisualEvidence
                        visitId={visitId}
                        clientName={client?.name}
                        onClose={() => setShowEvidence(false)}
                    />
                )}

                {/* Notes Modal */}
                {showNotesModal && (
                    <VisitCheckoutModal
                        notes={visitNotes}
                        onNotesChange={setVisitNotes}
                        onSave={() => {
                            setShowNotesModal(false);
                            handleCheckOut();
                        }}
                        onClose={() => setShowNotesModal(false)}
                        saving={finishing}
                    />
                )}

                {/* Client Completion Modal */}
                {showClientForm && client && (
                    <ClientFormModal
                        isOpen={showClientForm}
                        onClose={() => setShowClientForm(false)}
                        initialData={client}
                        title="Completar Ficha Cliente"
                        onSave={async (updatedData) => {
                            const { error } = await supabase
                                .from('clients')
                                .update({ ...updatedData, status: 'active' }) // Upgrade to active once saved
                                .eq('id', client.id);

                            if (error) throw error;

                            // Update local state
                            setClient({ ...client, ...updatedData, status: 'active' } as any);
                            alert("Ficha actualizada correctamente. Ahora puedes cotizar.");
                            navigate('/quotations', { state: { client: { ...client, ...updatedData, status: 'active' } } });
                        }}
                    />
                )}


                {/* Header Info */}
                <div className="premium-card p-8 flex flex-col md:flex-row items-center justify-between gap-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                        <Navigation size={120} />
                    </div>
                    <div className="flex items-center space-x-6">
                        <div className="w-20 h-20 bg-dental-50 rounded-[2rem] flex items-center justify-center border border-dental-100 shadow-xl shadow-dental-50">
                            <span className="text-3xl font-black text-dental-600">{client.name.substring(0, 2)}</span>
                        </div>
                        <div>
                            <h2 className="text-3xl font-black text-gray-900">{client.name}</h2>
                            <div className="flex items-center text-gray-400 font-bold text-sm mt-1">
                                <MapPin size={16} className="mr-2 text-dental-400" />
                                {client.address}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col items-center">
                        <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] mb-2 ${isNear ? 'bg-green-50 text-green-600 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                            {isNear ? '• Secure Proximity Active' : '! Distance Warning'}
                        </div>
                        <p className="text-xs text-gray-400 font-bold">2KM GEOSHIELD ACTIVE</p>
                    </div>
                </div>

                {!visitId ? (
                    <div className="premium-card p-12 text-center space-y-8 bg-side-gradient/5 border-dashed border-2 border-dental-200">
                        <div className="space-y-2">
                            <h3 className="text-2xl font-black text-gray-900">Ready to start?</h3>
                            <p className="text-gray-400 font-medium">Your location is verified. Please check-in to begin logging the visit.</p>
                        </div>
                        <button
                            onClick={handleCheckIn}
                            className={`w-full max-w-sm py-5 rounded-[2rem] font-black text-lg shadow-2xl transition-all active:scale-95 ${isNear ? 'bg-dental-600 text-white shadow-dental-200' : 'bg-red-500 text-white shadow-red-200'}`}
                        // DISABLED REMOVED to allow force check-in
                        >
                            {isNear ? 'Establish Check-in' : 'Forzar Check-in (Fuera de Rango)'}
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <button
                            onClick={() => setShowEvidence(true)}
                            className="premium-card p-8 flex items-center justify-between group hover:border-dental-400 transition-all text-left"
                        >
                            <div className="flex items-center space-x-4">
                                <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-all">
                                    <Camera size={24} />
                                </div>
                                <div>
                                    <p className="font-black text-gray-900">Visual Evidence</p>
                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Sync Clinic Photos</p>
                                </div>
                            </div>
                            <ChevronRight size={20} className="text-gray-200" />
                        </button>

                        <button
                            onClick={handleQuotationClick}
                            className="premium-card p-8 flex items-center justify-between group hover:border-dental-400 transition-all text-left"
                        >
                            <div className="flex items-center space-x-4">
                                <div className="p-4 bg-teal-50 text-teal-600 rounded-2xl group-hover:bg-teal-600 group-hover:text-white transition-all">
                                    <ShoppingCart size={24} />
                                </div>
                                <div>
                                    <p className="font-black text-gray-900">Generar Cotización</p>
                                    <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Crear Propuesta</p>
                                </div>
                            </div>
                            <ChevronRight size={20} className="text-gray-200" />
                        </button>

                        <div className="md:col-span-2 p-4 text-center text-gray-400 text-xs uppercase tracking-widest font-bold bg-gray-50 rounded-xl border border-gray-100">
                            La visita está en curso. Usa la barra inferior para terminar.
                        </div>

                        {/* Checkout Button */}
                        <button
                            onClick={() => setShowNotesModal(true)}
                            disabled={finishing}
                            className="md:col-span-2 p-6 bg-red-50 text-red-600 rounded-2xl font-black text-lg hover:bg-red-600 hover:text-white transition-all shadow-lg active:scale-95"
                        >
                            {finishing ? "Procesando..." : "Finalizar Visita"}
                        </button>

                    </div>
                )}
            </div>
        </APIProvider>
    );
};

export default VisitLog;
