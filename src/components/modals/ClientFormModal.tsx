import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabase';
import { X, Building2, User, Phone, Mail, MapPin, FileText, CheckCircle2 } from 'lucide-react';
import { Database } from '../../types/supabase';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

type Client = Database['public']['Tables']['clients']['Row'];

interface ClientFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (client: Partial<Client>) => Promise<void>;
    initialData?: Partial<Client> | null;

    title?: string;
    persistenceKey?: string; // Optional key for localStorage persistence
}

const ClientFormModal: React.FC<ClientFormModalProps> = ({ isOpen, onClose, onSave, initialData, title, persistenceKey }) => {
    const [formData, setFormData] = useState({
        name: '',
        purchase_contact: '', // purchase_contact in DB, often used as "Doctor/Contact"
        rut: '',
        phone: '',
        email: '',
        address: '',
        lat: 0,
        lng: 0,
        notes: '',
        giro: '',
        comuna: ''
    });
    const [loading, setLoading] = useState(false);
    const placesLib = useMapsLibrary('places');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (initialData) {
            setFormData({
                name: initialData.name || '',
                purchase_contact: initialData.purchase_contact || '',
                rut: initialData.rut || '',
                phone: initialData.phone || '',
                email: initialData.email || '',
                address: initialData.address || '',
                lat: initialData.lat || 0,
                lng: initialData.lng || 0,
                notes: initialData.notes || '',
                giro: initialData.giro || '',
                comuna: initialData.comuna || ''
            });

        } else if (persistenceKey) {
            // Restore from localStorage if no initialData provided (new client scenario)
            const saved = localStorage.getItem(persistenceKey);
            if (saved) {
                try {
                    setFormData(JSON.parse(saved));
                } catch (e) {
                    console.error("Failed to parse saved form data", e);
                }
            }
        }
    }, [initialData, isOpen, persistenceKey]);

    // Persist to LocalStorage on change
    useEffect(() => {
        if (persistenceKey && isOpen) {
            localStorage.setItem(persistenceKey, JSON.stringify(formData));
        }
    }, [formData, persistenceKey, isOpen]);

    // Google Places Autocomplete
    useEffect(() => {
        if (!placesLib || !inputRef.current || !isOpen) return;

        const autocomplete = new placesLib.Autocomplete(inputRef.current, {
            fields: ['geometry', 'formatted_address', 'address_components'],
            componentRestrictions: { country: 'cl' }
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place.geometry?.location) {
                const lat = place.geometry.location.lat();
                const lng = place.geometry.location.lng();
                const address = place.formatted_address || '';

                // Extract Comuna if possible (administrative_area_level_3 or locality)
                let comuna = '';
                place.address_components?.forEach(comp => {
                    if (comp.types.includes('administrative_area_level_3') || comp.types.includes('locality')) {
                        comuna = comp.long_name;
                    }
                });

                setFormData(prev => ({ ...prev, address, lat, lng, comuna: comuna || prev.comuna }));
            }
        });
    }, [placesLib, isOpen]);

    const handleChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await onSave(formData);
            if (persistenceKey) localStorage.removeItem(persistenceKey); // Clear draft on success
            onClose();
        } catch (error) {
            console.error("Error saving client:", error);
            alert("Error al guardar cliente. Revisa los datos.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-300">
                <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-[2.5rem]">
                    <div>
                        <h3 className="text-2xl font-black text-gray-900">{title || 'Datos del Cliente'}</h3>
                        <p className="text-gray-400 font-bold text-xs uppercase tracking-wider mt-1">Completa la ficha técnica</p>
                    </div>
                    <button onClick={() => {
                        if (persistenceKey) localStorage.removeItem(persistenceKey); // Optional: clear on manual close? Or keep as draft? Keeping as draft is safer for accidental closes.
                        onClose();
                    }} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={24} className="text-gray-400" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 overflow-y-auto space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Name (Clinic) */}
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Nombre Clínica / Razón Social <span className="text-red-500">*</span></label>
                            <div className="relative group">
                                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => handleChange('name', e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                    placeholder="Ej. Clínica Dental Sonrisas"
                                />
                            </div>
                        </div>

                        {/* RUT */}
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">RUT Empresa <span className="text-red-500">*</span></label>
                            <div className="relative group">
                                <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                                <input
                                    type="text"
                                    required
                                    value={formData.rut}
                                    onChange={(e) => handleChange('rut', e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                    placeholder="Ej. 76.123.456-K"
                                />
                            </div>
                        </div>

                        {/* Giro */}
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Giro</label>
                            <input
                                type="text"
                                value={formData.giro}
                                onChange={(e) => handleChange('giro', e.target.value)}
                                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                placeholder="Ej. Servicios Odontológicos"
                            />
                        </div>

                        {/* Contact / Doctor */}
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Contacto de Compra (Dr/Encargado)</label>
                            <div className="relative group">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                                <input
                                    type="text"
                                    value={formData.purchase_contact}
                                    onChange={(e) => handleChange('purchase_contact', e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                    placeholder="Ej. Dr. Juan Pérez"
                                />
                            </div>
                        </div>

                        {/* Phone */}
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Teléfono <span className="text-red-500">*</span></label>
                            <div className="relative group">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                                <input
                                    type="tel"
                                    required
                                    value={formData.phone}
                                    onChange={(e) => handleChange('phone', e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                    placeholder="+56 9 ..."
                                />
                            </div>
                        </div>

                        {/* Email */}
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Email <span className="text-red-500">*</span></label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                                <input
                                    type="email"
                                    required
                                    value={formData.email}
                                    onChange={(e) => handleChange('email', e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                    placeholder="contacto@clinica.cl"
                                />
                            </div>
                        </div>

                        {/* Address (Google Maps) */}
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Dirección (Búsqueda GPS)</label>
                            <div className="relative group">
                                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-indigo-500 transition-colors" size={18} />
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={formData.address}
                                    onChange={(e) => handleChange('address', e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                    placeholder="Buscar dirección en Google Maps..."
                                />
                            </div>
                        </div>

                        {/* Comuna */}
                        <div className="space-y-2">
                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest pl-1">Comuna</label>
                            <input
                                type="text"
                                value={formData.comuna}
                                onChange={(e) => handleChange('comuna', e.target.value)}
                                className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl font-bold text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-200 outline-none transition-all placeholder:font-medium placeholder:text-gray-300"
                                placeholder="Ej. Providencia"
                            />
                        </div>

                    </div>
                </form>

                <div className="p-8 border-t border-gray-100 bg-gray-50/50 rounded-b-[2.5rem] flex items-center justify-end space-x-4">
                    <button
                        onClick={onClose}
                        className="px-6 py-4 rounded-xl font-black text-gray-500 hover:bg-gray-200 transition-all uppercase text-xs tracking-widest"
                        disabled={loading}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black shadow-lg shadow-indigo-200 active:scale-95 transition-all uppercase text-xs tracking-widest flex items-center"
                        disabled={loading}
                    >
                        {loading ? 'Guardando...' : 'Guardar y Continuar'} <CheckCircle2 size={16} className="ml-2" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClientFormModal;
