import { useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, CheckCircle2, Upload, FileSpreadsheet } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import Papa from 'papaparse';

type MetaLead = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    purchase_contact: string | null;
    notes: string | null;
    created_at: string;
    status: string | null;
    created_by: string | null;
};

const parseNotes = (notes: string | null) => {
    if (!notes) return [];
    return notes
        .split(/\||\n|;/g)
        .map((x) => x.trim())
        .filter(Boolean);
};

const extractCampaignFromNotes = (notes: string | null) => {
    const parts = parseNotes(notes);
    const match = parts.find((part) => part.toLowerCase().startsWith('campaña:') || part.toLowerCase().startsWith('campana:'));
    return match ? match.split(':').slice(1).join(':').trim() : '';
};

const canReceiveAssignedLeads = (role: string | null | undefined) => {
    const normalized = (role || '').trim().toLowerCase();
    return normalized === 'seller' || normalized === 'jefe' || normalized === 'manager';
};

const isEnabledUser = (status: string | null | undefined) => {
    const normalized = (status || '').trim().toLowerCase();
    return normalized === '' || normalized === 'active';
};

const normalizeKey = (value: string) => value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const getField = (row: Record<string, any>, aliases: string[]) => {
    const normalizedAliases = aliases.map(normalizeKey);
    const entries = Object.entries(row || {});
    for (const [key, raw] of entries) {
        const normalizedKey = normalizeKey(key);
        const match = normalizedAliases.some((alias) =>
            normalizedKey === alias || normalizedKey.includes(alias) || alias.includes(normalizedKey)
        );
        if (!match) continue;
        const value = String(raw ?? '').trim();
        if (value) return value;
    }
    return '';
};

const normalizePhoneForStorage = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.startsWith('56')) return digits;
    if (digits.startsWith('9') && digits.length === 9) return `56${digits}`;
    return digits;
};

