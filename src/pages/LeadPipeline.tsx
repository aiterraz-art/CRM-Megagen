import { useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Target, Mail, UserCircle2, Pencil, Phone, MessageCircle, Map as MapIcon, KanbanSquare, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { sendGmailMessage } from '../utils/gmail';
import { isProspectStatus, normalizeProspectStatus } from '../utils/prospect';
import LeadHeatmap, { LeadMapItem } from '../components/LeadHeatmap';
import { normalizeChileanPhone, renderSubject, renderTemplate } from '../utils/messageTemplates';

type LeadClient = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    purchase_contact: string | null;
    status: string | null;
    lead_score: number | null;
    created_by: string | null;
    created_at: string;
    lat: number | null;
    lng: number | null;
};

type Stage = {
    id: 'prospect_new' | 'prospect_contacted' | 'prospect_evaluating';
    title: string;
    color: string;
};

type MessageTemplate = {
    id: string;
    name: string;
    channel: 'email' | 'whatsapp' | 'both';
    subject: string | null;
    body: string;
    is_active: boolean;
};

type TemplateAttachment = {
    id: string;
    template_id: string;
    file_name: string;
    file_path: string;
};

const STAGES: Stage[] = [
    { id: 'prospect_new', title: 'Lead Nuevo', color: 'bg-amber-50 border-amber-100' },
    { id: 'prospect_contacted', title: 'Contactado', color: 'bg-blue-50 border-blue-100' },
    { id: 'prospect_evaluating', title: 'En Evaluación', color: 'bg-indigo-50 border-indigo-100' }
];

const buildTemplateContext = (lead: LeadClient, sellerName: string) => ({
    clinic_name: lead.name,
    doctor_name: lead.purchase_contact || '',
    seller_name: sellerName,
    company_name: import.meta.env.VITE_COMPANY_NAME || 'Megagen',
    client_phone: lead.phone || '',
    client_email: lead.email || ''
});

