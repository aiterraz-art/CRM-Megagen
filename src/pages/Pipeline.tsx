import React, { useState, useEffect, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { ShoppingBag } from 'lucide-react';

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
    seller_id?: string;
    seller_name?: string;
    total_amount: number;
    stage: string;
    status?: string | null;
    created_at: string;
    clients: any; // Supabase can return object or array depending on relationship setup
    folio: number;
}

const normalizeStage = (stage: string | null | undefined): string => {
    const value = (stage || '').toLowerCase().trim();
    if (!value || value === 'draft' || value === 'new') return 'new';
    if (value === 'contacted' || value === 'negotiation' || value === 'sent') return 'sent';
    if (value === 'won' || value === 'lost') return value;
    return 'new';
};

const stageFromStatus = (status: string | null | undefined): string => {
    const value = (status || '').toLowerCase().trim();
    if (!value || value === 'draft') return 'new';
    if (value === 'sent') return 'sent';
    if (value === 'approved') return 'won';
    if (value === 'rejected' || value === 'cancelled') return 'lost';
    return 'new';
};

const statusFromStage = (stage: string): string => {
    if (stage === 'new') return 'draft';
    if (stage === 'sent') return 'sent';
    if (stage === 'won') return 'approved';
    if (stage === 'lost') return 'rejected';
    return 'draft';
};

