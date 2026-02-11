import React, { useState, useEffect } from 'react';
import { Camera, X, Image as ImageIcon, Save, Trash2, MapPin } from 'lucide-react';
import { supabase } from '../services/supabase';

interface VisualEvidenceProps {
    visitId: string;
    clientName?: string;
    onClose: () => void;
}

interface PhotoEvidence {
    id?: string;
    visit_id: string;
    photo_url: string; // Base64 for now if no storage
    category: string;
    notes: string;
    created_at?: string;
}

const CATEGORIES = [
    { id: 'fachada', label: 'Fachada / Exterior', color: 'bg-blue-100 text-blue-700' },
    { id: 'vitrina', label: 'Vitrina / Exhibición', color: 'bg-purple-100 text-purple-700' },
    { id: 'stock', label: 'Stock / Inventario', color: 'bg-emerald-100 text-emerald-700' },
    { id: 'competencia', label: 'Actividad Competencia', color: 'bg-amber-100 text-amber-700' },
    { id: 'material_pop', label: 'Material POP', color: 'bg-pink-100 text-pink-700' },
    { id: 'otro', label: 'Otro', color: 'bg-gray-100 text-gray-700' }
];

const VisualEvidence: React.FC<VisualEvidenceProps> = ({ visitId, clientName, onClose }) => {
    const [photos, setPhotos] = useState<PhotoEvidence[]>([]);
    const [loading, setLoading] = useState(false);

    // Form State
    const [currentImage, setCurrentImage] = useState<string | null>(null);
    const [category, setCategory] = useState('fachada');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchPhotos();
    }, [visitId]);

    const fetchPhotos = async () => {
        setLoading(true);
        // We assume a table 'visit_photos' exists. If not, it will default to empty or error.
        const { data, error } = await supabase
            .from('visit_photos')
            .select('*')
            .eq('visit_id', visitId)
            .order('created_at', { ascending: false });

        if (!error && data) {
            setPhotos(data as PhotoEvidence[]);
        }
        setLoading(false);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Convert to Base64 for immediate preview and "poor man's storage" if no bucket
        const reader = new FileReader();
        reader.onloadend = () => {
            setCurrentImage(reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    const handleSave = async () => {
        if (!currentImage) return;

        setSaving(true);
        const newPhoto = {
            visit_id: visitId,
            photo_url: currentImage, // Storing Base64 directly in DB (TEXT column) for simplicity as requested
            category,
            notes
        };

        const { data, error } = await supabase
            .from('visit_photos')
            .insert(newPhoto)
            .select()
            .single();

        if (error) {
            alert('Error al guardar foto: ' + error.message + '\n\nNOTA: Si la tabla "visit_photos" no existe, pide al administrador crearla.');
        } else {
            setPhotos([data, ...photos]);
            // Reset form
            setCurrentImage(null);
            setNotes('');
            setCategory('fachada');
        }
        setSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('¿Borrar esta foto?')) return;
        const { error } = await supabase.from('visit_photos').delete().eq('id', id);
        if (!error) {
            setPhotos(photos.filter(p => p.id !== id));
        }
    };

    return (
        <div className="fixed inset-0 bg-white z-50 overflow-y-auto animate-in slide-in-from-bottom duration-300">
            {/* Header */}
            <div className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
                <div>
                    <h2 className="text-xl font-black text-gray-900 flex items-center">
                        <Camera className="mr-2 text-indigo-600" />
                        Evidencia Visual
                    </h2>
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest ">
                        {clientName || 'Cliente'}
                    </p>
                </div>
                <button onClick={onClose} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                    <X size={20} className="text-gray-600" />
                </button>
            </div>

            <div className="max-w-2xl mx-auto p-6 space-y-8">

                {/* Capture Section */}
                <div className="premium-card p-6 border-2 border-indigo-50 bg-indigo-50/10">
                    {!currentImage ? (
                        <label className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-indigo-300 rounded-2xl cursor-pointer hover:bg-indigo-50 transition-colors group">
                            <div className="p-4 bg-indigo-100 rounded-full text-indigo-600 mb-3 group-hover:scale-110 transition-transform">
                                <Camera size={32} />
                            </div>
                            <p className="font-bold text-indigo-900">Tomar Foto / Galería</p>
                            <p className="text-xs text-indigo-400 mt-1">Click para activar cámara</p>
                            <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                        </label>
                    ) : (
                        <div className="space-y-4">
                            <div className="relative rounded-2xl overflow-hidden shadow-lg border border-gray-200">
                                <img src={currentImage} alt="Preview" className="w-full h-64 object-cover" />
                                <button
                                    onClick={() => setCurrentImage(null)}
                                    className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full hover:bg-red-500 transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                {CATEGORIES.map(cat => (
                                    <button
                                        key={cat.id}
                                        onClick={() => setCategory(cat.id)}
                                        className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border-2 ${category === cat.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-transparent bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                    >
                                        {cat.label}
                                    </button>
                                ))}
                            </div>

                            <input
                                type="text"
                                placeholder="Nota breve (ej: Faltan precios)..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="w-full p-4 bg-white border border-gray-200 rounded-xl font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            />

                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black uppercase tracking-widest hover:bg-indigo-700 transition-all flex items-center justify-center shadow-lg active:scale-95 disabled:opacity-50"
                            >
                                {saving ? 'Guardando...' : (
                                    <>
                                        <Save size={18} className="mr-2" />
                                        Guardar Evidencia
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {/* Gallery List */}
                <div className="space-y-4">
                    <h3 className="text-lg font-black text-gray-900 flex items-center">
                        <ImageIcon className="mr-2 text-indigo-600" />
                        Galería de la Visita ({photos.length})
                    </h3>

                    {loading ? (
                        <p className="text-center text-gray-400 py-8">Cargando fotos...</p>
                    ) : photos.length === 0 ? (
                        <p className="text-center text-gray-400 py-8 italic bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                            No hay fotos registradas en esta visita.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {photos.map(photo => {
                                const cat = CATEGORIES.find(c => c.id === photo.category) || CATEGORIES[5];
                                return (
                                    <div key={photo.id} className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex gap-4">
                                        <div className="w-24 h-24 flex-shrink-0 bg-gray-100 rounded-xl overflow-hidden cursor-pointer" onClick={() => window.open(photo.photo_url, '_blank')}>
                                            <img src={photo.photo_url} alt="Evidence" className="w-full h-full object-cover hover:scale-110 transition-transform" />
                                        </div>
                                        <div className="flex-1 flex flex-col justify-between py-1">
                                            <div>
                                                <span className={`inline-block px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest mb-2 ${cat.color}`}>
                                                    {cat.label}
                                                </span>
                                                <p className="text-sm font-bold text-gray-800 line-clamp-2">
                                                    {photo.notes || "Sin notas"}
                                                </p>
                                            </div>
                                            <div className="flex items-center justify-between mt-2">
                                                <p className="text-[10px] text-gray-400 font-bold">
                                                    {new Date(photo.created_at!).toLocaleTimeString()}
                                                </p>
                                                <button
                                                    onClick={() => handleDelete(photo.id!)}
                                                    className="text-red-400 hover:text-red-600 p-1 hover:bg-red-50 rounded-lg transition-colors"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default VisualEvidence;