const MetaLeads = () => {
    const { profile, effectiveRole, hasPermission } = useUser();
    const [loading, setLoading] = useState(true);
    const [assigningId, setAssigningId] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [leads, setLeads] = useState<MetaLead[]>([]);
    const [sellers, setSellers] = useState<Array<{ id: string; full_name: string | null; email: string | null }>>([]);
    const [selectedSellerByLead, setSelectedSellerByLead] = useState<Record<string, string>>({});
    const csvInputRef = useRef<HTMLInputElement>(null);

    const canImport = effectiveRole === 'admin' || effectiveRole === 'jefe' || hasPermission('IMPORT_CLIENTS');

    const fetchMetaLeads = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('clients')
                .select('id, name, email, phone, purchase_contact, notes, created_at, status, created_by')
                .eq('status', 'prospect_new')
                .is('created_by', null)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setLeads((data || []) as MetaLead[]);
        } catch (error: any) {
            alert(`Error cargando Meta Leads: ${error.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMetaLeads();
    }, []);

    useEffect(() => {
        const fetchSellers = async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, email, role, status')
                .order('full_name', { ascending: true });
            if (error) {
                alert(`No se pudo cargar vendedores: ${error.message}`);
                return;
            }
            const assignable = (data || []).filter((p: any) => canReceiveAssignedLeads(p.role) && isEnabledUser(p.status));
            setSellers(assignable as any);
        };
        fetchSellers();
    }, []);

    useEffect(() => {
        if (sellers.length === 0) return;
        const defaultSellerId = sellers[0].id;
        setSelectedSellerByLead((prev) => {
            const next = { ...prev };
            leads.forEach((lead) => {
                if (!next[lead.id]) next[lead.id] = defaultSellerId;
            });
            return next;
        });
    }, [leads, sellers]);

    const handleAssignLead = async (leadId: string) => {
        if (!profile?.id) return;
        const selectedSellerId = selectedSellerByLead[leadId];
        if (!selectedSellerId) {
            alert('Selecciona un vendedor para asignar este lead.');
            return;
        }

        const sellerName = sellers.find((s) => s.id === selectedSellerId)?.full_name || 'vendedor';
        const confirmed = window.confirm(`Este lead quedará asignado a ${sellerName}. ¿Confirmas?`);
        if (!confirmed) return;

        setAssigningId(leadId);
        try {
            const { data, error } = await supabase
                .from('clients')
                .update({ created_by: selectedSellerId })
                .eq('id', leadId)
                .is('created_by', null)
                .select('id')
                .maybeSingle();

            if (error) throw error;
            if (!data?.id) {
                alert('Este lead ya fue reclamado por otro vendedor.');
                await fetchMetaLeads();
                return;
            }

            setLeads((prev) => prev.filter((lead) => lead.id !== leadId));
            alert('Lead asignado correctamente.');
        } catch (error: any) {
            alert(`No se pudo asignar lead: ${error.message || 'desconocido'}`);
        } finally {
            setAssigningId(null);
        }
    };

    const count = useMemo(() => leads.length, [leads]);

    const handleCsvPicked = (file?: File | null) => {
        if (!file || importing) return;
        if (!canImport) {
            alert('No tienes permisos para importar Meta Leads.');
            return;
        }
        if (!file.name.toLowerCase().endsWith('.csv')) {
            alert('Solo se permiten archivos CSV.');
            return;
        }

        setImporting(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (result) => {
                try {
                    const rows = (result.data || []) as Record<string, any>[];
                    if (!rows.length) {
                        alert('El archivo CSV está vacío o no tiene filas válidas.');
                        return;
                    }

                    const payload: any[] = [];
                    const errors: string[] = [];

                    rows.forEach((row, index) => {
                        const firstName = getField(row, ['first_name', 'nombre', 'first name']);
                        const lastName = getField(row, ['last_name', 'apellido', 'last name']);
                        const combinedName = `${firstName} ${lastName}`.trim();
                        const name = getField(row, ['full_name', 'nombre completo', 'nombre', 'name', 'contact_name', 'nombre y apellido']) || combinedName;
                        const email = getField(row, ['email', 'correo', 'correo electronico', 'mail', 'email address']);
                        const phoneRaw = getField(row, ['phone', 'telefono', 'teléfono', 'mobile_phone', 'phone number', 'phone_number', 'celular', 'telefono contacto', 'mobile']);
                        const campaign = getField(row, ['campaign_name', 'campaign', 'campana', 'campaña']);
                        const adName = getField(row, ['ad_name', 'ad', 'anuncio', 'nombre anuncio']);
                        const adset = getField(row, ['adset_name', 'adset', 'conjunto anuncios', 'ad set']);
                        const formName = getField(row, ['form_name', 'formulario', 'instant_form', 'nombre formulario']);
                        const phone = normalizePhoneForStorage(phoneRaw);

                        if (!name) {
                            errors.push(`Fila ${index + 2}: falta nombre`);
                            return;
                        }
                        if (!email && !phone) {
                            errors.push(`Fila ${index + 2}: falta email y teléfono`);
                            return;
                        }

                        const usedKeys = new Set<string>([
                            'full_name', 'nombre completo', 'nombre', 'name',
                            'email', 'correo', 'correo electronico', 'mail',
                            'phone', 'telefono', 'teléfono', 'mobile_phone', 'celular', 'telefono contacto',
                            'campaign_name', 'campaign', 'campana', 'campaña'
                        ].map(normalizeKey));

                        const extraTags = Object.entries(row || {})
                            .map(([k, v]) => ({ key: String(k), value: String(v ?? '').trim() }))
                            .filter((entry) => entry.value && !usedKeys.has(normalizeKey(entry.key)))
                            .map((entry) => `${entry.key}: ${entry.value}`);

                        const noteParts = ['Generado desde Meta Ads'];
                        if (campaign) noteParts.push(`Campaña: ${campaign}`);
                        if (adset) noteParts.push(`Adset: ${adset}`);
                        if (adName) noteParts.push(`Anuncio: ${adName}`);
                        if (formName) noteParts.push(`Formulario: ${formName}`);
                        noteParts.push(...extraTags);

                        payload.push({
                            id: crypto.randomUUID(),
                            name,
                            email: email || null,
                            phone: phone || null,
                            purchase_contact: name,
                            notes: noteParts.join(' | '),
                            status: 'prospect_new',
                            created_by: null
                        });
                    });

                    if (!payload.length) {
                        alert(`No se pudo importar ninguna fila.\n\nErrores: ${errors.slice(0, 8).join('\n')}`);
                        return;
                    }

                    let inserted = 0;
                    const chunkSize = 100;
                    for (let i = 0; i < payload.length; i += chunkSize) {
                        const chunk = payload.slice(i, i + chunkSize);
                        const { error } = await supabase.from('clients').insert(chunk);
                        if (error) throw error;
                        inserted += chunk.length;
                    }

                    await fetchMetaLeads();
                    const rejected = rows.length - inserted;
                    alert(`Importación Meta completada.\n\n✅ Importados: ${inserted}\n❌ Omitidos: ${rejected}\n${errors.length ? `\nDetalle (primeros):\n${errors.slice(0, 8).join('\n')}` : ''}`);
                } catch (error: any) {
                    alert(`Error importando Meta Leads: ${error.message || 'desconocido'}`);
                } finally {
                    setImporting(false);
                    if (csvInputRef.current) csvInputRef.current.value = '';
                }
            },
            error: (error) => {
                setImporting(false);
                if (csvInputRef.current) csvInputRef.current.value = '';
                alert(`No se pudo leer CSV: ${error.message}`);
            }
        });
    };

    if (loading) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-7xl mx-auto pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                        <Megaphone className="text-indigo-600" />
                        Meta Leads
                    </h1>
                    <p className="text-gray-500 font-medium mt-1">Leads entrantes desde campañas Meta Ads, sin asignar.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center px-4 py-2 rounded-xl bg-white border border-gray-100 text-sm font-black text-gray-700">
                        Disponibles: <span className="ml-2 text-indigo-600">{count}</span>
                    </div>
                    <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={(e) => handleCsvPicked(e.target.files?.[0])}
                    />
                    <button
                        type="button"
                        disabled={!canImport || importing}
                        onClick={() => csvInputRef.current?.click()}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider inline-flex items-center ${!canImport || importing ? 'bg-gray-100 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                        <Upload size={14} className="mr-1.5" />
                        {importing ? 'Importando...' : 'Importar CSV Meta'}
                    </button>
                </div>
            </div>

            <div className="premium-card p-4 border border-gray-100 bg-gray-50/70">
                <p className="text-[11px] font-black uppercase tracking-wider text-gray-600 inline-flex items-center">
                    <FileSpreadsheet size={13} className="mr-1.5" />
                    Carga histórica desde Meta
                </p>
                <p className="text-xs text-gray-500 mt-1">
                    Sube el CSV descargado de Meta Lead Ads. Se crearán como <span className="font-black">prospect_new</span> y <span className="font-black">sin asignar</span>.
                </p>
            </div>

            {leads.length === 0 ? (
                <div className="premium-card p-8 text-center text-gray-500 font-bold">
                    No hay Meta Leads sin asignar por ahora.
                </div>
            ) : (
                <div className="premium-card border border-gray-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-[1400px] w-full text-sm">
                            <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">#</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Fecha</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Nombre</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Contacto</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Email</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Teléfono</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Campaña</th>
                                    <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Respuestas Formulario</th>
                                    <th className="text-right px-4 py-3 text-[10px] uppercase tracking-widest font-black text-gray-500">Asignar Lead</th>
                                </tr>
                            </thead>
                            <tbody>
                                {leads.map((lead, idx) => (
                                    <tr key={lead.id} className="border-b border-gray-100 last:border-b-0 align-top">
                                        <td className="px-4 py-3 font-black text-gray-700">{idx + 1}</td>
                                        <td className="px-4 py-3 font-bold text-gray-500 whitespace-nowrap">{new Date(lead.created_at).toLocaleString('es-CL')}</td>
                                        <td className="px-4 py-3">
                                            <p className="font-black text-gray-900">{lead.name}</p>
                                            <span className="inline-flex mt-1 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
                                                Meta Ads
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-bold text-gray-700">{lead.purchase_contact || 'Sin contacto'}</td>
                                        <td className="px-4 py-3 font-bold text-gray-700">{lead.email || 'Sin correo'}</td>
                                        <td className="px-4 py-3 font-bold text-gray-700">{lead.phone || 'Sin celular'}</td>
                                        <td className="px-4 py-3 font-bold text-gray-700">{extractCampaignFromNotes(lead.notes) || 'Sin campaña'}</td>
                                        <td className="px-4 py-3 max-w-[450px]">
                                            <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">{lead.notes || 'Sin respuestas'}</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2 min-w-[360px]">
                                                <select
                                                    value={selectedSellerByLead[lead.id] || ''}
                                                    onChange={(e) => setSelectedSellerByLead((prev) => ({ ...prev, [lead.id]: e.target.value }))}
                                                    className="w-full max-w-[220px] px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-700"
                                                >
                                                    <option value="" disabled>Seleccionar asesor</option>
                                                    {sellers.map((seller) => (
                                                        <option key={seller.id} value={seller.id}>
                                                            {seller.full_name || seller.email || seller.id}
                                                        </option>
                                                    ))}
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={() => handleAssignLead(lead.id)}
                                                    disabled={assigningId === lead.id || !selectedSellerByLead[lead.id]}
                                                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-wider hover:bg-indigo-700 disabled:bg-indigo-300 transition-all inline-flex items-center justify-center whitespace-nowrap"
                                                >
                                                    <CheckCircle2 size={14} className="mr-1.5" />
                                                    {assigningId === lead.id ? 'Asignando...' : 'Asignar'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MetaLeads;