const Pipeline = () => {
    const { profile, effectiveRole } = useUser();
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [stats, setStats] = useState({ totalPipeline: 0, wonMonth: 0, openQuotes: 0 });
    const [supportsStageColumn, setSupportsStageColumn] = useState(true);
    const [sellerFilter, setSellerFilter] = useState<string>('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [minAmount, setMinAmount] = useState('');
    const canViewAllPipeline = effectiveRole === 'admin' || effectiveRole === 'jefe';

    useEffect(() => {
        fetchPipeline();
    }, [profile, effectiveRole]);

    const fetchPipeline = async () => {
        try {
            setLoading(true);
            setFetchError(null);
            let queryWithStage = supabase
                .from('quotations')
                .select(`
                    id, 
                    client_id, 
                    seller_id,
                    total_amount, 
                    stage, 
                    status,
                    created_at, 
                    folio,
                    clients (name)
                `);

            // Visibility rule: only admin/jefe can see all. Others see only their quotations.
            if (!canViewAllPipeline && profile?.id) {
                queryWithStage = queryWithStage.eq('seller_id', profile.id);
            }

            const primary = await queryWithStage.order('created_at', { ascending: false });
            let data: any[] | null = primary.data as any[] | null;
            let error: any = primary.error;
            let usingStage = true;

            if (error && String(error.message || '').toLowerCase().includes('column quotations.stage does not exist')) {
                let queryWithStatus = supabase
                    .from('quotations')
                    .select(`
                        id,
                        client_id,
                        seller_id,
                        total_amount,
                        status,
                        created_at,
                        folio,
                        clients (name)
                    `);
                if (!canViewAllPipeline && profile?.id) {
                    queryWithStatus = queryWithStatus.eq('seller_id', profile.id);
                }
                const retry = await queryWithStatus.order('created_at', { ascending: false });
                data = retry.data;
                error = retry.error;
                usingStage = false;
            }

            if (error) throw error;
            setSupportsStageColumn(usingStage);

            const sellerIds = Array.from(new Set(((data || []) as any[]).map((q) => q.seller_id).filter(Boolean)));
            let sellersById: Record<string, string> = {};
            if (sellerIds.length > 0) {
                const { data: sellerProfiles } = await supabase
                    .from('profiles')
                    .select('id, full_name, email')
                    .in('id', sellerIds as string[]);
                (sellerProfiles || []).forEach((s: any) => {
                    sellersById[s.id] = s.full_name || s.email || 'Vendedor';
                });
            }

            const normalizedQuotes = ((data || []) as any[]).map((q) => ({
                ...q,
                stage: usingStage ? normalizeStage(q.stage) : stageFromStatus(q.status),
                seller_name: q.seller_id ? sellersById[q.seller_id] || 'Vendedor' : 'Sin vendedor'
            }));
            setQuotations(normalizedQuotes as Quotation[]);

        } catch (error: any) {
            console.error('Error fetching pipeline:', error);
            setFetchError(error?.message || 'No se pudo cargar el embudo.');
        } finally {
            setLoading(false);
        }
    };

    const onDragEnd = async (result: DropResult) => {
        const { destination, source, draggableId } = result;

        if (!destination) return;
        if (destination.droppableId === source.droppableId) {
            return;
        }

        const newStage = normalizeStage(destination.droppableId);

        // Optimistic Update
        const previousQuotations = quotations;
        const updatedQuotations = quotations.map(q =>
            q.id === draggableId ? { ...q, stage: newStage } : q
        );
        setQuotations(updatedQuotations);

        // API Call
        const { error } = await supabase
            .from('quotations')
            .update(supportsStageColumn ? ({ stage: newStage } as any) : ({ status: statusFromStage(newStage) } as any))
            .eq('id', draggableId);

        if (error) {
            console.error('Error updating stage:', error);
            setQuotations(previousQuotations);
            alert('Error al actualizar etapa.');
            return;
        }
    };

    const quotesByStage = useMemo(() => {
        const minAmountNumber = Number(minAmount || 0);
        const filtered = quotations.filter((q) => {
            if (canViewAllPipeline && sellerFilter !== 'all' && q.seller_id !== sellerFilter) return false;
            if (dateFrom) {
                const from = new Date(`${dateFrom}T00:00:00`).getTime();
                if (new Date(q.created_at).getTime() < from) return false;
            }
            if (dateTo) {
                const to = new Date(`${dateTo}T23:59:59`).getTime();
                if (new Date(q.created_at).getTime() > to) return false;
            }
            if (minAmountNumber > 0 && Number(q.total_amount || 0) < minAmountNumber) return false;
            return true;
        });

        return STAGES.reduce((acc, stage) => {
            acc[stage.id] = filtered.filter((q) => normalizeStage(q.stage) === stage.id);
            return acc;
        }, {} as Record<string, Quotation[]>);
    }, [quotations, sellerFilter, dateFrom, dateTo, minAmount, canViewAllPipeline]);

    const sellerOptions = useMemo(() => {
        const map = new Map<string, string>();
        quotations.forEach((q) => {
            if (q.seller_id) map.set(q.seller_id, q.seller_name || 'Vendedor');
        });
        return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [quotations]);

    useEffect(() => {
        const filteredQuotes = Object.values(quotesByStage).flat();
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const openPipeline = filteredQuotes
            .filter((q) => q.stage !== 'won' && q.stage !== 'lost')
            .reduce((sum, q) => sum + Number(q.total_amount || 0), 0);
        const wonThisMonth = filteredQuotes
            .filter((q) => {
                if (q.stage !== 'won') return false;
                const createdAt = new Date(q.created_at);
                return createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear;
            })
            .reduce((sum, q) => sum + Number(q.total_amount || 0), 0);
        const openQuotes = filteredQuotes.filter((q) => q.stage !== 'won' && q.stage !== 'lost').length;
        setStats({ totalPipeline: openPipeline, wonMonth: wonThisMonth, openQuotes });
    }, [quotesByStage]);

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
                    <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-end">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Ganado Mes</span>
                        <span className="text-xl font-black text-emerald-600">{formatCurrency(stats.wonMonth)}</span>
                    </div>
                    <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-end">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Abiertas</span>
                        <span className="text-xl font-black text-gray-700">{stats.openQuotes}</span>
                    </div>
                </div>
            </div>

            {fetchError && (
                <div className="p-4 rounded-2xl border border-red-100 bg-red-50 text-red-700 text-sm font-medium">
                    {fetchError}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {canViewAllPipeline && (
                    <div className="bg-white border border-gray-100 rounded-2xl p-3">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vendedor</p>
                        <select
                            value={sellerFilter}
                            onChange={(e) => setSellerFilter(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm font-bold text-gray-700"
                        >
                            <option value="all">Todos</option>
                            {sellerOptions.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>
                )}
                <div className="bg-white border border-gray-100 rounded-2xl p-3">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Desde</p>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm font-bold text-gray-700"
                    />
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-3">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Hasta</p>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm font-bold text-gray-700"
                    />
                </div>
                <div className="bg-white border border-gray-100 rounded-2xl p-3">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Monto mínimo</p>
                    <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={minAmount}
                        onChange={(e) => setMinAmount(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm font-bold text-gray-700"
                    />
                </div>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-[calc(100vh-250px)] overflow-x-auto pb-4">
                    {STAGES.map(stage => {
                        const stageItems = quotesByStage[stage.id] || [];
                        const stageTotal = stageItems.reduce((sum, q) => sum + (q.total_amount || 0), 0);

                        return (
                            <div key={stage.id} className="flex flex-col h-full bg-gray-50/50 rounded-2xl border border-gray-100/50">
                                {/* Column Header */}
                                <div className={`p-3 rounded-t-2xl border-b ${stage.color} bg-white/50 backdrop-blur-sm sticky top-0 z-10`}>
                                    <div className="flex justify-between items-center mb-1">
                                        <h3 className="font-black text-gray-700 text-[12px] uppercase tracking-wide">{stage.title}</h3>
                                        <span className="bg-white px-2 py-0.5 rounded-md text-[10px] font-bold shadow-sm">{stageItems.length}</span>
                                    </div>
                                    <p className="text-right font-black text-gray-500 text-[11px]">{formatCurrency(stageTotal)}</p>
                                </div>

                                {/* Droppable Area */}
                                <Droppable droppableId={stage.id}>
                                    {(provided, snapshot) => (
                                        <div
                                            {...provided.droppableProps}
                                            ref={provided.innerRef}
                                            className={`flex-1 p-1.5 overflow-y-auto space-y-1.5 transition-colors ${snapshot.isDraggingOver ? 'bg-indigo-50/50' : ''}`}
                                        >
                                            {stageItems.map((quote, index) => (
                                                <Draggable key={quote.id} draggableId={quote.id} index={index}>
                                                    {(provided, snapshot) => (
                                                        <div
                                                            ref={provided.innerRef}
                                                            {...provided.draggableProps}
                                                            {...provided.dragHandleProps}
                                                            className={`bg-white p-2 rounded-md shadow-sm border border-gray-100 cursor-grab group hover:shadow-md transition-all will-change-transform ${snapshot.isDragging ? 'shadow-xl scale-[1.02]' : ''} ${snapshot.isDropAnimating ? 'transition-transform duration-150 ease-out' : ''}`}
                                                        >
                                                            <div className="flex justify-between items-start mb-0.5">
                                                                <span className="text-[8px] font-black text-gray-400">#{quote.folio}</span>
                                                                <span className="text-[8px] text-gray-400">{new Date(quote.created_at).toLocaleDateString()}</span>
                                                            </div>
                                                            <h4
                                                                className="font-bold text-[11px] text-gray-900 leading-tight mb-1 line-clamp-1"
                                                                title={Array.isArray(quote.clients) ? quote.clients[0]?.name : quote.clients?.name || 'Cliente Desconocido'}
                                                            >
                                                                {Array.isArray(quote.clients) ? quote.clients[0]?.name : quote.clients?.name || 'Cliente Desconocido'}
                                                            </h4>
                                                            <p className="text-[9px] text-gray-500 font-semibold mb-1 truncate" title={quote.seller_name || 'Sin vendedor'}>
                                                                Vendedor: {quote.seller_name || 'Sin vendedor'}
                                                            </p>
                                                            <div className="flex justify-between items-center pt-1 border-t border-gray-50">
                                                                <span className="font-black text-indigo-600 text-[11px]">
                                                                    {formatCurrency(quote.total_amount || 0)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </Draggable>
                                            ))}
                                            {stageItems.length === 0 && (
                                                <div className="text-center py-8 text-gray-400 text-xs font-bold uppercase tracking-widest">
                                                    Sin cotizaciones
                                                </div>
                                            )}
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