const LeadPipeline = () => {
    const { profile, effectiveRole } = useUser();
    const [loading, setLoading] = useState(true);
    const [leads, setLeads] = useState<LeadClient[]>([]);
    const [profiles, setProfiles] = useState<Array<{ id: string; full_name: string | null; email: string | null }>>([]);
    const [sellerFilter, setSellerFilter] = useState<string>('all');
    const [sendingLeadId, setSendingLeadId] = useState<string | null>(null);
    const [editingEmailLeadId, setEditingEmailLeadId] = useState<string | null>(null);
    const [draftEmail, setDraftEmail] = useState('');
    const [savingEmailLeadId, setSavingEmailLeadId] = useState<string | null>(null);
    const [editingPhoneLeadId, setEditingPhoneLeadId] = useState<string | null>(null);
    const [draftPhone, setDraftPhone] = useState('');
    const [savingPhoneLeadId, setSavingPhoneLeadId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'kanban' | 'map'>('kanban');

    const [templates, setTemplates] = useState<MessageTemplate[]>([]);
    const [attachmentsByTemplate, setAttachmentsByTemplate] = useState<Record<string, TemplateAttachment[]>>({});
    const [selectedTemplateByLead, setSelectedTemplateByLead] = useState<Record<string, string>>({});
    const [previewOpenByLead, setPreviewOpenByLead] = useState<Record<string, boolean>>({});

    const canViewAll = effectiveRole === 'admin' || effectiveRole === 'jefe';

    const sellerName = useMemo(() => {
        return profile?.full_name || profile?.email?.split('@')[0] || 'Asesor Comercial';
    }, [profile?.full_name, profile?.email]);

    const fetchTemplates = async () => {
        const { data, error } = await supabase
            .from('lead_message_templates')
            .select('id, name, channel, subject, body, is_active')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const rows = (data || []) as MessageTemplate[];
        setTemplates(rows);

        const templateIds = rows.map((t) => t.id);
        if (templateIds.length === 0) {
            setAttachmentsByTemplate({});
            return;
        }

        const { data: attachmentRows, error: attError } = await supabase
            .from('lead_message_attachments')
            .select('id, template_id, file_name, file_path')
            .in('template_id', templateIds);

        if (attError) throw attError;

        const grouped: Record<string, TemplateAttachment[]> = {};
        (attachmentRows || []).forEach((row: any) => {
            if (!grouped[row.template_id]) grouped[row.template_id] = [];
            grouped[row.template_id].push(row as TemplateAttachment);
        });
        setAttachmentsByTemplate(grouped);
    };

    const getDefaultTemplateId = (lead: LeadClient) => {
        const preferred = templates.find((t) => t.channel === 'both')?.id
            || templates.find((t) => t.channel === 'email')?.id
            || templates[0]?.id;
        return preferred || '';
    };

    const fetchPipeline = async () => {
        if (!profile?.id) return;
        setLoading(true);
        try {
            let query = supabase
                .from('clients')
                .select('id, name, email, phone, purchase_contact, status, lead_score, created_by, created_at, lat, lng')
                .in('status', ['prospect', 'prospect_new', 'prospect_contacted', 'prospect_evaluating'])
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

            setSelectedTemplateByLead((prev) => {
                const next = { ...prev };
                normalized.forEach((lead) => {
                    if (!next[lead.id]) {
                        const selected = getDefaultTemplateId(lead);
                        if (selected) next[lead.id] = selected;
                    }
                });
                return next;
            });
        } catch (error: any) {
            console.error('Error loading lead pipeline:', error);
            alert(`Error cargando pipeline de leads: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates().catch((error) => {
            alert(`No se pudieron cargar plantillas de mensajes: ${error.message}`);
        });
    }, []);

    useEffect(() => {
        fetchPipeline();
    }, [profile?.id, sellerFilter]);

    useEffect(() => {
        if (templates.length === 0) return;
        setSelectedTemplateByLead((prev) => {
            const next = { ...prev };
            leads.forEach((lead) => {
                if (!next[lead.id]) {
                    const selected = getDefaultTemplateId(lead);
                    if (selected) next[lead.id] = selected;
                }
            });
            return next;
        });
    }, [templates, leads]);

    const leadsByStage = useMemo(() => {
        return STAGES.reduce((acc, stage) => {
            acc[stage.id] = leads.filter((lead) => normalizeProspectStatus(lead.status) === stage.id);
            return acc;
        }, {} as Record<Stage['id'], LeadClient[]>);
    }, [leads]);

    const templateById = useMemo(() => {
        const map: Record<string, MessageTemplate> = {};
        templates.forEach((template) => {
            map[template.id] = template;
        });
        return map;
    }, [templates]);

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

    const handleStartEmailEdit = (lead: LeadClient) => {
        setEditingEmailLeadId(lead.id);
        setDraftEmail(lead.email || '');
    };

    const handleSaveLeadEmail = async (leadId: string) => {
        const normalizedEmail = draftEmail.trim().toLowerCase();
        const isValid = /\S+@\S+\.\S+/.test(normalizedEmail);
        if (!isValid) {
            alert('Ingresa un correo válido para habilitar el envío del kit.');
            return;
        }

        try {
            setSavingEmailLeadId(leadId);
            const { error } = await supabase
                .from('clients')
                .update({ email: normalizedEmail })
                .eq('id', leadId);
            if (error) throw error;

            setLeads((prev) => prev.map((item) => item.id === leadId ? { ...item, email: normalizedEmail } : item));
            setEditingEmailLeadId(null);
            setDraftEmail('');
            alert('Correo del lead actualizado.');
        } catch (error: any) {
            alert(`No se pudo guardar el correo: ${error.message}`);
        } finally {
            setSavingEmailLeadId(null);
        }
    };

    const handleStartPhoneEdit = (lead: LeadClient) => {
        setEditingPhoneLeadId(lead.id);
        setDraftPhone(lead.phone || '');
    };

    const handleSaveLeadPhone = async (leadId: string) => {
        const normalizedPhone = normalizeChileanPhone(draftPhone.trim());
        if (!normalizedPhone) {
            alert('Ingresa un celular válido de Chile para habilitar WhatsApp.');
            return;
        }

        try {
            setSavingPhoneLeadId(leadId);
            const { error } = await supabase
                .from('clients')
                .update({ phone: normalizedPhone })
                .eq('id', leadId);
            if (error) throw error;

            setLeads((prev) => prev.map((item) => item.id === leadId ? { ...item, phone: normalizedPhone } : item));
            setEditingPhoneLeadId(null);
            setDraftPhone('');
            alert('Celular del lead actualizado.');
        } catch (error: any) {
            alert(`No se pudo guardar el celular: ${error.message}`);
        } finally {
            setSavingPhoneLeadId(null);
        }
    };

    const isTemplateCompatible = (template: MessageTemplate | undefined, requiredChannel: 'email' | 'whatsapp') => {
        if (!template) return false;
        return template.channel === 'both' || template.channel === requiredChannel;
    };

    const getSelectedTemplate = (leadId: string, requiredChannel: 'email' | 'whatsapp') => {
        const selectedId = selectedTemplateByLead[leadId];
        const selected = selectedId ? templateById[selectedId] : undefined;
        if (isTemplateCompatible(selected, requiredChannel)) return selected;
        return undefined;
    };

    const getRenderedTemplatePreview = (lead: LeadClient) => {
        const selectedId = selectedTemplateByLead[lead.id];
        if (!selectedId) return null;
        const template = templateById[selectedId];
        if (!template) return null;

        const context = buildTemplateContext(lead, sellerName);
        return {
            subject: renderSubject(template.subject || '', context),
            body: renderTemplate(template.body, context)
        };
    };

    const getSignedLinksForTemplate = async (templateId: string): Promise<string[]> => {
        const attachments = attachmentsByTemplate[templateId] || [];
        if (attachments.length === 0) return [];

        const urls = await Promise.all(
            attachments.map(async (attachment) => {
                const { data, error } = await supabase.storage.from('lead-assets').createSignedUrl(attachment.file_path, 60 * 60);
                if (error || !data?.signedUrl) return null;
                return `- ${attachment.file_name}: ${data.signedUrl}`;
            })
        );

        return urls.filter(Boolean) as string[];
    };

    const moveLeadToContacted = async (lead: LeadClient) => {
        const normalizedStatus = normalizeProspectStatus(lead.status);
        if (normalizedStatus === 'prospect_contacted' || normalizedStatus === 'prospect_evaluating') return;

        const { error } = await supabase
            .from('clients')
            .update({ status: 'prospect_contacted' })
            .eq('id', lead.id);

        if (error) throw error;

        setLeads((prev) => prev.map((item) => item.id === lead.id ? { ...item, status: 'prospect_contacted' } : item));
    };

    const logLeadMessage = async (params: {
        lead: LeadClient;
        templateId?: string;
        channel: 'email' | 'whatsapp';
        destination?: string | null;
        status: 'sent' | 'failed' | 'opened_external';
        errorMessage?: string | null;
    }) => {
        await supabase.from('lead_message_logs').insert({
            template_id: params.templateId || null,
            client_id: params.lead.id,
            user_id: profile?.id || null,
            channel: params.channel,
            destination: params.destination || null,
            status: params.status,
            error_message: params.errorMessage || null
        });
    };

    const handleSendEmail = async (lead: LeadClient) => {
        if (!lead.email) return;

        const template = getSelectedTemplate(lead.id, 'email');
        if (!template) {
            alert('No hay plantilla activa compatible con email.');
            return;
        }

        try {
            setSendingLeadId(lead.id);
            const context = buildTemplateContext(lead, sellerName);
            const subject = renderSubject(template.subject || 'Presentación Megagen Dental', context);
            const body = renderTemplate(template.body, context);
            const signedLinks = await getSignedLinksForTemplate(template.id);
            const composedMessage = signedLinks.length > 0
                ? `${body}\n\nAdjuntos (links temporales):\n${signedLinks.join('\n')}`
                : body;

            await sendGmailMessage({
                to: lead.email,
                subject,
                message: composedMessage,
                clientId: lead.id,
                profileId: profile?.id
            });

            try {
                await logLeadMessage({
                    lead,
                    templateId: template.id,
                    channel: 'email',
                    destination: lead.email,
                    status: 'sent'
                });
            } catch (logError) {
                console.error('No se pudo guardar log de envio email:', logError);
            }

            try {
                await moveLeadToContacted(lead);
                alert('Correo enviado correctamente al lead.');
            } catch (moveError: any) {
                alert(`Correo enviado, pero no se pudo actualizar etapa del lead: ${moveError.message}`);
            }
        } catch (error: any) {
            try {
                await logLeadMessage({
                    lead,
                    templateId: getSelectedTemplate(lead.id, 'email')?.id,
                    channel: 'email',
                    destination: lead.email,
                    status: 'failed',
                    errorMessage: error.message
                });
            } catch (logError) {
                console.error('No se pudo guardar log de error email:', logError);
            }
            alert(`No se pudo enviar el correo: ${error.message}`);
        } finally {
            setSendingLeadId(null);
        }
    };

    const handleSendWhatsApp = async (lead: LeadClient) => {
        const normalizedPhone = normalizeChileanPhone(lead.phone);
        if (!normalizedPhone) return;

        const template = getSelectedTemplate(lead.id, 'whatsapp');
        if (!template) {
            alert('No hay plantilla activa compatible con WhatsApp.');
            return;
        }

        try {
            const context = buildTemplateContext(lead, sellerName);
            const fallbackMessage = `Hola ${lead.purchase_contact || 'Doctor(a)'}, te escribo de ${import.meta.env.VITE_COMPANY_NAME || 'Megagen'} para continuar nuestro seguimiento.`;
            const message = renderTemplate(template.body, context) || fallbackMessage;
            const url = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
            window.open(url, '_blank', 'noopener,noreferrer');

            try {
                await logLeadMessage({
                    lead,
                    templateId: template.id,
                    channel: 'whatsapp',
                    destination: normalizedPhone,
                    status: 'opened_external'
                });
            } catch (logError) {
                console.error('No se pudo guardar log de envio whatsapp:', logError);
            }

            try {
                await moveLeadToContacted(lead);
            } catch (moveError) {
                console.error('No se pudo mover lead a Contactado tras WhatsApp:', moveError);
            }
        } catch (error: any) {
            try {
                await logLeadMessage({
                    lead,
                    templateId: getSelectedTemplate(lead.id, 'whatsapp')?.id,
                    channel: 'whatsapp',
                    destination: normalizedPhone,
                    status: 'failed',
                    errorMessage: error.message
                });
            } catch (logError) {
                console.error('No se pudo guardar log de error whatsapp:', logError);
            }
            alert(`No se pudo abrir WhatsApp: ${error.message}`);
        }
    };

    const handleCall = (lead: LeadClient) => {
        if (!lead.phone) {
            alert('Este lead no tiene teléfono registrado.');
            return;
        }
        window.open(`tel:${lead.phone}`, '_self');
    };

    const handleMapEmail = (item: LeadMapItem) => {
        const lead = leads.find((x) => x.id === item.id);
        if (!lead) return;
        handleSendEmail(lead);
    };

    const handleMapWhatsApp = (item: LeadMapItem) => {
        const lead = leads.find((x) => x.id === item.id);
        if (!lead) return;
        handleSendWhatsApp(lead);
    };

    const handleMapCall = (item: LeadMapItem) => {
        const lead = leads.find((x) => x.id === item.id);
        if (!lead) return;
        handleCall(lead);
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
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setViewMode('kanban')}
                        className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wide inline-flex items-center ${viewMode === 'kanban' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}
                    >
                        <KanbanSquare size={14} className="mr-1.5" /> Ver como Kanban
                    </button>
                    <button
                        onClick={() => setViewMode('map')}
                        className={`px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wide inline-flex items-center ${viewMode === 'map' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}
                    >
                        <MapIcon size={14} className="mr-1.5" /> Ver en Mapa
                    </button>
                </div>
            </div>

            {canViewAll && (
                <div className="bg-white border border-gray-100 rounded-2xl p-3 w-full md:w-80">
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

            {viewMode === 'map' ? (
                <LeadHeatmap
                    leads={leads}
                    onCall={handleMapCall}
                    onWhatsApp={handleMapWhatsApp}
                    onEmail={handleMapEmail}
                />
            ) : (
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
                                                {items.map((lead, index) => {
                                                    const selectedTemplateId = selectedTemplateByLead[lead.id];
                                                    const selectedTemplateRaw = selectedTemplateId ? templateById[selectedTemplateId] : undefined;
                                                    const selectedTemplate = getSelectedTemplate(lead.id, 'email');
                                                    const selectedWhatsAppTemplate = getSelectedTemplate(lead.id, 'whatsapp');
                                                    const validPhone = normalizeChileanPhone(lead.phone);

                                                    return (
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

                                                                        {templates.length > 0 && (
                                                                            <div className="space-y-2">
                                                                                <select
                                                                                    value={selectedTemplateByLead[lead.id] || ''}
                                                                                    onChange={(e) => setSelectedTemplateByLead((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                                                                                    className="w-full p-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-700"
                                                                                >
                                                                                    <option value="" disabled>Selecciona plantilla</option>
                                                                                {templates.map((template) => (
                                                                                    <option key={template.id} value={template.id}>
                                                                                        {template.name} ({template.channel})
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                                {selectedTemplateRaw && (
                                                                                    <div className="flex gap-1">
                                                                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${isTemplateCompatible(selectedTemplateRaw, 'email') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-400 border border-gray-200'}`}>
                                                                                            Email
                                                                                        </span>
                                                                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${isTemplateCompatible(selectedTemplateRaw, 'whatsapp') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-400 border border-gray-200'}`}>
                                                                                            WhatsApp
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setPreviewOpenByLead((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }))}
                                                                                    className="w-full p-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 text-[11px] font-black uppercase tracking-wide flex items-center justify-center hover:bg-gray-100"
                                                                                >
                                                                                    {previewOpenByLead[lead.id] ? <EyeOff size={12} className="mr-1.5" /> : <Eye size={12} className="mr-1.5" />}
                                                                                    {previewOpenByLead[lead.id] ? 'Ocultar Preview' : 'Ver Preview'}
                                                                                </button>
                                                                                {previewOpenByLead[lead.id] && (() => {
                                                                                    const preview = getRenderedTemplatePreview(lead);
                                                                                    return (
                                                                                        <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-2 space-y-1">
                                                                                            <p className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
                                                                                                Asunto: {preview?.subject || '(sin asunto)'}
                                                                                            </p>
                                                                                            <p className="text-[11px] text-gray-700 whitespace-pre-wrap">
                                                                                                {preview?.body || '(sin cuerpo)'}
                                                                                            </p>
                                                                                        </div>
                                                                                    );
                                                                                })()}
                                                                            </div>
                                                                        )}

                                                                        {!lead.email && (
                                                                            <p className="text-[11px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                                                                                Falta correo del cliente para enviar email.
                                                                            </p>
                                                                        )}
                                                                        {!validPhone && (
                                                                            <p className="text-[11px] font-black text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                                                                                Falta celular válido para WhatsApp.
                                                                            </p>
                                                                        )}

                                                                        {editingEmailLeadId === lead.id ? (
                                                                            <div className="space-y-2">
                                                                                <input
                                                                                    type="email"
                                                                                    value={draftEmail}
                                                                                    onChange={(e) => setDraftEmail(e.target.value)}
                                                                                    placeholder="cliente@clinica.cl"
                                                                                    className="w-full p-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-700"
                                                                                />
                                                                                <div className="grid grid-cols-2 gap-2">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => handleSaveLeadEmail(lead.id)}
                                                                                        disabled={savingEmailLeadId === lead.id}
                                                                                        className="p-2 rounded-lg bg-indigo-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-indigo-700"
                                                                                    >
                                                                                        {savingEmailLeadId === lead.id ? 'Guardando...' : 'Guardar Correo'}
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            setEditingEmailLeadId(null);
                                                                                            setDraftEmail('');
                                                                                        }}
                                                                                        className="p-2 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-black uppercase tracking-wide hover:bg-gray-200"
                                                                                    >
                                                                                        Cancelar
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleStartEmailEdit(lead)}
                                                                                className="w-full p-2 rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-700 text-[11px] font-black uppercase tracking-wide flex items-center justify-center hover:bg-indigo-100"
                                                                            >
                                                                                <Pencil size={12} className="mr-1.5" />
                                                                                Completar Correo
                                                                            </button>
                                                                        )}

                                                                        {editingPhoneLeadId === lead.id ? (
                                                                            <div className="space-y-2">
                                                                                <input
                                                                                    type="tel"
                                                                                    value={draftPhone}
                                                                                    onChange={(e) => setDraftPhone(e.target.value)}
                                                                                    placeholder="+56 9 1234 5678"
                                                                                    className="w-full p-3 rounded-xl border border-gray-200 text-sm font-bold text-gray-700"
                                                                                />
                                                                                <div className="grid grid-cols-2 gap-2">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => handleSaveLeadPhone(lead.id)}
                                                                                        disabled={savingPhoneLeadId === lead.id}
                                                                                        className="p-2 rounded-lg bg-emerald-600 text-white text-[11px] font-black uppercase tracking-wide hover:bg-emerald-700"
                                                                                    >
                                                                                        {savingPhoneLeadId === lead.id ? 'Guardando...' : 'Guardar Celular'}
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            setEditingPhoneLeadId(null);
                                                                                            setDraftPhone('');
                                                                                        }}
                                                                                        className="p-2 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-black uppercase tracking-wide hover:bg-gray-200"
                                                                                    >
                                                                                        Cancelar
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        ) : (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleStartPhoneEdit(lead)}
                                                                                className="w-full p-2 rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 text-[11px] font-black uppercase tracking-wide flex items-center justify-center hover:bg-emerald-100"
                                                                            >
                                                                                <Phone size={12} className="mr-1.5" />
                                                                                Completar Celular
                                                                            </button>
                                                                        )}

                                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                            <button
                                                                                disabled={!lead.email || !selectedTemplate || sendingLeadId === lead.id}
                                                                                onClick={() => handleSendEmail(lead)}
                                                                                className={`w-full p-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center ${!lead.email || !selectedTemplate
                                                                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                                                                                    }`}
                                                                                title={lead.email ? `Enviar email a ${lead.email}` : 'Sin correo'}
                                                                            >
                                                                                <Mail size={14} className="mr-2" />
                                                                                {sendingLeadId === lead.id ? 'Enviando...' : 'Enviar Email'}
                                                                            </button>

                                                                            <button
                                                                                disabled={!validPhone || !selectedWhatsAppTemplate}
                                                                                onClick={() => handleSendWhatsApp(lead)}
                                                                                className={`w-full p-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center ${!validPhone || !selectedWhatsAppTemplate
                                                                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                                    : 'bg-green-600 text-white hover:bg-green-700'
                                                                                    }`}
                                                                                title={validPhone ? `WhatsApp ${validPhone}` : 'Sin celular'}
                                                                            >
                                                                                <MessageCircle size={14} className="mr-2" />
                                                                                {validPhone ? 'WhatsApp' : 'Sin celular'}
                                                                            </button>
                                                                        </div>

                                                                        <button
                                                                            onClick={() => handleCall(lead)}
                                                                            disabled={!lead.phone}
                                                                            className={`w-full p-2 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all flex items-center justify-center ${lead.phone
                                                                                ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                                                : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                                                                                }`}
                                                                        >
                                                                            <Phone size={12} className="mr-1.5" /> Llamar
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    );
                                                })}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </div>
                            );
                        })}
                    </div>
                </DragDropContext>
            )}
        </div>
    );
};

export default LeadPipeline;
