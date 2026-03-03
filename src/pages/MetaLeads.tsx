import { useEffect, useMemo, useState } from 'react';
import { Megaphone, UserCircle2, Mail, Phone, CalendarClock, CheckCircle2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

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
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean);
};

const MetaLeads = () => {
    const { profile } = useUser();
    const [loading, setLoading] = useState(true);
    const [claimingId, setClaimingId] = useState<string | null>(null);
    const [leads, setLeads] = useState<MetaLead[]>([]);

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

    const handleClaimLead = async (leadId: string) => {
        if (!profile?.id) return;
        const confirmed = window.confirm('Este lead quedará asignado a tu cartera. ¿Confirmas?');
        if (!confirmed) return;

        setClaimingId(leadId);
        try {
            const { data, error } = await supabase
                .from('clients')
                .update({ created_by: profile.id })
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
            alert('Lead reclamado correctamente.');
        } catch (error: any) {
            alert(`No se pudo reclamar lead: ${error.message || 'desconocido'}`);
        } finally {
            setClaimingId(null);
        }
    };

    const count = useMemo(() => leads.length, [leads]);

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
                <div className="inline-flex items-center px-4 py-2 rounded-xl bg-white border border-gray-100 text-sm font-black text-gray-700">
                    Disponibles: <span className="ml-2 text-indigo-600">{count}</span>
                </div>
            </div>

            {leads.length === 0 ? (
                <div className="premium-card p-8 text-center text-gray-500 font-bold">
                    No hay Meta Leads sin asignar por ahora.
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {leads.map((lead) => {
                        const notes = parseNotes(lead.notes);
                        return (
                            <div key={lead.id} className="premium-card p-5 border border-blue-100">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xl font-black text-gray-900">{lead.name}</p>
                                        <p className="text-sm font-bold text-gray-500 mt-1">{lead.purchase_contact || 'Sin contacto'}</p>
                                    </div>
                                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100">
                                        Meta Ads
                                    </span>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div className="text-xs font-bold text-gray-600 bg-gray-50 rounded-xl px-3 py-2 inline-flex items-center">
                                        <Mail size={13} className="mr-2 text-gray-400" />
                                        {lead.email || 'Sin correo'}
                                    </div>
                                    <div className="text-xs font-bold text-gray-600 bg-gray-50 rounded-xl px-3 py-2 inline-flex items-center">
                                        <Phone size={13} className="mr-2 text-gray-400" />
                                        {lead.phone || 'Sin celular'}
                                    </div>
                                </div>

                                <div className="mt-3 text-xs font-bold text-gray-500 inline-flex items-center">
                                    <CalendarClock size={13} className="mr-1.5 text-gray-400" />
                                    {new Date(lead.created_at).toLocaleString('es-CL')}
                                </div>

                                {notes.length > 0 && (
                                    <div className="mt-4 flex flex-wrap gap-1.5">
                                        {notes.slice(0, 8).map((item, idx) => (
                                            <span key={`${lead.id}-note-${idx}`} className="text-[11px] px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold">
                                                {item}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-5">
                                    <button
                                        type="button"
                                        onClick={() => handleClaimLead(lead.id)}
                                        disabled={claimingId === lead.id}
                                        className="w-full py-3 rounded-xl bg-indigo-600 text-white font-black text-xs uppercase tracking-wider hover:bg-indigo-700 disabled:bg-indigo-300 transition-all inline-flex items-center justify-center"
                                    >
                                        <CheckCircle2 size={14} className="mr-2" />
                                        {claimingId === lead.id ? 'Reclamando...' : 'Reclamar Lead'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default MetaLeads;
