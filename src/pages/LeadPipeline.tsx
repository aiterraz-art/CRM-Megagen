import { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Target, Mail, UserCircle2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { sendGmailMessage } from '../utils/gmail';
import { isProspectStatus, normalizeProspectStatus } from '../utils/prospect';

type LeadClient = {
    id: string;
    name: string;
    email: string | null;
    purchase_contact: string | null;
    status: string | null;
    lead_score: number | null;
    created_by: string | null;
    created_at: string;
};

type Stage = {
    id: 'prospect_new' | 'prospect_contacted' | 'prospect_evaluating';
    title: string;
    color: string;
};

const STAGES: Stage[] = [
    { id: 'prospect_new', title: 'Lead Nuevo', color: 'bg-amber-50 border-amber-100' },
    { id: 'prospect_contacted', title: 'Contactado', color: 'bg-blue-50 border-blue-100' },
    { id: 'prospect_evaluating', title: 'En Evaluación', color: 'bg-indigo-50 border-indigo-100' }
];

const LeadPipeline = () => {
    const { profile, effectiveRole } = useUser();
    const [loading, setLoading] = useState(true);
    const [leads, setLeads] = useState<LeadClient[]>([]);
    const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string | null; email: string | null }>>([]);
    const [sellerFilter, setSellerFilter] = useState<string>('all');
    const [sendingLeadId, setSendingLeadId] = useState<string | null>(null);

    const canViewAll = effectiveRole === 'admin' || effectiveRole === 'jefe';

    const fetchPipeline = async () => {
        if (!profile?.id) return;
        setLoading(true);
        try {
            let query = supabase
                .from('clients')
                .select('id, name, email, purchase_contact, status, lead_score, created_by, created_at')
                .or('status.eq.prospect,status.ilike.prospect_%')
                .order('created_at', { ascending: false });

            if (!canViewAll) {
                query = query.eq('created_by', profile.id);
            }

            if (canViewAll && sellerFilter !== 'all') {
                query = query.eq('created_by', sellerFilter);
            }

            const { data, error } = await query;
            if (error) throw error;

            const normalized = (data || [])
                .filter((lead) => isProspectStatus(lead.status))
                .map((lead) => ({ ...lead, status: normalizeProspectStatus(lead.status) } as LeadClient));

            setLeads(normalized);

            if (canViewAll) {
                const sellerIds = Array.from(new Set(normalized.map((x) => x.created_by).filter(Boolean))) as string[];
                if (sellerIds.length > 0) {
                    const { data: profileRows } = await supabase
                        .from('profiles')
                        .select('id, full_name, email')
                        .in('id', sellerIds);
                    setProfiles((profileRows || []) as any);
                }
            }
        } catch (error: any) {
            console.error('Error loading lead pipeline:', error);
            alert(`Error cargando pipeline de leads: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPipeline();
    }, [profile?.id, sellerFilter]);

    const leadsByStage = useMemo(() => {
        return STAGES.reduce((acc, stage) => {
            acc[stage.id] = leads.filter((lead) => normalizeProspectStatus(lead.status) === stage.id);
            return acc;
        }, {} as Record<Stage['id'], LeadClient[]>);
    }, [leads]);

    const onDragEnd = async (result: DropResult) => {
        const { destination, source, draggableId } = result;
        if (!destination || destination.droppableId === source.droppableId) return;

        const newStatus = destination.droppableId as Stage['id'];
        const previous = leads;
        setLeads((prev) => prev.map((lead) => lead.id === draggableId ? { ...lead, status: newStatus } : lead));

        const { error } = await supabase
            .from('clients')
            .update({ status: newStatus })
            .eq('id', draggableId);

        if (error) {
            setLeads(previous);
            alert(`No se pudo mover el lead: ${error.message}`);
        }
    };

    const getSellerName = (id: string | null) => {
        if (!id) return 'Sin asignar';
        const owner = profiles.find((p) => p.id === id);
        return owner?.full_name || owner?.email || 'Sin asignar';
    };

    const handleSendKit = async (lead: LeadClient) => {
        if (!lead.email) return;
        try {
            setSendingLeadId(lead.id);
            await sendGmailMessage({
                to: lead.email,
                subject: 'Presentación Megagen Dental',
                message: `Hola ${lead.purchase_contact || lead.name},\n\nGracias por tu tiempo. Te compartimos el kit de presentación corporativa de Megagen Dental para que puedas evaluar nuestras soluciones.\n\nQuedamos atentos a tus comentarios para coordinar una demostración.\n\nSaludos cordiales,\nEquipo Comercial Megagen`,
                clientId: lead.id,
                profileId: profile?.id
            });

            const { error } = await supabase
                .from('clients')
                .update({ status: 'prospect_contacted' })
                .eq('id', lead.id);

            if (error) throw error;
            setLeads((prev) => prev.map((item) => item.id === lead.id ? { ...item, status: 'prospect_contacted' } : item));
            alert('Kit enviado y lead movido a Contactado.');
        } catch (error: any) {
            alert(`No se pudo enviar el kit: ${error.message}`);
        } finally {
            setSendingLeadId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-[1700px] mx-auto pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tight flex items-center">
                        <Target className="mr-3 text-indigo-600" />
                        Pipeline de Leads
                    </h2>
                    <p className="text-gray-500 font-medium">Gestión de prospectos de visitas en frío</p>
                </div>
                {canViewAll && (
                    <div className="bg-white border border-gray-100 rounded-2xl p-3 min-w-64">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Vendedor</p>
                        <select
                            value={sellerFilter}
                            onChange={(e) => setSellerFilter(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-sm font-bold text-gray-700"
                        >
                            <option value="all">Todos</option>
                            {profiles.map((seller) => (
                                <option key={seller.id} value={seller.id}>{seller.full_name || seller.email}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[560px]">
                    {STAGES.map((stage) => {
                        const items = leadsByStage[stage.id] || [];
                        return (
                            <div key={stage.id} className={`rounded-2xl border ${stage.color} flex flex-col`}>
                                <div className="p-4 border-b border-white/60 bg-white/60 rounded-t-2xl">
                                    <div className="flex items-center justify-between">
                                        <h3 className="font-black text-gray-700 uppercase text-xs tracking-wider">{stage.title}</h3>
                                        <span className="text-xs font-black px-2 py-1 bg-white rounded-lg">{items.length}</span>
                                    </div>
                                </div>
                                <Droppable droppableId={stage.id}>
                                    {(provided) => (
                                        <div ref={provided.innerRef} {...provided.droppableProps} className="p-3 space-y-3 flex-1">
                                            {items.map((lead, index) => (
                                                <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                                    {(dragProvided) => (
                                                        <div
                                                            ref={dragProvided.innerRef}
                                                            {...dragProvided.draggableProps}
                                                            {...dragProvided.dragHandleProps}
                                                            className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm"
                                                        >
                                                            <div className="space-y-2">
                                                                <p className="font-black text-gray-900 leading-tight">{lead.name}</p>
                                                                <p className="text-xs text-gray-500 font-bold">{lead.purchase_contact || 'Sin doctor/contacto'}</p>
                                                                {canViewAll && (
                                                                    <div className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-lg">
                                                                        <UserCircle2 size={12} />
                                                                        {getSellerName(lead.created_by)}
                                                                    </div>
                                                                )}
                                                                <div className="text-[10px] font-black uppercase tracking-wider text-indigo-600">Score: {lead.lead_score || 'N/A'}</div>
                                                                <button
                                                                    disabled={!lead.email || sendingLeadId === lead.id}
                                                                    onClick={() => handleSendKit(lead)}
                                                                    className={`w-full p-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center ${!lead.email
                                                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                                                        }`}
                                                                    title={lead.email ? `Enviar kit a ${lead.email}` : 'Este lead no tiene correo registrado'}
                                                                >
                                                                    <Mail size={14} className="mr-2" />
                                                                    {sendingLeadId === lead.id ? 'Enviando...' : 'Enviar Kit Presentación Megagen'}
                                                                </button>
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

export default LeadPipeline;
