import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { MessageSquare, Plus, Save, Trash2, Upload, FileText, Link as LinkIcon, Eye, X } from 'lucide-react';
import { TEMPLATE_TAGS, renderSubject, renderTemplate } from '../utils/messageTemplates';

type Template = {
    id: string;
    name: string;
    channel: 'email' | 'whatsapp' | 'both';
    subject: string | null;
    body: string;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

type Attachment = {
    id: string;
    template_id: string;
    file_name: string;
    file_path: string;
    mime_type: string | null;
    size_bytes: number | null;
    created_at: string;
};

const LeadMessages = () => {
    const { effectiveRole } = useUser();
    const canManage = effectiveRole === 'admin' || effectiveRole === 'jefe';

    const [loading, setLoading] = useState(true);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [attachmentsByTemplate, setAttachmentsByTemplate] = useState<Record<string, Attachment[]>>({});
    const [activeFilter, setActiveFilter] = useState<'all' | 'email' | 'whatsapp' | 'both'>('all');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const subjectRef = useRef<HTMLInputElement | null>(null);
    const bodyRef = useRef<HTMLTextAreaElement | null>(null);
    const [previewFile, setPreviewFile] = useState<{ name: string; url: string; mimeType: string | null } | null>(null);

    const [draft, setDraft] = useState({
        name: '',
        channel: 'both' as 'email' | 'whatsapp' | 'both',
        subject: '',
        body: '',
        is_active: true
    });

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('lead_message_templates')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            const normalized = (data || []) as Template[];
            setTemplates(normalized);

            const templateIds = normalized.map((t) => t.id);
            if (templateIds.length > 0) {
                const { data: attachmentRows, error: attachmentsError } = await supabase
                    .from('lead_message_attachments')
                    .select('*')
                    .in('template_id', templateIds)
                    .order('created_at', { ascending: false });
                if (attachmentsError) throw attachmentsError;

                const map: Record<string, Attachment[]> = {};
                (attachmentRows || []).forEach((row: any) => {
                    if (!map[row.template_id]) map[row.template_id] = [];
                    map[row.template_id].push(row as Attachment);
                });
                setAttachmentsByTemplate(map);
            } else {
                setAttachmentsByTemplate({});
            }
        } catch (error: any) {
            alert(`Error cargando plantillas: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    const filteredTemplates = useMemo(() => {
        if (activeFilter === 'all') return templates;
        return templates.filter((t) => t.channel === activeFilter);
    }, [templates, activeFilter]);

    const selectedTemplate = useMemo(() => templates.find((t) => t.id === selectedTemplateId) || null, [templates, selectedTemplateId]);

    const handleSelectTemplate = (template: Template) => {
        setSelectedTemplateId(template.id);
        setDraft({
            name: template.name,
            channel: template.channel,
            subject: template.subject || '',
            body: template.body,
            is_active: template.is_active
        });
    };

    const handleNewTemplate = () => {
        setSelectedTemplateId(null);
        setDraft({ name: '', channel: 'both', subject: '', body: '', is_active: true });
    };

    const handleSaveTemplate = async () => {
        if (!canManage) return;
        if (!draft.name.trim() || !draft.body.trim()) {
            alert('Nombre y cuerpo son obligatorios.');
            return;
        }
        if ((draft.channel === 'email' || draft.channel === 'both') && !draft.subject.trim()) {
            alert('Asunto obligatorio para plantillas de email.');
            return;
        }

        setSaving(true);
        try {
            if (selectedTemplateId) {
                const { error } = await supabase
                    .from('lead_message_templates')
                    .update({
                        name: draft.name.trim(),
                        channel: draft.channel,
                        subject: draft.subject.trim() || null,
                        body: draft.body,
                        is_active: draft.is_active,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', selectedTemplateId);
                if (error) throw error;
            } else {
                const { data, error } = await supabase
                    .from('lead_message_templates')
                    .insert({
                        name: draft.name.trim(),
                        channel: draft.channel,
                        subject: draft.subject.trim() || null,
                        body: draft.body,
                        is_active: draft.is_active
                    })
                    .select('*')
                    .single();
                if (error) throw error;
                setSelectedTemplateId(data.id);
            }

            await fetchTemplates();
            alert('Plantilla guardada.');
        } catch (error: any) {
            alert(`Error guardando plantilla: ${error.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteTemplate = async () => {
        if (!canManage || !selectedTemplateId) return;
        if (!window.confirm('¿Eliminar esta plantilla y sus adjuntos?')) return;

        try {
            const files = attachmentsByTemplate[selectedTemplateId] || [];
            if (files.length > 0) {
                await supabase.storage.from('lead-assets').remove(files.map((f) => f.file_path));
            }
            const { error } = await supabase.from('lead_message_templates').delete().eq('id', selectedTemplateId);
            if (error) throw error;
            handleNewTemplate();
            await fetchTemplates();
        } catch (error: any) {
            alert(`Error eliminando plantilla: ${error.message}`);
        }
    };

    const handleUploadAttachment = async (file: File) => {
        if (!canManage || !selectedTemplateId) return;
        const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        const fileName = file.name.toLowerCase();
        const allowedExtension = fileName.endsWith('.pdf') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.png');
        if (!allowedMimeTypes.includes(file.type) && !allowedExtension) {
            alert('Solo se permiten archivos PDF, JPG, JPEG o PNG.');
            return;
        }
        setUploading(true);
        try {
            const sanitizedName = file.name.replace(/\s+/g, '_');
            const path = `${selectedTemplateId}/${Date.now()}_${sanitizedName}`;
            const { error: uploadError } = await supabase.storage.from('lead-assets').upload(path, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || 'application/octet-stream'
            });
            if (uploadError) throw uploadError;

            const { error: insertError } = await supabase.from('lead_message_attachments').insert({
                template_id: selectedTemplateId,
                file_name: file.name,
                file_path: path,
                mime_type: file.type || null,
                size_bytes: file.size
            });
            if (insertError) throw insertError;

            await fetchTemplates();
            alert('Adjunto cargado correctamente.');
        } catch (error: any) {
            alert(`Error subiendo adjunto: ${error.message}`);
        } finally {
            setUploading(false);
        }
    };

    const handleDeleteAttachment = async (attachment: Attachment) => {
        if (!canManage) return;
        if (!window.confirm(`Eliminar adjunto ${attachment.file_name}?`)) return;

        try {
            await supabase.storage.from('lead-assets').remove([attachment.file_path]);
            const { error } = await supabase.from('lead_message_attachments').delete().eq('id', attachment.id);
            if (error) throw error;
            await fetchTemplates();
        } catch (error: any) {
            alert(`Error eliminando adjunto: ${error.message}`);
        }
    };

    const getAttachmentUrl = async (path: string) => {
        const { data, error } = await supabase.storage.from('lead-assets').createSignedUrl(path, 60 * 60);
        if (error) throw error;
        return data.signedUrl;
    };

    const handlePreviewAttachment = async (attachment: Attachment) => {
        try {
            const url = await getAttachmentUrl(attachment.file_path);
            setPreviewFile({
                name: attachment.file_name,
                url,
                mimeType: attachment.mime_type
            });
        } catch (error: any) {
            alert(`No se pudo previsualizar adjunto: ${error.message}`);
        }
    };

    const insertTagInField = (field: 'subject' | 'body', tag: string) => {
        if (!canManage) return;
        const target = field === 'subject' ? subjectRef.current : bodyRef.current;
        if (!target) {
            setDraft((prev) => ({ ...prev, [field]: `${prev[field]}${tag}` }));
            return;
        }

        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        const currentValue = draft[field];
        const nextValue = `${currentValue.slice(0, start)}${tag}${currentValue.slice(end)}`;

        setDraft((prev) => ({ ...prev, [field]: nextValue }));
        setTimeout(() => {
            target.focus();
            const nextPos = start + tag.length;
            target.setSelectionRange(nextPos, nextPos);
        }, 0);
    };

    return (
        <>
            <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-gray-900 flex items-center"><MessageSquare className="mr-3 text-indigo-600" />Mensajes Predefinidos</h1>
                    <p className="text-gray-500 font-medium">Plantillas para Email y WhatsApp con catálogos y ofertas.</p>
                </div>
                <button onClick={handleNewTemplate} className="px-4 py-3 rounded-2xl bg-indigo-600 text-white font-black text-sm inline-flex items-center">
                    <Plus size={16} className="mr-2" /> Nueva plantilla
                </button>
            </div>

            <div className="flex gap-2">
                {(['all', 'email', 'whatsapp', 'both'] as const).map((filter) => (
                    <button key={filter} onClick={() => setActiveFilter(filter)} className={`px-3 py-2 rounded-xl text-xs font-black uppercase ${activeFilter === filter ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}>
                        {filter}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="space-y-3 lg:col-span-1">
                    {loading ? (
                        <div className="premium-card p-4">Cargando plantillas...</div>
                    ) : filteredTemplates.length === 0 ? (
                        <div className="premium-card p-4 text-sm text-gray-500">No hay plantillas para este filtro.</div>
                    ) : filteredTemplates.map((template) => (
                        <button
                            key={template.id}
                            onClick={() => handleSelectTemplate(template)}
                            className={`w-full text-left premium-card p-4 border ${selectedTemplateId === template.id ? 'border-indigo-400' : 'border-transparent'}`}
                        >
                            <p className="font-black text-gray-900">{template.name}</p>
                            <p className="text-xs font-bold text-gray-500 uppercase">{template.channel}</p>
                            <p className="text-[10px] text-gray-400 font-bold">{template.is_active ? 'Activa' : 'Inactiva'}</p>
                        </button>
                    ))}
                </div>

                <div className="premium-card p-5 lg:col-span-2 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                            value={draft.name}
                            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="Nombre plantilla"
                            className="w-full p-3 rounded-xl border border-gray-100 bg-gray-50 font-bold"
                            disabled={!canManage}
                        />
                        <select
                            value={draft.channel}
                            onChange={(e) => setDraft((prev) => ({ ...prev, channel: e.target.value as any }))}
                            className="w-full p-3 rounded-xl border border-gray-100 bg-gray-50 font-bold"
                            disabled={!canManage}
                        >
                            <option value="both">Ambos</option>
                            <option value="email">Email</option>
                            <option value="whatsapp">WhatsApp</option>
                        </select>
                    </div>

                    <input
                        ref={subjectRef}
                        value={draft.subject}
                        onChange={(e) => setDraft((prev) => ({ ...prev, subject: e.target.value }))}
                        placeholder="Asunto (email)"
                        className="w-full p-3 rounded-xl border border-gray-100 bg-gray-50 font-bold"
                        disabled={!canManage}
                    />

                    <textarea
                        ref={bodyRef}
                        value={draft.body}
                        onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))}
                        rows={8}
                        placeholder="Cuerpo del mensaje"
                        className="w-full p-3 rounded-xl border border-gray-100 bg-gray-50 font-medium"
                        disabled={!canManage}
                    />

                    <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-700">
                        <input
                            type="checkbox"
                            checked={draft.is_active}
                            onChange={(e) => setDraft((prev) => ({ ...prev, is_active: e.target.checked }))}
                            disabled={!canManage}
                        />
                        Activa
                    </label>

                    <div className="p-3 rounded-xl border border-indigo-100 bg-indigo-50">
                        <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-2">Tags disponibles</p>
                        <div className="flex flex-wrap gap-2">
                            {TEMPLATE_TAGS.map((tag) => (
                                <div key={tag} className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => insertTagInField('subject', tag)}
                                        disabled={!canManage}
                                        className="px-2 py-1 rounded-lg bg-white border border-indigo-100 text-[11px] font-bold text-indigo-700 disabled:opacity-40"
                                        title="Insertar en asunto"
                                    >
                                        {tag}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => insertTagInField('body', tag)}
                                        disabled={!canManage}
                                        className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-black uppercase disabled:opacity-40"
                                        title="Insertar en cuerpo"
                                    >
                                        + cuerpo
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">Preview</p>
                        <p className="text-xs font-black text-gray-800">Asunto: {renderSubject(draft.subject, { clinic_name: 'Clínica Demo', doctor_name: 'Dra. Pérez', seller_name: 'Vendedor Demo', company_name: import.meta.env.VITE_COMPANY_NAME || 'Megagen', client_phone: '+56912345678', client_email: 'demo@clinic.cl' }) || '(vacío)'}</p>
                        <p className="text-xs text-gray-700 whitespace-pre-wrap mt-2">{renderTemplate(draft.body, { clinic_name: 'Clínica Demo', doctor_name: 'Dra. Pérez', seller_name: 'Vendedor Demo', company_name: import.meta.env.VITE_COMPANY_NAME || 'Megagen', client_phone: '+56912345678', client_email: 'demo@clinic.cl' }) || '(vacío)'}</p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button onClick={handleSaveTemplate} disabled={!canManage || saving} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase inline-flex items-center disabled:opacity-50">
                            <Save size={14} className="mr-2" />{saving ? 'Guardando...' : 'Guardar plantilla'}
                        </button>
                        <button onClick={handleDeleteTemplate} disabled={!canManage || !selectedTemplateId} className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-black uppercase inline-flex items-center disabled:opacity-50">
                            <Trash2 size={14} className="mr-2" />Eliminar
                        </button>
                    </div>

                    <div className="pt-2 border-t border-gray-100 space-y-3">
                        <p className="text-xs font-black text-gray-800 uppercase tracking-wider">Adjuntos (catálogos/ofertas)</p>
                        {selectedTemplateId && canManage ? (
                            <label className="inline-flex items-center px-4 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black uppercase cursor-pointer">
                                <Upload size={14} className="mr-2" />
                                {uploading ? 'Subiendo...' : 'Subir PDF/JPG/PNG'}
                                <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,image/jpeg,image/png,application/pdf"
                                    className="hidden"
                                    disabled={uploading}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleUploadAttachment(file);
                                        e.currentTarget.value = '';
                                    }}
                                />
                            </label>
                        ) : canManage ? (
                            <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                                Guarda o selecciona una plantilla para cargar catálogos/promociones.
                            </p>
                        ) : null}

                        <div className="space-y-2">
                            {(selectedTemplateId ? (attachmentsByTemplate[selectedTemplateId] || []) : []).map((attachment) => (
                                <div key={attachment.id} className="flex items-center justify-between p-2 rounded-xl border border-gray-100 bg-gray-50">
                                    <div className="flex items-center min-w-0">
                                        <FileText size={14} className="mr-2 text-indigo-500" />
                                        <span className="text-xs font-bold text-gray-700 truncate">{attachment.file_name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 ml-2">
                                        <button
                                            onClick={() => handlePreviewAttachment(attachment)}
                                            className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:text-indigo-600"
                                            title="Previsualizar"
                                        >
                                            <Eye size={12} />
                                        </button>
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const url = await getAttachmentUrl(attachment.file_path);
                                                    window.open(url, '_blank');
                                                } catch (error: any) {
                                                    alert(`No se pudo abrir adjunto: ${error.message}`);
                                                }
                                            }}
                                            className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:text-indigo-600"
                                            title="Abrir en nueva pestaña"
                                        >
                                            <LinkIcon size={12} />
                                        </button>
                                        {canManage && (
                                            <button
                                                onClick={() => handleDeleteAttachment(attachment)}
                                                className="p-2 rounded-lg bg-white border border-gray-200 text-gray-600 hover:text-red-600"
                                                title="Eliminar"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {selectedTemplateId && (attachmentsByTemplate[selectedTemplateId] || []).length === 0 && (
                                <p className="text-xs text-gray-500 font-medium">Sin adjuntos para esta plantilla.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            </div>
            {previewFile && (
                <div className="fixed inset-0 z-[1200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                            <p className="font-black text-gray-900 truncate pr-4">{previewFile.name}</p>
                            <button
                                type="button"
                                onClick={() => setPreviewFile(null)}
                                className="p-2 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex-1 bg-gray-50">
                            {(previewFile.mimeType || '').includes('image') || /\.(jpg|jpeg|png)$/i.test(previewFile.name) ? (
                                <img src={previewFile.url} alt={previewFile.name} className="w-full h-full object-contain" />
                            ) : (
                                <iframe title={previewFile.name} src={previewFile.url} className="w-full h-full border-0" />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default LeadMessages;
