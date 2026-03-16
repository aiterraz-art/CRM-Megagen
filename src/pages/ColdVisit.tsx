import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkGPSConnection } from '../utils/gps';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { useVisit } from '../contexts/VisitContext';
import { queueVisitCheckinLocation } from '../services/locationQueue';
import { MapPin, Building2, ChevronRight, Stethoscope } from 'lucide-react';

const formatGpsAddress = (lat: number, lng: number) => `Ubicación GPS (${lat.toFixed(6)}, ${lng.toFixed(6)})`;
const COLD_VISIT_DRAFT_KEY = 'cold_visit_draft';

const loadColdVisitDraft = () => {
    if (typeof window === 'undefined') return { clinicName: '', address: '' };

    try {
        const savedDraft = localStorage.getItem(COLD_VISIT_DRAFT_KEY);
        if (!savedDraft) return { clinicName: '', address: '' };

        const parsed = JSON.parse(savedDraft);
        return {
            clinicName: String(parsed?.clinicName || ''),
            address: String(parsed?.address || '')
        };
    } catch {
        return { clinicName: '', address: '' };
    }
};

const reverseGeocodeAddress = async (lat: number, lng: number): Promise<string | null> => {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&accept-language=es`;
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const label = typeof payload?.display_name === 'string' ? payload.display_name.trim() : '';
        return label || null;
    } catch {
        return null;
    }
};

const ColdVisit = () => {
    const navigate = useNavigate();
    const { profile } = useUser();
    const { startVisit, activeVisit } = useVisit();
    const initialDraft = loadColdVisitDraft();

    // Form State
    const [clinicName, setClinicName] = useState(initialDraft.clinicName);
    const [address, setAddress] = useState(initialDraft.address);
    const [loading, setLoading] = useState(false);
    const [location, setLocation] = useState<{ lat: number, lng: number, accuracy: number } | null>(null);
    const [gpsReady, setGpsReady] = useState(false);

    // Get location on mount
    useEffect(() => {
        let mounted = true;
        const loadLocation = async () => {
            try {
                const pos = await checkGPSConnection({ showAlert: false, timeoutMs: 15000, retries: 2, minAccuracyMeters: 200 });
                if (!mounted) return;
                setLocation({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                });
                setGpsReady(true);
            } catch (error) {
                console.warn('ColdVisit GPS unavailable:', error);
                if (mounted) setGpsReady(false);
            }
        };
        loadLocation();
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        localStorage.setItem(COLD_VISIT_DRAFT_KEY, JSON.stringify({
            clinicName,
            address
        }));
    }, [clinicName, address]);

    const handleStartColdVisit = async (e: React.FormEvent) => {
        e.preventDefault();
        const clinicNameClean = clinicName.trim();
        const addressClean = address.trim();

        if (!clinicNameClean) {
            alert('Por favor completa el nombre de la clínica.');
            return;
        }
        if (clinicNameClean.length < 3) {
            alert('El nombre de la clínica debe tener al menos 3 caracteres.');
            return;
        }

        if (!profile) return;
        if (activeVisit) {
            alert('Ya tienes una visita en curso. Debes finalizarla antes de iniciar una nueva.');
            if (activeVisit.client_id) {
                navigate(`/visit/${activeVisit.client_id}`);
            }
            return;
        }
        setLoading(true);

        try {
            let currentLocation = location;
            if (!currentLocation) {
                try {
                    const gpsPosition = await checkGPSConnection({
                        showAlert: false,
                        timeoutMs: 15000,
                        retries: 2,
                        minAccuracyMeters: 200
                    });
                    currentLocation = {
                        lat: gpsPosition.coords.latitude,
                        lng: gpsPosition.coords.longitude,
                        accuracy: gpsPosition.coords.accuracy
                    };
                    setLocation(currentLocation);
                    setGpsReady(true);
                } catch {
                    currentLocation = null;
                }
            }

            if (!currentLocation) {
                alert('No fue posible obtener GPS confiable para registrar la visita en frío. Activa la ubicación y vuelve a intentar.');
                return;
            }

            let resolvedAddress = addressClean;
            if (!resolvedAddress) {
                resolvedAddress = (await reverseGeocodeAddress(currentLocation.lat, currentLocation.lng)) || formatGpsAddress(currentLocation.lat, currentLocation.lng);
            }

            // 1. Create "Prospect" Client
            const newClient = {
                name: clinicNameClean,
                purchase_contact: null,
                doctor_specialty: null,
                address: resolvedAddress,
                lat: currentLocation?.lat ?? null,
                lng: currentLocation?.lng ?? null,
                status: 'prospect_new',
                created_by: profile.id,
                zone: profile.zone || 'Sin Zona',
                notes: `Visita en Frío iniciada el ${new Date().toLocaleDateString()} (con GPS ±${Math.round(currentLocation.accuracy)}m)`
            };

            const { data: createdClient, error: clientError } = await supabase
                .from('clients')
                .insert(newClient)
                .select('id')
                .single();

            if (clientError) throw clientError;
            if (!createdClient?.id) throw new Error('No se pudo crear el prospecto.');

            // 2. Start Visit immediately
            const visit = await startVisit(createdClient.id, { type: 'cold_visit' });

            if (visit) {
                localStorage.removeItem(COLD_VISIT_DRAFT_KEY);
                await queueVisitCheckinLocation({
                    visit_id: visit.id,
                    seller_id: profile.id,
                    lat: currentLocation.lat,
                    lng: currentLocation.lng
                });
                // 3. Redirect to Visit Log
                navigate(`/visit/${createdClient.id}`);
            } else {
                throw new Error("No se pudo iniciar la visita después de crear el cliente.");
            }

        } catch (error: any) {
            console.error("Error in Cold Visit:", error);
            alert(`Error al iniciar: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-xl mx-auto px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-8">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-100 shadow-xl shadow-blue-50">
                    <Stethoscope size={32} />
                </div>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">Visita en Frío</h1>
                <p className="text-gray-400 font-medium mt-2">Registra un nuevo prospecto y comienza la visita de inmediato.</p>
            </div>

            <form onSubmit={handleStartColdVisit} className="premium-card p-8 space-y-6">

                {/* Clinic Name */}
                <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Nombre Clínica / Lugar</label>
                    <div className="relative group">
                        <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-blue-500 transition-colors" size={20} />
                        <input
                            type="text"
                            value={clinicName}
                            onChange={(e) => setClinicName(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-transparent rounded-2xl font-bold text-gray-900 focus:bg-white focus:ring-4 focus:ring-blue-50 focus:border-blue-100 outline-none transition-all placeholder:text-gray-300 placeholder:font-medium"
                            placeholder="Ej. Clínica Dental Centro"
                            required
                        />
                    </div>
                </div>

                {/* Address (Optional) */}
                <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Dirección (Opcional)</label>
                    <div className="relative group">
                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-blue-500 transition-colors" size={20} />
                        <input
                            type="text"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-transparent rounded-2xl font-bold text-gray-900 focus:bg-white focus:ring-4 focus:ring-blue-50 focus:border-blue-100 outline-none transition-all placeholder:text-gray-300 placeholder:font-medium"
                            placeholder="Ej. Av. Providencia 1234"
                        />
                    </div>
                </div>

                <div className="pt-4">
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all flex items-center justify-center hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <span className="flex items-center">
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                                Creando...
                            </span>
                        ) : (
                            <>
                                Iniciar Visita <ChevronRight className="ml-2" />
                            </>
                        )}
                    </button>
                </div>

            </form>

            <div className="text-center mt-6">
                <p className="text-xs text-gray-400 font-medium">
                    Se requiere GPS para iniciar visita en frío y registrar ubicación real.
                </p>
                <p className="text-[11px] text-gray-500 font-bold mt-2">
                    Al finalizar la visita será obligatorio ingresar nombre del doctor y su especialidad.
                </p>
                <p className={`text-[10px] font-bold mt-1 flex items-center justify-center ${gpsReady ? 'text-green-500' : 'text-amber-500'}`}>
                    <MapPin size={10} className="mr-1" /> {gpsReady ? 'GPS Activo' : 'GPS no disponible'}
                </p>
            </div>

        </div>
    );
};

export default ColdVisit;
