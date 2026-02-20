import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShoppingBag, Plus, Search, FileText, ChevronRight, Clock, CheckCircle2, AlertCircle, Eye, Printer, X as XIcon, User, MapPin, Navigation, Trash2, Edit2, MessageSquare, Phone } from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import QuotationTemplate from '../components/QuotationTemplate';
import { useVisit } from '../contexts/VisitContext';
import { checkGPSConnection } from '../utils/gps';

interface Quotation {
    id: string;
    client_id: string;
    client_name?: string;
    total_amount: number;
    status: 'draft' | 'sent' | 'approved' | 'rejected';
    created_at: string;
    seller_id: string;
}

const Quotations: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [quotations, setQuotations] = useState<any[]>([]);
    const [activeFilter, setActiveFilter] = useState('All');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [selectedForTemplate, setSelectedForTemplate] = useState<any>(null);
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [isItemModalOpen, setIsItemModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<any | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [availableClients, setAvailableClients] = useState<any[]>([]);
    const [clientSearch, setClientSearch] = useState('');
    const [selectedLocation, setSelectedLocation] = useState<any>(null); // For View Location Modal
    const [manualLocation, setManualLocation] = useState<{ lat: number; lng: number } | null>(null); // For Custom Picker
    const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
    const [editingQuotation, setEditingQuotation] = useState<any | null>(null);
    const [isInteractionModalOpen, setIsInteractionModalOpen] = useState(false);
    const [selectedInteractionType, setSelectedInteractionType] = useState<'Presencial' | 'WhatsApp' | 'Teléfono'>('Presencial');

    // Form State
    const [formItems, setFormItems] = useState<any[]>([{ code: '', detail: '', qty: 1, price: 0 }]);
    const [formComments, setFormComments] = useState('');
    const [paymentTerms, setPaymentTerms] = useState<{ type: 'Contado' | 'Crédito', days: number }>({ type: 'Contado', days: 0 });

    // Inventory & Autocomplete
    const [products, setProducts] = useState<any[]>([]);
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [activeSuggestion, setActiveSuggestion] = useState<{ index: number, field: 'code' | 'detail' } | null>(null);

    const { profile, isSupervisor, hasPermission, permissions } = useUser();
    const { activeVisit } = useVisit();

    const fetchQuotations = async () => {
        setLoading(true);

        try {
            const canViewAll = hasPermission('VIEW_ALL_CLIENTS') || isSupervisor || profile?.email === (import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl');

            let query = supabase
                .from('quotations')
                .select(`
                    *,
                    clients (name, rut, address, zone, purchase_contact, status, phone, email, giro, comuna)
                `);

            if (!canViewAll && profile?.id) {
                query = query.eq('seller_id', profile.id);
            }

            const { data: quotesData, error: quotesError } = await query.order('created_at', { ascending: false });

            if (quotesError) {
                console.error("Error fetching quotations:", quotesError);
            } else if (quotesData) {
                // Manual Fetch for Auxiliary Data to avoid Join issues
                const sellerIds = Array.from(new Set(quotesData.map((q: any) => q.seller_id).filter(Boolean)));
                const quotationIds = quotesData.map((q: any) => q.id);

                let profilesMap: Record<string, any> = {};
                let locationsMap: Record<string, any> = {};

                // Parallel fetches
                const promises = [];

                if (sellerIds.length > 0) {
                    promises.push(
                        supabase
                            .from('profiles')
                            .select('id, email, full_name')
                            .in('id', sellerIds)
                            .then(({ data }) => {
                                if (data) data.forEach(p => profilesMap[p.id] = p);
                            })
                    );
                }

                if (quotationIds.length > 0) {
                    promises.push(
                        supabase
                            .from('seller_locations')
                            .select('quotation_id, lat, lng')
                            .in('quotation_id', quotationIds)
                            .then(({ data }) => {
                                if (data) data.forEach(l => locationsMap[l.quotation_id] = l);
                            })
                    );
                }

                await Promise.all(promises);

                const formattedData = quotesData.map((q: any) => {
                    const sellerProfile = profilesMap[q.seller_id];
                    const loc = locationsMap[q.id];
                    // Handle both object and array join formats
                    const client = Array.isArray(q.clients) ? q.clients[0] : q.clients;

                    return {
                        ...q,
                        client: client,
                        seller: sellerProfile,
                        client_name: client?.name || 'Unknown Client',
                        client_address: client?.address || client?.comuna || 'Sin Dirección',
                        client_phone: client?.phone || 'Sin Teléfono',
                        client_email: client?.email || 'Sin Correo',
                        client_contact: client?.purchase_contact || 'Sin Nombre de Contacto',
                        client_giro: client?.giro || '',
                        client_comuna: client?.comuna || '',
                        seller_email: sellerProfile?.email || 'N/A',
                        seller_name: sellerProfile?.full_name || sellerProfile?.email?.split('@')[0].toUpperCase() || 'Vendedor',
                        location: loc || null,
                        items: typeof q.items === 'string' ? (() => { try { return JSON.parse(q.items) } catch { return [] } })() : (q.items || [])
                    };
                });

                setQuotations(formattedData);
            }
        } catch (error: any) {
            console.error("Error fetching quotations:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchProducts = async () => {
        const { data } = await supabase.from('inventory').select('*').order('name');
        if (data) setProducts(data);
    };

    useEffect(() => {
        fetchQuotations();
        const fetchClients = async () => {
            const canViewAll = hasPermission('VIEW_ALL_CLIENTS') || profile?.email === (import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl');

            let query = supabase.from('clients').select('*').order('name');

            if (!canViewAll && profile?.id) {
                query = query.eq('created_by', profile.id);
            }

            const { data } = await query;
            if (data) setAvailableClients(data);
        };
        fetchClients();
        fetchProducts();
    }, [profile, permissions]); // Added permissions to ensure re-fetch when perms load

    // Persist Draft Logic
    useEffect(() => {
        // Load draft on mount
        const savedDraft = localStorage.getItem('quotation_draft');
        if (savedDraft) {
            try {
                const draft = JSON.parse(savedDraft);
                if (draft.isOpen && !selectedClient && !editingQuotation) {
                    setIsItemModalOpen(true);
                    setSelectedClient(draft.client);
                    setFormItems(draft.items);
                    setFormComments(draft.comments);
                    setPaymentTerms(draft.paymentTerms);
                }
            } catch (e) {
                console.error("Failed to load draft", e);
            }
        }
    }, []);

    useEffect(() => {
        // Save draft on change (only if open and not editing an existing one)
        if (isItemModalOpen && selectedClient && !editingQuotation) {
            const draft = {
                isOpen: true,
                client: selectedClient,
                items: formItems,
                comments: formComments,
                paymentTerms: paymentTerms
            };
            localStorage.setItem('quotation_draft', JSON.stringify(draft));
        } else if (!isItemModalOpen && !editingQuotation) {
            // Clear draft if closed and not editing
            localStorage.removeItem('quotation_draft');
        }
    }, [isItemModalOpen, selectedClient, formItems, formComments, paymentTerms, editingQuotation]);

    const handleClientSelect = (client: any) => {
        setSelectedClient(client);
        setIsClientModalOpen(false);
        setIsItemModalOpen(true);
        // Reset form
        setFormItems([{ code: '', detail: '', qty: 1, price: 0 }]);
        setFormItems([{ code: '', detail: '', qty: 1, price: 0 }]);
        setFormComments('');
        setPaymentTerms({ type: 'Contado', days: 0 }); // Reset defaults
        setManualLocation(null);
        setEditingQuotation(null); // Ensure we are NOT in edit mode
    };

    const handleEditQuotation = (q: any) => {
        setEditingQuotation(q);
        setSelectedClient(q.client);
        setFormItems(q.items || []);
        setFormItems(q.items || []);
        setFormComments(q.comments || '');
        setPaymentTerms(typeof q.payment_terms === 'object' ? q.payment_terms : { type: 'Contado', days: 0 }); // Load payment terms
        setIsItemModalOpen(true);
    };

    const handleDeleteQuotation = async (id: string) => {
        if (!confirm('¿Está seguro de que desea eliminar esta cotización?')) return;

        setIsDeleting(id);
        try {
            const { error } = await supabase
                .from('quotations')
                .delete()
                .eq('id', id);

            if (error) throw error;
            fetchQuotations();
        } catch (err: any) {
            console.error('Delete error:', err);
            alert('Error al eliminar: ' + err.message);
        } finally {
            setIsDeleting(null);
        }
    };



    // Handle Auto-Open from Clients Page
    useEffect(() => {
        if (location.state?.client) {
            handleClientSelect(location.state.client);
            // Clear state so it doesn't reopen on refresh/navigation
            navigate(location.pathname, { replace: true, state: {} });
        }
    }, [location]);

    useEffect(() => {
        if (isInteractionModalOpen) {
            if (activeVisit) {
                setSelectedInteractionType('Presencial');
            } else {
                setSelectedInteractionType('WhatsApp');
            }
        }
    }, [isInteractionModalOpen, activeVisit]);

    const handleCreateQuotation = async () => {
        if (!profile || !selectedClient) return;

        setSubmitting(true);
        setIsItemModalOpen(false);

        try {
            // ... geolocation ...
            // ... geolocation ...
            let latitude = 0;
            let longitude = 0;

            if (manualLocation) {
                latitude = manualLocation.lat;
                longitude = manualLocation.lng;
                console.log("Using Manual Location:", manualLocation);
            } else {
                // Strict GPS Check
                const position = await checkGPSConnection();
                latitude = position.coords.latitude;
                longitude = position.coords.longitude;
            }

            // Final safety check
            if (!latitude || !longitude) {
                throw new Error("La ubicación es obligatoria para crear una cotización. Por favor activa el GPS.");
            }

            // ... calculations ...
            const calculatedItems = formItems.map(item => {
                const qty = parseInt(item.qty) || 1;
                const price = parseFloat(item.price) || 0;
                return { ...item, qty, price, unit: 'UN', discount: 0, total: qty * price };
            });
            const netAmount = calculatedItems.reduce((sum, item) => sum + item.total, 0);
            const tax = Math.round(netAmount * 0.19);
            const grandTotal = netAmount + tax;

            // 3. Direct Insert (Bypassing RPC to ensure items are saved)
            if (editingQuotation) {
                const { error: updateError } = await supabase
                    .from('quotations')
                    .update({
                        items: calculatedItems,
                        total_amount: grandTotal,
                        comments: formComments,
                    })
                    .eq('id', editingQuotation.id);

                if (updateError) throw updateError;
                alert('Cotización actualizada correctamente');
            } else {
                const { data: maxFolioData } = await supabase
                    .from('quotations')
                    .select('folio')
                    .order('folio', { ascending: false })
                    .limit(1)
                    .single();

                const nextFolio = (maxFolioData?.folio || 1000) + 1;

                const { data: insertData, error: insertError } = await supabase
                    .from('quotations')
                    .insert({
                        id: crypto.randomUUID(),
                        client_id: selectedClient.id,
                        seller_id: profile.id,
                        items: calculatedItems,
                        total_amount: grandTotal,
                        payment_terms: paymentTerms,
                        status: 'draft',
                        folio: nextFolio,
                        comments: formComments,
                        interaction_type: selectedInteractionType,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (insertError) throw insertError;

                if (latitude && longitude && insertData) {
                    await supabase.from('seller_locations').insert({
                        seller_id: profile.id,
                        quotation_id: insertData.id,
                        lat: latitude,
                        lng: longitude
                    });
                }
                alert(`Cotización #${nextFolio} creada con éxito!`);
            }

            // Reset and refresh
            setIsItemModalOpen(false);
            setFormItems([{ code: '', detail: '', qty: 1, price: 0 }]);
            setFormItems([{ code: '', detail: '', qty: 1, price: 0 }]);
            setFormComments('');
            setPaymentTerms({ type: 'Contado', days: 0 });
            setSelectedClient(null);
            setCreateError(null);
            setEditingQuotation(null);
            setEditingQuotation(null);
            localStorage.removeItem('quotation_draft'); // Clear draft
            fetchQuotations();

        } catch (error: any) {
            console.error('Error creating quotation:', error);
            const errorMsg = `Error: ${error.message} (${error.code || ''})`;
            setCreateError(errorMsg);
            alert(errorMsg);
        } finally {
            setSubmitting(false);
            setIsInteractionModalOpen(false);
        }
    };
    const handleConvertToOrder = async (quotation: any) => {
        if (!confirm('¿Confirmar que el cliente aceptó esta cotización? Se generará una Venta y se actualizarán las metas.')) return;

        setSubmitting(true);
        try {
            // CALL THE NEW ATOMIC RPC FUNCTION
            const { data, error } = await supabase.rpc('convert_quotation_to_order', {
                p_quotation_id: quotation.id,
                p_user_id: quotation.seller_id
            });

            if (error) throw error;

            alert('¡Venta generada exitosamente! Stock actualizado y meta ajustada.');
            fetchQuotations();

        } catch (error: any) {
            console.error('Error converting to order:', error);
            alert('Error al generar la venta: ' + (error.message || error.details || error));
        } finally {
            setSubmitting(false);
        }
    };


    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'approved': return <CheckCircle2 className="text-green-500" size={16} />;
            case 'sent': return <Clock className="text-blue-500" size={16} />;
            case 'draft': return <FileText className="text-gray-400" size={16} />;
            default: return <AlertCircle className="text-red-500" size={16} />;
        }
    };

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'approved': return 'bg-green-50 text-green-700 border-green-100';
            case 'sent': return 'bg-blue-50 text-blue-700 border-blue-100';
            case 'draft': return 'bg-gray-50 text-gray-700 border-gray-100';
            default: return 'bg-red-50 text-red-700 border-red-100';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'approved': return 'Aprobada';
            case 'sent': return 'Enviada';
            case 'draft': return 'Borrador';
            default: return 'Rechazada';
        }
    };

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight">Cotizaciones</h2>
                    <p className="text-gray-400 font-medium mt-1 text-lg">Administra y sigue tus propuestas comerciales</p>
                </div>
                <button
                    onClick={() => setIsClientModalOpen(true)}
                    disabled={submitting}
                    className="bg-side-gradient text-white px-8 py-4 rounded-[2rem] font-bold flex items-center shadow-xl shadow-indigo-100 active:scale-95 transition-all disabled:opacity-50"
                >
                    <Plus size={20} className="mr-3" />
                    {submitting ? 'Generando...' : 'Generar Cotización'}
                </button>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por cliente o folio..."
                        className="w-full pl-14 pr-6 py-4 bg-white border border-transparent rounded-3xl shadow-sm focus:ring-4 focus:ring-indigo-50 outline-none transition-all text-gray-600 font-medium"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    {[
                        { label: 'Todos', value: 'All' },
                        { label: 'Borrador', value: 'Draft' },
                        { label: 'Enviadas', value: 'Sent' },
                        { label: 'Aprobadas', value: 'Approved' }
                    ].map((filter) => (
                        <button
                            key={filter.value}
                            onClick={() => setActiveFilter(filter.value)}
                            className={`px-6 py-4 rounded-3xl font-bold text-sm transition-all shadow-sm ${activeFilter === filter.value ? 'bg-white text-indigo-600 border border-indigo-100' : 'bg-gray-50 text-gray-400 hover:bg-white border border-transparent'}`}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {loading ? (
                    Array(4).fill(0).map((_, i) => (
                        <div key={i} className="bg-white rounded-[2.5rem] p-8 h-48 animate-pulse shadow-sm"></div>
                    ))
                ) : (
                    quotations.filter(q => {
                        if (activeFilter === 'All') return true;
                        if (activeFilter === 'Draft') return q.status === 'draft';
                        if (activeFilter === 'Sent') return q.status === 'sent';
                        if (activeFilter === 'Approved') return q.status === 'approved';
                        return true;
                    }).filter(q => { // Add search filter logic
                        if (!clientSearch) return true;
                        const searchLower = clientSearch.toLowerCase();
                        return q.client_name?.toLowerCase().includes(searchLower) ||
                            q.folio?.toString().includes(searchLower);
                    }).map((q) => (
                        <div key={q.id} className="premium-card p-6 flex flex-col justify-between group h-auto">
                            <div className="space-y-5">
                                <div className="flex justify-between items-start">
                                    <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center border border-indigo-100 text-indigo-600 font-black text-xl uppercase shadow-sm">
                                        {q.client_name.substring(0, 2)}
                                    </div>
                                    <div className="flex flex-col items-end gap-1.5">
                                        <div className="flex gap-1.5">
                                            {/* Stage Badge */}
                                            {q.stage && (
                                                <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wide border ${q.stage === 'won' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                                    q.stage === 'lost' ? 'bg-red-100 text-red-700 border-red-200' :
                                                        q.stage === 'negotiation' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                                            q.stage === 'contacted' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                                                'bg-gray-100 text-gray-600 border-gray-200'
                                                    }`}>
                                                    {q.stage === 'won' ? 'Ganada' :
                                                        q.stage === 'lost' ? 'Perdida' :
                                                            q.stage === 'negotiation' ? 'Negociación' :
                                                                q.stage === 'contacted' ? 'Contactado' : 'Nueva'}
                                                </span>
                                            )}
                                            <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border shadow-sm ${getStatusStyles(q.status)}`}>
                                                {getStatusLabel(q.status)}
                                            </span>
                                        </div>
                                        {q.interaction_type && (
                                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-wide border ${q.interaction_type === 'Presencial' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                                q.interaction_type === 'WhatsApp' ? 'bg-green-50 text-green-700 border-green-100' :
                                                    'bg-blue-50 text-blue-700 border-blue-100'
                                                }`}>
                                                {q.interaction_type}
                                            </span>
                                        )}
                                        <p className="text-[10px] font-bold text-gray-400 italic mt-0.5">Folio {q.folio || 'N/A'}</p>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-lg font-black text-gray-900 group-hover:text-indigo-600 transition-colors truncate uppercase tracking-tight" title={q.client_name}>
                                        {q.client_name}
                                    </h3>
                                    <div className="flex items-center text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">
                                        <Clock size={12} className="mr-1.5 text-indigo-400" />
                                        <span>{new Date(q.created_at).toLocaleDateString()}</span>
                                        <span className="mx-2 text-gray-200">|</span>
                                        <span>{new Date(q.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 py-4 border-t border-gray-50 mt-2">
                                    <div>
                                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest mb-1">Vendedor</p>
                                        <p className="text-xs font-bold text-gray-700 truncate">{q.seller_name}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest mb-1">Total Cotizado</p>
                                        <p className="text-sm font-black text-indigo-600">${q.total_amount?.toLocaleString()}</p>
                                    </div>
                                </div>

                                <div className="p-4 bg-gray-50/50 rounded-2xl border border-gray-100 space-y-3">
                                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest border-b border-gray-100 pb-1">Contacto del Cliente</p>
                                    <div className="space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">Atención:</span>
                                            <span className="text-[10px] font-bold text-gray-900 truncate ml-2 max-w-[150px]">{q.client_contact}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">Teléfono:</span>
                                            <span className="text-[10px] font-bold text-gray-900">{q.client_phone}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">Email:</span>
                                            <span className="text-[10px] font-bold text-indigo-500 lowercase truncate ml-2 max-w-[150px]">{q.client_email}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-6 flex items-center gap-2 mt-auto">
                                <button
                                    onClick={() => setSelectedForTemplate(q)}
                                    className="flex-1 bg-gray-900 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center hover:bg-indigo-700 hover:shadow-indigo-100"
                                >
                                    <Eye size={14} className="mr-2" />
                                    Ver Documento
                                </button>

                                {q.status !== 'approved' && (
                                    <button
                                        onClick={() => handleConvertToOrder(q)}
                                        disabled={submitting}
                                        className="bg-green-50 text-green-600 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm border border-green-100 active:scale-95 transition-all flex items-center justify-center hover:bg-green-600 hover:text-white"
                                        title="Convertir en Venta Real"
                                    >
                                        <ShoppingBag size={14} className="mr-1" />
                                        Vender
                                    </button>
                                )}

                                <div className="flex gap-1">
                                    {q.location && (
                                        <button
                                            onClick={() => setSelectedLocation(q)}
                                            className="p-3 bg-white text-gray-400 rounded-xl border border-gray-100 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                                            title="Ver Ubicación"
                                        >
                                            <MapPin size={16} />
                                        </button>
                                    )}
                                    {(isSupervisor || q.seller_id === profile?.id) && (
                                        <>
                                            <button
                                                onClick={() => handleEditQuotation(q)}
                                                className="p-3 bg-white text-gray-400 rounded-xl border border-gray-100 hover:text-amber-600 hover:bg-amber-50 transition-all"
                                                title="Editar"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteQuotation(q.id)}
                                                disabled={isDeleting === q.id}
                                                className={`p-3 bg-white text-gray-400 rounded-xl border border-gray-100 hover:text-red-600 hover:bg-red-50 transition-all ${isDeleting === q.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                title="Eliminar"
                                            >
                                                {isDeleting === q.id ? (
                                                    <div className="w-4 h-4 border-2 border-red-600 border-t-transparent animate-spin rounded-full"></div>
                                                ) : (
                                                    <Trash2 size={16} />
                                                )}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Location Map Modal */}
            {
                selectedLocation && (
                    <div className="fixed inset-0 z-[2000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-4xl h-[600px] rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 relative flex flex-col">
                            <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur px-4 py-2 rounded-xl shadow-lg border border-gray-100">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Ubicación de Creación</p>
                                <p className="font-bold text-indigo-600">Folio: {selectedLocation.folio}</p>
                            </div>
                            <button
                                onClick={() => setSelectedLocation(null)}
                                className="absolute top-4 right-4 z-10 bg-white text-gray-400 p-2 rounded-full hover:bg-gray-100 shadow-lg transition-all"
                            >
                                <XIcon size={24} />
                            </button>

                            <div className="flex-1 w-full h-full">
                                <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
                                    <Map
                                        defaultCenter={{ lat: Number(selectedLocation.location.lat), lng: Number(selectedLocation.location.lng) }}
                                        defaultZoom={15}
                                        mapId="QUOTATION_MAP"
                                        className="w-full h-full"
                                        disableDefaultUI={false}
                                    >
                                        <AdvancedMarker position={{ lat: Number(selectedLocation.location.lat), lng: Number(selectedLocation.location.lng) }}>
                                            <Pin background={'#4f46e5'} borderColor={'#312e81'} glyphColor={'white'} scale={1.2} />
                                        </AdvancedMarker>
                                    </Map>
                                </APIProvider>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Template Modal */}
            {
                selectedForTemplate && (
                    <QuotationTemplate
                        data={{
                            folio: selectedForTemplate.folio,
                            date: new Date(selectedForTemplate.created_at).toLocaleDateString(),
                            expiryDate: new Date(new Date(selectedForTemplate.created_at).getTime() + 15 * 24 * 60 * 60 * 1000).toLocaleDateString(), // +15 days
                            clientName: selectedForTemplate.client_name,
                            clientRut: selectedForTemplate.client?.rut || 'Sin RUT',
                            clientAddress: selectedForTemplate.client?.address || selectedForTemplate.client?.comuna || 'Sin Dirección',
                            clientCity: selectedForTemplate.client?.zone || 'Santiago',
                            clientComuna: selectedForTemplate.client?.comuna || '',
                            clientGiro: selectedForTemplate.client?.giro || '',
                            clientPhone: selectedForTemplate.client_phone,
                            clientEmail: selectedForTemplate.client_email,
                            clientContact: selectedForTemplate.client_contact,
                            paymentTerms: typeof selectedForTemplate.payment_terms === 'string'
                                ? selectedForTemplate.payment_terms
                                : (selectedForTemplate.payment_terms?.type === 'Crédito'
                                    ? `Crédito ${selectedForTemplate.payment_terms.days} Días`
                                    : 'Contado'),
                            sellerName: selectedForTemplate.seller_name,
                            items: selectedForTemplate.items || [],
                            comments: selectedForTemplate.comments
                        }}
                        onClose={() => setSelectedForTemplate(null)}
                    />
                )
            }

            {/* Client Selector Modal */}
            {
                isClientModalOpen && (
                    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                            <div className="p-6 bg-gradient-to-br from-indigo-600 to-purple-700 text-white flex justify-between items-center">
                                <div className="flex items-center space-x-2">
                                    <User size={20} />
                                    <h3 className="font-bold text-lg">Seleccionar Cliente</h3>
                                </div>
                                <button onClick={() => setIsClientModalOpen(false)} className="p-2 hover:bg-white/20 rounded-full transition-all">
                                    <XIcon size={20} />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="relative">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Buscar cliente por nombre..."
                                        className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-transparent rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium"
                                        value={clientSearch}
                                        onChange={(e) => setClientSearch(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                                    {availableClients
                                        .filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
                                        .map(client => (
                                            <button
                                                key={client.id}
                                                onClick={() => handleClientSelect(client)}
                                                className="w-full p-4 flex items-center justify-between bg-white border border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 rounded-2xl transition-all group"
                                            >
                                                <div className="text-left">
                                                    <p className="font-bold text-gray-900 group-hover:text-indigo-700 transition-colors uppercase text-sm">{client.name}</p>
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{client.zone || 'Sin Zona'}</p>
                                                </div>
                                                <ChevronRight size={18} className="text-gray-300 group-hover:text-indigo-500 transition-colors" />
                                            </button>
                                        ))
                                    }
                                    {availableClients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                                        <div className="text-center py-8 text-gray-400">
                                            <p className="text-sm font-medium">No se encontraron clientes.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Item Entry Modal */}
            {
                isItemModalOpen && selectedClient && (
                    <div className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300 flex flex-col max-h-[85dvh]">
                            <div className="p-6 bg-gradient-to-br from-indigo-600 to-purple-700 text-white flex justify-between items-center shrink-0">
                                <div>
                                    <h3 className="font-bold text-lg">Detalles de Cotización</h3>
                                    <p className="text-white/80 text-sm">Cliente: {selectedClient.name}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setIsLocationPickerOpen(true)}
                                        className={`p-2 rounded-full transition-all border ${manualLocation ? 'bg-green-400 text-white border-green-500' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}
                                        title={manualLocation ? "Ubicación Simulada Activa" : "Simular Ubicación en Mapa"}
                                    >
                                        <MapPin size={20} />
                                    </button>
                                    <button onClick={() => setIsItemModalOpen(false)} className="p-2 hover:bg-white/20 rounded-full transition-all">
                                        <XIcon size={20} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 overflow-y-auto">
                                <h4 className="font-bold text-gray-700 mb-4 flex items-center"><ShoppingBag size={18} className="mr-2 text-indigo-500" /> Ítems</h4>

                                <div className="space-y-4">
                                    {formItems.map((item, index) => (
                                        <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100 relative group">
                                            <div className="col-span-1 md:col-span-3 relative">
                                                <label className="text-[10px] uppercase font-bold text-gray-400">Código (SKU)</label>
                                                <input
                                                    type="text"
                                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    placeholder="SKU..."
                                                    value={item.code}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        const newItems = [...formItems];
                                                        newItems[index].code = val;
                                                        setFormItems(newItems);

                                                        if (val.length > 1) {
                                                            const filtered = products.filter(p => p.sku?.toLowerCase().includes(val.toLowerCase())).slice(0, 5);
                                                            setSuggestions(filtered);
                                                            setActiveSuggestion({ index, field: 'code' });
                                                        } else {
                                                            setSuggestions([]);
                                                            setActiveSuggestion(null);
                                                        }
                                                    }}
                                                    onBlur={() => setTimeout(() => setActiveSuggestion(null), 200)}
                                                />
                                                {activeSuggestion?.index === index && activeSuggestion.field === 'code' && suggestions.length > 0 && (
                                                    <div className="absolute z-50 w-64 bg-white border border-gray-100 rounded-xl shadow-2xl mt-1 overflow-hidden">
                                                        {suggestions.map((p, i) => (
                                                            <button
                                                                key={i}
                                                                className="w-full text-left px-4 py-3 hover:bg-gray-50 flex flex-col border-b border-gray-50 last:border-0"
                                                                onClick={() => {
                                                                    const newItems = [...formItems];
                                                                    newItems[index] = {
                                                                        ...newItems[index],
                                                                        code: p.sku || '',
                                                                        detail: p.name,
                                                                        price: p.price || 0
                                                                    };
                                                                    setFormItems(newItems);
                                                                    setSuggestions([]);
                                                                    setActiveSuggestion(null);
                                                                }}
                                                            >
                                                                <span className="text-xs font-bold text-gray-900">{p.sku}</span>
                                                                <span className="text-[10px] text-gray-500 truncate">{p.name}</span>
                                                                <span className="text-[9px] font-black text-indigo-500">Stock: {p.stock_qty}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="col-span-1 md:col-span-9 relative">
                                                <label className="text-[10px] uppercase font-bold text-gray-400">Descripción</label>
                                                <input
                                                    type="text"
                                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    placeholder="Descripción del producto..."
                                                    value={item.detail}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        const newItems = [...formItems];
                                                        newItems[index].detail = val;
                                                        setFormItems(newItems);

                                                        if (val.length > 2) {
                                                            const filtered = products.filter(p => p.name?.toLowerCase().includes(val.toLowerCase())).slice(0, 5);
                                                            setSuggestions(filtered);
                                                            setActiveSuggestion({ index, field: 'detail' });
                                                        } else {
                                                            setSuggestions([]);
                                                            setActiveSuggestion(null);
                                                        }
                                                    }}
                                                    onBlur={() => setTimeout(() => setActiveSuggestion(null), 200)}
                                                />
                                                {activeSuggestion?.index === index && activeSuggestion.field === 'detail' && suggestions.length > 0 && (
                                                    <div className="absolute z-50 w-full bg-white border border-gray-100 rounded-xl shadow-2xl mt-1 overflow-hidden">
                                                        {suggestions.map((p, i) => (
                                                            <button
                                                                key={i}
                                                                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0"
                                                                onClick={() => {
                                                                    const newItems = [...formItems];
                                                                    newItems[index] = {
                                                                        ...newItems[index],
                                                                        code: p.sku || '',
                                                                        detail: p.name,
                                                                        price: p.price || 0
                                                                    };
                                                                    setFormItems(newItems);
                                                                    setSuggestions([]);
                                                                    setActiveSuggestion(null);
                                                                }}
                                                            >
                                                                <div className="flex justify-between items-center">
                                                                    <span className="text-xs font-bold text-gray-900">{p.name}</span>
                                                                    <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded font-mono">{p.sku}</span>
                                                                </div>
                                                                <div className="flex justify-between mt-1">
                                                                    <span className="text-[10px] text-gray-400">Precio: ${p.price?.toLocaleString()}</span>
                                                                    <span className="text-[10px] font-black text-indigo-500">Stock: {p.stock_qty}</span>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="col-span-1 md:col-span-3">
                                                <label className="text-[10px] uppercase font-bold text-gray-400">Cantidad</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    value={item.qty}
                                                    onChange={(e) => {
                                                        const newItems = [...formItems];
                                                        newItems[index].qty = parseInt(e.target.value) || 0;
                                                        setFormItems(newItems);
                                                    }}
                                                />
                                            </div>
                                            <div className="col-span-1 md:col-span-4">
                                                <label className="text-[10px] uppercase font-bold text-gray-400">Precio Unitario</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    placeholder="$ 0"
                                                    value={item.price}
                                                    onChange={(e) => {
                                                        const newItems = [...formItems];
                                                        newItems[index].price = parseInt(e.target.value) || 0;
                                                        setFormItems(newItems);
                                                    }}
                                                />
                                            </div>
                                            <div className="col-span-1 md:col-span-5 flex items-end justify-end md:justify-end">
                                                <p className="font-black text-lg text-gray-700">$ {((item.qty || 0) * (item.price || 0)).toLocaleString()}</p>
                                            </div>

                                            {formItems.length > 1 && (
                                                <button
                                                    onClick={() => {
                                                        const newItems = formItems.filter((_, i) => i !== index);
                                                        setFormItems(newItems);
                                                    }}
                                                    className="absolute -top-2 -right-2 bg-red-100 text-red-500 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <XIcon size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}

                                    <button
                                        onClick={() => setFormItems([...formItems, { code: '', detail: '', qty: 1, price: 0 }])}
                                        className="w-full py-3 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-500 font-bold hover:bg-indigo-50 transition-all flex items-center justify-center"
                                    >
                                        <Plus size={18} className="mr-2" /> Agregar otro ítem
                                    </button>
                                </div>

                                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="text-xs uppercase font-bold text-gray-400 mb-2 block">Condición de Pago</label>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setPaymentTerms({ type: 'Contado', days: 0 })}
                                                className={`flex-1 py-3 px-4 rounded-xl font-bold border-2 transition-all ${paymentTerms.type === 'Contado' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                                            >
                                                Contado
                                            </button>
                                            <button
                                                onClick={() => setPaymentTerms({ type: 'Crédito', days: 30 })}
                                                className={`flex-1 py-3 px-4 rounded-xl font-bold border-2 transition-all ${paymentTerms.type === 'Crédito' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-100 text-gray-500 hover:bg-gray-50'}`}
                                            >
                                                Crédito
                                            </button>
                                        </div>
                                        {paymentTerms.type === 'Crédito' && (
                                            <div className="mt-3 animate-in slide-in-from-top-2">
                                                <label className="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Días de Crédito</label>
                                                <input
                                                    type="number"
                                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    value={paymentTerms.days}
                                                    onChange={(e) => setPaymentTerms({ ...paymentTerms, days: parseInt(e.target.value) || 0 })}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-xs uppercase font-bold text-gray-400 mb-2 block">Comentarios Adicionales</label>
                                        <textarea
                                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none h-24 resize-none"
                                            placeholder="Instrucciones de entrega..."
                                            value={formComments}
                                            onChange={(e) => setFormComments(e.target.value)}
                                        ></textarea>
                                    </div>
                                </div>
                            </div>


                            {createError && (
                                <div className="mx-6 mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-3">
                                    <span className="font-bold">Error:</span>
                                    <span className="text-sm">{createError}</span>
                                </div>
                            )}

                            {/* Location Picker Modal */}
                            {
                                isLocationPickerOpen && (
                                    <div className="fixed inset-0 z-[2100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                                        <div className="bg-white w-full max-w-4xl h-[600px] rounded-3xl shadow-2xl overflow-hidden relative flex flex-col">
                                            <div className="absolute top-4 left-4 z-10 bg-white/90 backdrop-blur px-4 py-2 rounded-xl shadow-lg border border-gray-100">
                                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Simulación GPS</p>
                                                <p className="font-bold text-indigo-600">Haz click en el mapa para fijar ubicación</p>
                                            </div>
                                            <button
                                                onClick={() => setIsLocationPickerOpen(false)}
                                                className="absolute top-4 right-4 z-10 bg-white text-gray-400 p-2 rounded-full hover:bg-gray-100 shadow-lg transition-all"
                                            >
                                                <XIcon size={24} />
                                            </button>

                                            <div className="flex-1 w-full h-full relative">
                                                <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
                                                    <Map
                                                        defaultCenter={{ lat: -33.4489, lng: -70.6693 }}
                                                        defaultZoom={12}
                                                        mapId="PICKER_MAP"
                                                        className="w-full h-full"
                                                        disableDefaultUI={false}
                                                        onClick={(e) => {
                                                            if (e.detail.latLng) {
                                                                setManualLocation({ lat: e.detail.latLng.lat, lng: e.detail.latLng.lng });
                                                                // Optional: visual feedback or auto-close? 
                                                                // Let's keep it open so they can adjust, but maybe show a toast or marker
                                                            }
                                                        }}
                                                    >
                                                        {manualLocation && (
                                                            <AdvancedMarker position={manualLocation}>
                                                                <Pin background={'#22c55e'} borderColor={'#15803d'} glyphColor={'white'} scale={1.3} />
                                                            </AdvancedMarker>
                                                        )}
                                                    </Map>
                                                </APIProvider>

                                                {manualLocation && (
                                                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
                                                        <button
                                                            onClick={() => setIsLocationPickerOpen(false)}
                                                            className="bg-green-500 text-white px-8 py-3 rounded-full font-bold shadow-xl hover:bg-green-600 transition-all active:scale-95 flex items-center"
                                                        >
                                                            <CheckCircle2 size={18} className="mr-2" />
                                                            Confirmar Ubicación
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            }

                            <div className="p-4 md:p-6 border-t border-gray-100 bg-gray-50 flex flex-col md:flex-row justify-between items-center shrink-0 gap-3 md:gap-0">
                                <div className="w-full md:w-auto text-center md:text-left">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Estimado</p>
                                    <p className="text-xl md:text-2xl font-black text-indigo-600">
                                        $ {formItems.reduce((sum, item) => sum + ((item.qty || 0) * (item.price || 0)), 0).toLocaleString()}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setIsInteractionModalOpen(true)}
                                    disabled={submitting}
                                    className="w-full md:w-auto bg-indigo-600 text-white px-8 py-3 md:py-4 rounded-2xl font-bold flex items-center justify-center shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                                >
                                    <CheckCircle2 size={20} className="mr-2" />
                                    {submitting ? 'Confirmando...' : 'Confirmar Cotización'}
                                </button>
                            </div>
                        </div>
                    </div>

                )
            }

            {/* Interaction Type Selection Modal */}
            {isInteractionModalOpen && (
                <div className="fixed inset-0 z-[2200] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl p-8 animate-in zoom-in duration-300">
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 text-indigo-600">
                                <MapPin size={32} />
                            </div>
                            <h3 className="text-2xl font-black text-gray-900 leading-tight">¿Cómo se realizó esta atención?</h3>
                            <p className="text-gray-400 font-medium text-sm">Capturaremos tu ubicación actual para el registro.</p>
                        </div>

                        <div className="mt-8 space-y-3">
                            {[
                                { id: 'Presencial', icon: <User size={18} />, desc: 'Visita en clínica', disabled: !activeVisit },
                                { id: 'WhatsApp', icon: <MessageSquare size={18} />, desc: 'Conversación digital', disabled: false },
                                { id: 'Teléfono', icon: <Phone size={18} />, desc: 'Llamada comercial', disabled: false }
                            ].map((type) => (
                                <button
                                    key={type.id}
                                    disabled={type.disabled}
                                    onClick={() => setSelectedInteractionType(type.id as any)}
                                    className={`w-full p-4 rounded-2xl border-2 flex items-center justify-between transition-all ${selectedInteractionType === type.id ? 'border-indigo-600 bg-indigo-50/50 shadow-inner' : 'border-gray-100 bg-white'} ${!type.disabled && selectedInteractionType !== type.id ? 'hover:border-indigo-200' : ''} ${type.disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''}`}
                                >
                                    <div className="flex items-center">
                                        <div className={`p-2 rounded-xl mr-3 ${selectedInteractionType === type.id ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-400'}`}>
                                            {type.icon}
                                        </div>
                                        <div className="text-left">
                                            <p className={`font-bold text-sm ${selectedInteractionType === type.id ? 'text-indigo-900' : 'text-gray-700'}`}>{type.id}</p>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{type.desc}</p>
                                        </div>
                                    </div>
                                    {selectedInteractionType === type.id && <CheckCircle2 size={18} className="text-indigo-600" />}
                                </button>
                            ))}
                        </div>

                        <div className="mt-8 flex gap-3">
                            <button
                                onClick={() => setIsInteractionModalOpen(false)}
                                className="flex-1 py-4 text-gray-400 font-bold text-sm hover:text-gray-600"
                            >
                                Volver
                            </button>
                            <button
                                onClick={handleCreateQuotation}
                                disabled={submitting}
                                className="flex-[2] bg-indigo-600 text-white py-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all"
                            >
                                {submitting ? 'Guardando...' : 'Generar Ahora'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Empty State Help */}
            <div className="bg-indigo-50/50 border-2 border-dashed border-indigo-100 rounded-[3rem] p-12 text-center mt-8">

                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
                    <ShoppingBag className="text-indigo-400" size={28} />
                </div>
                <h4 className="text-xl font-bold text-gray-900 mb-2">Need to create a fast quote?</h4>
                <p className="text-gray-500 max-w-md mx-auto mb-8 font-medium">Use our quick template system to generate professional PDF proposals in seconds during your clinic visits.</p>
                <button className="bg-white border-2 border-indigo-100 px-10 py-4 rounded-[2rem] font-bold text-indigo-600 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all shadow-sm">
                    View Templates
                </button>
            </div>
        </div>
    );
};

export default Quotations;
