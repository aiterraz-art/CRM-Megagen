import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { ShoppingBag, DollarSign, Clock, AlertCircle } from 'lucide-react';

interface PipelineStage {
    id: string;
    title: string;
    color: string;
}

const STAGES: PipelineStage[] = [
    { id: 'new', title: 'Nueva / Borrador', color: 'bg-gray-100 border-gray-200' },
    { id: 'sent', title: 'Enviada / Negociación', color: 'bg-blue-50 border-blue-200' },
    { id: 'won', title: 'Cierre Ganado', color: 'bg-emerald-50 border-emerald-200' },
    { id: 'lost', title: 'Cierre Perdido', color: 'bg-red-50 border-red-200' }
];

interface Quotation {
    id: string;
    client_id: string;
    total_amount: number;
    stage: string;
    created_at: string;
    clients: any; // Supabase can return object or array depending on relationship setup
    folio: number;
}

const Pipeline = () => {
    const { profile, effectiveRole } = useUser();
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ totalPipeline: 0, wonMonth: 0 });

    useEffect(() => {
        fetchPipeline();
    }, [profile, effectiveRole]);

    const fetchPipeline = async () => {
        try {
            setLoading(true);
            let query = supabase
                .from('quotations')
                .select(`
                    id, 
                    client_id, 
                    total_amount, 
                    stage, 
                    created_at, 
                    folio,
                    clients (name)
                `);

            // FILTER: If seller, only show their own quotes
            if (effectiveRole === 'seller' && profile?.id) {
                query = query.eq('seller_id', profile.id);
            }

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;

            console.log('Pipeline Data:', data); // Debugging
            setQuotations(data as any[] || []); // Cast to avoid strict type mismatch if needed

            // Calculate stats
            const pipe = (data || []).reduce((sum, q) => sum + (q.total_amount || 0), 0);
            const won = (data || []).filter(q => q.stage === 'won').reduce((sum, q) => sum + (q.total_amount || 0), 0);
            setStats({ totalPipeline: pipe, wonMonth: won });

        } catch (error) {
            console.error('Error fetching pipeline:', error);
        } finally {
            setLoading(false);
        }
    };

    const onDragEnd = async (result: DropResult) => {
        const { destination, source, draggableId } = result;

        if (!destination) return;
        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        ) {
            return;
        }

        const newStage = destination.droppableId;

        // Optimistic Update
        const updatedQuotations = quotations.map(q =>
            q.id === draggableId ? { ...q, stage: newStage } : q
        );
        setQuotations(updatedQuotations);

        // API Call
        const { error } = await supabase
            .from('quotations')
            .update({ stage: newStage })
            .eq('id', draggableId);

        if (error) {
            console.error('Error updating stage:', error);
            alert('Error al actualizar etapa. Recargando...');
            fetchPipeline();
        }
    };

    const getQuotationsByStage = (stageId: string) => {
        return quotations.filter(q => (q.stage || 'new') === stageId); // Default to 'new' if null
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-CL', {
            style: 'currency',
            currency: 'CLP'
        }).format(amount);
    };

    if (loading) return (
        <div className="flex justify-center items-center h-[50vh]">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
        </div>
    );

    return (
        <div className="space-y-8 max-w-[1600px] mx-auto pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tight flex items-center">
                        <ShoppingBag className="mr-3 text-indigo-600" />
                        Embudo de Ventas
                    </h2>
                    <p className="text-gray-500 font-medium">Gestiona el ciclo de vida de tus cotizaciones</p>
                </div>

                <div className="flex space-x-4">
                    <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-end">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total en Pipeline</span>
                        <span className="text-xl font-black text-indigo-600">{formatCurrency(stats.totalPipeline)}</span>
                    </div>
                </div>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[calc(100vh-250px)] overflow-x-auto pb-4">
                    {STAGES.map(stage => {
                        const stageItems = getQuotationsByStage(stage.id);
                        const stageTotal = stageItems.reduce((sum, q) => sum + (q.total_amount || 0), 0);

                        return (
                            <div key={stage.id} className="flex flex-col h-full bg-gray-50/50 rounded-3xl border border-gray-100/50">
                                {/* Column Header */}
                                <div className={`p-4 rounded-t-3xl border-b ${stage.color} bg-white/50 backdrop-blur-sm sticky top-0 z-10`}>
                                    <div className="flex justify-between items-center mb-2">
                                        <h3 className="font-black text-gray-700 text-sm uppercase tracking-wide">{stage.title}</h3>
                                        <span className="bg-white px-2 py-1 rounded-lg text-xs font-bold shadow-sm">{stageItems.length}</span>
                                    </div>
                                    <p className="text-right font-black text-gray-500 text-xs">{formatCurrency(stageTotal)}</p>
                                </div>

                                {/* Droppable Area */}
                                <Droppable droppableId={stage.id}>
                                    {(provided, snapshot) => (
                                        <div
                                            {...provided.droppableProps}
                                            ref={provided.innerRef}
                                            className={`flex-1 p-3 overflow-y-auto space-y-3 transition-colors ${snapshot.isDraggingOver ? 'bg-indigo-50/50' : ''}`}
                                        >
                                            {stageItems.map((quote, index) => (
                                                <Draggable key={quote.id} draggableId={quote.id} index={index}>
                                                    {(provided, snapshot) => (
                                                        <div
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            {...provided.dragHandleProps}
                                                            className={`bg-white p-4 rounded-xl shadow-sm border border-gray-100 cursor-grab group hover:shadow-md transition-all ${snapshot.isDragging ? 'shadow-xl rotate-2 scale-105' : ''}`}
                                                        >
                                                            <div className="flex justify-between items-start mb-2">
                                                                <span className="text-[10px] font-black text-gray-400">#{quote.folio}</span>
                                                                <span className="text-[10px] text-gray-400">{new Date(quote.created_at).toLocaleDateString()}</span>
                                                            </div>
                                                            <h4
                                                                className="font-bold text-gray-900 leading-tight mb-2 line-clamp-2"
                                                                title={Array.isArray(quote.clients) ? quote.clients[0]?.name : quote.clients?.name || 'Cliente Desconocido'}
                                                            >
                                                                {Array.isArray(quote.clients) ? quote.clients[0]?.name : quote.clients?.name || 'Cliente Desconocido'}
                                                            </h4>
                                                            <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                                                                <span className="font-black text-indigo-600 text-sm">
                                                                    {formatCurrency(quote.total_amount || 0)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </Draggable>
                                            ))}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        );
                    })}
                </div>
            </DragDropContext>
        </div>
    );
};

export default Pipeline;
