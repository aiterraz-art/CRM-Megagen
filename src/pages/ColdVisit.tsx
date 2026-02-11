import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkGPSConnection } from '../utils/gps';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { useVisit } from '../contexts/VisitContext';
import { User, MapPin, Building2, ChevronRight, Stethoscope } from 'lucide-react';
import { Database } from '../types/supabase';

type Client = Database['public']['Tables']['clients']['Row'];

const ColdVisit = () => {
    const navigate = useNavigate();
    const { profile } = useUser();
    const { startVisit, activeVisit } = useVisit();

    // Form State
    const [clinicName, setClinicName] = useState('');
    const [doctorName, setDoctorName] = useState('');
    const [address, setAddress] = useState('');
    const [loading, setLoading] = useState(false);
    const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);

    // Get location on mount
    useEffect(() => {
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition((pos) => {
                setLocation({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                });
                // Optional: Reverse geocode here to pre-fill address if desired
            });
        }
    }, []);

    const handleStartColdVisit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clinicName || !doctorName) {
            alert('Por favor completa el nombre de la clínica y del doctor.');
            return;
        }

        if (!profile) return;
        setLoading(true);

        try {
            // 1. Create "Prospect" Client
            const newClient = {
                id: crypto.randomUUID(),
                name: clinicName,
                purchase_contact: doctorName,
                address: address || 'Dirección detectada por GPS', // Fallback
                lat: location?.lat || 0,
                lng: location?.lng || 0,
                status: 'prospect', // New status for Cold Visits
                created_by: profile.id,
                zone: profile.zone || 'Sin Zona',
                notes: `Visita en Frío iniciada el ${new Date().toLocaleDateString()}`
            };

            const { error: clientError } = await supabase.from('clients').insert(newClient);

            if (clientError) throw clientError;

            // 2. Start Visit immediately
            const visit = await startVisit(newClient.id);

            if (visit) {
                // 3. Redirect to Visit Log
                navigate(`/visit/${newClient.id}`);
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

                {/* Doctor Name */}
                <div className="space-y-2">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Nombre Doctor / Contacto</label>
                    <div className="relative group">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-blue-500 transition-colors" size={20} />
                        <input
                            type="text"
                            value={doctorName}
                            onChange={(e) => setDoctorName(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-transparent rounded-2xl font-bold text-gray-900 focus:bg-white focus:ring-4 focus:ring-blue-50 focus:border-blue-100 outline-none transition-all placeholder:text-gray-300 placeholder:font-medium"
                            placeholder="Ej. Dr. Juan Pérez"
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
                    Se registrará la ubicación GPS actual automáticamente.
                </p>
                {location && (
                    <p className="text-[10px] text-green-500 font-bold mt-1 flex items-center justify-center">
                        <MapPin size={10} className="mr-1" /> GPS Activo
                    </p>
                )}
            </div>

        </div>
    );
};

export default ColdVisit;
