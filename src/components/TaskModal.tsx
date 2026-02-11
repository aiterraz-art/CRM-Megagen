import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, AlertCircle, Search, User } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

interface TaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onTaskAdded: () => void;
    prefilledClientId?: string;
}

const TaskModal: React.FC<TaskModalProps> = ({ isOpen, onClose, onTaskAdded, prefilledClientId }) => {
    const { profile } = useUser();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [dueTime, setDueTime] = useState('09:00');
    const [priority, setPriority] = useState('medium');
    const [loading, setLoading] = useState(false);

    // Client Selection State
    const [clientSearch, setClientSearch] = useState('');
    const [clients, setClients] = useState<any[]>([]);
    const [selectedClient, setSelectedClient] = useState<any | null>(null);
    const [showClientResults, setShowClientResults] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Reset form
            setTitle('');
            setDescription('');
            setPriority('medium');
            setClientSearch('');
            setSelectedClient(null);

            // Default to tomorrow 9am if not set (or today?)
            const now = new Date();
            setDueDate(now.toISOString().split('T')[0]);
        }
    }, [isOpen]);

    // Search Clients
    useEffect(() => {
        const searchClients = async () => {
            if (clientSearch.length < 2) {
                setClients([]);
                return;
            }

            const { data } = await supabase
                .from('clients')
                .select('id, name, address')
                .ilike('name', `%${clientSearch}%`)
                .limit(5);

            setClients(data || []);
            setShowClientResults(true);
        };

        const timeoutId = setTimeout(searchClients, 300);
        return () => clearTimeout(timeoutId);
    }, [clientSearch]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile) return;

        // Validation: Mandatory Client
        const finalClientId = prefilledClientId || selectedClient?.id;
        if (!finalClientId) {
            alert('Por favor selecciona un cliente para la tarea.');
            return;
        }

        try {
            setLoading(true);

            // Combine date and time
            const combinedDate = new Date(`${dueDate}T${dueTime}`);

            const taskData = {
                user_id: profile.id,
                client_id: finalClientId,
                title,
                description,
                due_date: combinedDate.toISOString(),
                priority,
                status: 'pending'
            };

            console.log('Inserting Task:', taskData); // Debug

            const { error } = await supabase.from('tasks').insert(taskData);

            if (error) throw error;

            onTaskAdded();
            onClose();
        } catch (error: any) {
            console.error('Error creating task:', error);
            alert(`Error al guardar la tarea: ${error.message || JSON.stringify(error)}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-slide-up">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-black text-gray-900 text-lg flex items-center">
                        <Calendar className="mr-2 text-indigo-600" size={20} />
                        Nueva Tarea
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-black text-gray-700 uppercase tracking-widest mb-1">Título / Asunto</label>
                        <input
                            type="text"
                            required
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Ej: Llamar para coordinar visita"
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-bold focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                        />
                    </div>

                    {/* Client Selection (Mandatory) */}
                    {!prefilledClientId && (
                        <div className="relative">
                            <label className="block text-xs font-black text-gray-700 uppercase tracking-widest mb-1">Cliente *</label>
                            {selectedClient ? (
                                <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                                    <div className="flex items-center">
                                        <User size={16} className="text-indigo-600 mr-2" />
                                        <span className="font-bold text-indigo-900 text-sm">{selectedClient.name}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedClient(null)}
                                        className="text-indigo-400 hover:text-indigo-600"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ) : (
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={clientSearch}
                                        onChange={e => {
                                            setClientSearch(e.target.value);
                                            setShowClientResults(true);
                                        }}
                                        placeholder="Buscar cliente por nombre..."
                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pl-10 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                    />
                                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />

                                    {showClientResults && clients.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                                            {clients.map(client => (
                                                <div
                                                    key={client.id}
                                                    onClick={() => {
                                                        setSelectedClient(client);
                                                        setClientSearch('');
                                                        setShowClientResults(false);
                                                    }}
                                                    className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-0"
                                                >
                                                    <p className="font-bold text-gray-900 text-sm">{client.name}</p>
                                                    <p className="text-xs text-gray-400 truncate">{client.address}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-black text-gray-700 uppercase tracking-widest mb-1">Fecha</label>
                            <input
                                type="date"
                                required
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-black text-gray-700 uppercase tracking-widest mb-1">Hora</label>
                            <input
                                type="time"
                                required
                                value={dueTime}
                                onChange={e => setDueTime(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-black text-gray-700 uppercase tracking-widest mb-1">Prioridad</label>
                        <div className="flex space-x-2">
                            {['low', 'medium', 'high'].map(p => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPriority(p)}
                                    className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider border ${priority === p
                                        ? p === 'high' ? 'bg-red-50 border-red-200 text-red-600'
                                            : p === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-600'
                                                : 'bg-green-50 border-green-200 text-green-600'
                                        : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50'
                                        }`}
                                >
                                    {p === 'low' ? 'Baja' : p === 'medium' ? 'Media' : 'Alta'}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-black text-gray-700 uppercase tracking-widest mb-1">Notas (Opcional)</label>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            rows={3}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-indigo-600 text-white py-4 rounded-xl font-black text-sm uppercase tracking-widest hover:bg-indigo-700 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Guardando...' : 'Crear Tarea'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default TaskModal;
