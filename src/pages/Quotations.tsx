import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShoppingBag, Plus, Search, FileText, ChevronRight, Clock, CheckCircle2, AlertCircle, Eye, Printer, X as XIcon, User, MapPin, Navigation, Trash2, Edit2, MessageSquare, Phone, Mail, Upload, Share2 } from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { useVisit } from '../contexts/VisitContext';
import { checkGPSConnection } from '../utils/gps';
import { queueQuotationLocation } from '../services/locationQueue';
import { sendOrderNotificationEmail } from '../utils/orderEmail';
import { formatPaymentTermsFromCreditDays, getClientCreditDays, getPaymentTermsFromCreditDays } from '../utils/credit';
import { buildDiscountApprovalRequestedItems, getApprovalReason } from '../utils/discountApproval';
import { buildQuotationPreviewData } from '../utils/quotationPreview';
import { sendQuotationEmail } from '../utils/quotationEmail';
import { generateQuotationPdfFile } from '../utils/quotationPdf';

const QuotationTemplate = lazy(() => import('../components/QuotationTemplate'));

type SellerOption = {
    id: string;
    full_name: string | null;
    email: string | null;
    role: string | null;
    status: string | null;
};

type QuoteFilter = 'All' | 'Draft' | 'Sent' | 'Approved';
const FILTER_OPTIONS: Array<{ label: string; value: QuoteFilter }> = [
    { label: 'Todos', value: 'All' },
    { label: 'Borrador', value: 'Draft' },
    { label: 'Enviadas', value: 'Sent' },
    { label: 'Aprobadas', value: 'Approved' }
];
const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;
const SELLER_MAX_DISCOUNT_PCT = 5;
const DISPATCH_SERVICE_NAME = 'SERVICIO DE DESPACHO';
const DISPATCH_SERVICE_SKU = 'SERV-DESPACHO';
const PAYMENT_PROOFS_BUCKET = 'payment-proofs';
const PAYMENT_PROOF_MAX_BYTES = 20 * 1024 * 1024;
const normalizeProductKey = (value: string) =>
    value
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/g, '');
const DISPATCH_SERVICE_NAME_KEY = normalizeProductKey(DISPATCH_SERVICE_NAME);
const DISPATCH_SERVICE_SKU_KEY = normalizeProductKey(DISPATCH_SERVICE_SKU);

const allowedPaymentProofExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

const notifyApprovalPush = async (approvalId: string) => {
    try {
        const { error } = await supabase.functions.invoke('send-approval-push', {
            body: {
                approval_id: approvalId,
                icon: import.meta.env.VITE_COMPANY_LOGO || '/logo_megagen.png'
            }
        });
        if (error) {
            console.warn('No se pudo disparar push de aprobación:', error.message);
        }
    } catch (error: any) {
        console.warn('Error inesperado enviando push de aprobación:', error?.message || error);
    }
};

const Quotations: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [quotations, setQuotations] = useState<any[]>([]);
    const [activeFilter, setActiveFilter] = useState<QuoteFilter>('All');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);
    const [selectedForTemplate, setSelectedForTemplate] = useState<any>(null);
    const [isClientModalOpen, setIsClientModalOpen] = useState(false);
    const [isItemModalOpen, setIsItemModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<any | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [availableClients, setAvailableClients] = useState<any[]>([]);
    const [quotationSearch, setQuotationSearch] = useState('');
    const [clientSelectorSearch, setClientSelectorSearch] = useState('');
    const [selectedLocation, setSelectedLocation] = useState<any>(null); // For View Location Modal
    const [manualLocation, setManualLocation] = useState<{ lat: number; lng: number } | null>(null); // For Custom Picker
    const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
    const [editingQuotation, setEditingQuotation] = useState<any | null>(null);
    const [isInteractionModalOpen, setIsInteractionModalOpen] = useState(false);
    const [selectedInteractionType, setSelectedInteractionType] = useState<'Presencial' | 'WhatsApp' | 'Teléfono'>('Presencial');
    const [discountApprovalRequested, setDiscountApprovalRequested] = useState(false);
    const [isApprovalReasonModalOpen, setIsApprovalReasonModalOpen] = useState(false);
    const [approvalReason, setApprovalReason] = useState('');
    const [approvalReasonError, setApprovalReasonError] = useState<string | null>(null);
    const [quotationPendingOrder, setQuotationPendingOrder] = useState<any | null>(null);
    const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
    const [paymentProofError, setPaymentProofError] = useState<string | null>(null);
    const [availableSellers, setAvailableSellers] = useState<SellerOption[]>([]);
    const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);

    // Form State
    const [formItems, setFormItems] = useState<any[]>([{ productId: null, code: '', detail: '', qty: 1, price: 0, discountPct: 0, netPrice: 0 }]);
    const [formComments, setFormComments] = useState('');
    const [paymentTerms, setPaymentTerms] = useState<{ type: 'Contado' | 'Crédito', days: number }>({ type: 'Contado', days: 0 });

    // Inventory & Autocomplete
    const [products, setProducts] = useState<any[]>([]);
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [activeSuggestion, setActiveSuggestion] = useState<{ index: number, field: 'code' | 'detail' } | null>(null);

    const { profile, isSupervisor, hasPermission, permissions, effectiveRole } = useUser();
    const { activeVisit } = useVisit();

    const isSellerRole = effectiveRole === 'seller';
    const canViewAll = useMemo(
        () => !isSellerRole && (hasPermission('VIEW_ALL_CLIENTS') || isSupervisor || profile?.email === (import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl')),
        [isSellerRole, hasPermission, isSupervisor, profile?.email]
    );

    const markQuotationAsSent = useCallback(async (quotationId: string) => {
        if (!quotationId) return;

        const nowIso = new Date().toISOString();
        const basePayload: any = { status: 'sent', sent_at: nowIso };

        let updateError: any = null;
        try {
            const withStagePayload: any = { ...basePayload, stage: 'sent' };
            const withStageRes = await supabase
                .from('quotations')
                .update(withStagePayload)
                .eq('id', quotationId);
            updateError = withStageRes.error;

            if (updateError && String(updateError.message || '').toLowerCase().includes('column') && String(updateError.message || '').toLowerCase().includes('stage')) {
                const fallbackRes = await supabase
                    .from('quotations')
                    .update(basePayload)
                    .eq('id', quotationId);
                updateError = fallbackRes.error;
            }
        } catch (error: any) {
            updateError = error;
        }

        if (updateError) {
            console.warn('No se pudo marcar cotización como enviada:', updateError?.message || updateError);
            return;
        }

        setQuotations((prev) => prev.map((quote) => (
            quote.id === quotationId
                ? { ...quote, status: 'sent', sent_at: nowIso, stage: 'sent' }
                : quote
        )));
        setSelectedForTemplate((prev: any) => (
            prev?.id === quotationId
                ? { ...prev, status: 'sent', sent_at: nowIso, stage: 'sent' }
                : prev
        ));
    }, []);

    const normalizePhoneForWhatsapp = useCallback((raw: string | null | undefined): string | null => {
        const digits = String(raw || '').replace(/\D/g, '');
        if (!digits) return null;
        if (digits.startsWith('569') && digits.length >= 11) return digits;
        if (digits.startsWith('56') && digits.length >= 10) return digits;
        if (digits.startsWith('9') && digits.length === 9) return `56${digits}`;
        return null;
    }, []);

    const openQuoteViaWhatsApp = useCallback(async (quote: any) => {
        if (quote?.discount_approval?.status === 'pending' || quote?.discount_approval?.status === 'rejected') {
            alert('Esta cotización no se puede enviar hasta resolver la aprobación de descuento.');
            return;
        }

        const normalizedPhone = normalizePhoneForWhatsapp(quote?.client_phone || quote?.client?.phone);
        if (!normalizedPhone) {
            alert('El cliente no tiene un celular válido para WhatsApp.');
            return;
        }

        const message = `Hola, te comparto la cotización Folio Nº ${quote?.folio || ''} de ${import.meta.env.VITE_COMPANY_NAME || 'Megagen Chile'}.\n\nTotal: ${formatMoney(Number(quote?.total_amount || 0))}\nVendedor: ${quote?.seller_name || 'Vendedor'}`;
        const url = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        await markQuotationAsSent(quote.id);
    }, [markQuotationAsSent, normalizePhoneForWhatsapp]);

    const openQuoteViaEmail = useCallback(async (quote: any, pdfAttachment?: File | null) => {
        if (quote?.discount_approval?.status === 'pending' || quote?.discount_approval?.status === 'rejected') {
            alert('Esta cotización no se puede enviar hasta resolver la aprobación de descuento.');
            return;
        }

        const recipient = String(quote?.client_email || quote?.client?.email || '').trim();
        if (!recipient) {
            alert('El cliente no tiene correo registrado.');
            return;
        }

        const previewData = buildQuotationPreviewData(
            quote,
            formatPaymentTermsFromCreditDays(getClientCreditDays(quote?.client))
        );
        const subject = `Cotización Folio Nº ${quote?.folio || ''} - ${import.meta.env.VITE_COMPANY_NAME || 'Megagen Chile'}`;
        const shareText = [
            `Hola ${quote?.client_contact || 'cliente'},`,
            '',
            `Te comparto la cotización Folio Nº ${quote?.folio || ''}.`,
            `Total: ${formatMoney(Number(quote?.total_amount || 0))}`,
            `Vendedor: ${quote?.seller_name || 'Vendedor'}`,
            '',
            'Adjunto encontrarás el PDF formal de la cotización.',
            '',
            'Quedo atento(a) a tus comentarios.'
        ].join('\n');

        try {
            const quotationPdf = pdfAttachment || await generateQuotationPdfFile(previewData);
            if (navigator.canShare && navigator.canShare({ files: [quotationPdf] })) {
                try {
                    await navigator.share({
                        files: [quotationPdf],
                        title: subject,
                        text: shareText
                    });
                    await markQuotationAsSent(quote.id);
                    return;
                } catch (shareError: any) {
                    if (shareError?.name === 'AbortError') {
                        return;
                    }
                }
            }

            await sendQuotationEmail({
                quotation: previewData,
                recipient,
                contactName: quote?.client_contact,
                clientId: quote?.client?.id || null,
                profileId: profile?.id || undefined,
                pdfAttachment: quotationPdf
            });
            await markQuotationAsSent(quote.id);
            alert('Correo enviado correctamente con el PDF adjunto.');
        } catch (error: any) {
            alert(error?.message || 'No se pudo enviar el correo con la cotización adjunta.');
        }
    }, [markQuotationAsSent, profile?.id]);

    const fetchQuotations = useCallback(async () => {
        setLoading(true);
        setFetchError(null);

        try {
            try {
                await supabase.rpc('expire_stale_sent_quotations', { p_days: 3 });
            } catch (expireError) {
                console.warn('No se pudo ejecutar expiración automática de cotizaciones enviadas:', expireError);
            }

            let query = supabase
                .from('quotations')
                .select(`
                    *,
                    clients (id, name, rut, address, zone, purchase_contact, status, phone, email, giro, comuna, office, credit_days)
                `);

            if (isSellerRole && profile?.id) {
                query = query.eq('seller_id', profile.id);
            } else if (!canViewAll && profile?.id) {
                query = query.eq('seller_id', profile.id);
            }

            const { data: quotesData, error: quotesError } = await query.order('created_at', { ascending: false });

            if (quotesError) {
                throw quotesError;
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
                    promises.push(
                        supabase
                            .from('approval_requests')
                            .select('id, entity_id, status, approval_type, requested_at, payload')
                            .eq('approval_type', 'extra_discount')
                            .in('entity_id', quotationIds)
                            .order('requested_at', { ascending: false })
                            .then(({ data }) => {
                                if (data) {
                                    data.forEach((a: any) => {
                                        if (!a.entity_id) return;
                                        if (!locationsMap[`approval-${a.entity_id}`]) {
                                            locationsMap[`approval-${a.entity_id}`] = a;
                                        }
                                    });
                                }
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
                        items: typeof q.items === 'string' ? (() => { try { return JSON.parse(q.items) } catch { return [] } })() : (q.items || []),
                        discount_approval: locationsMap[`approval-${q.id}`] || null
                    };
                });

                setQuotations(formattedData);
            }
        } catch (error: any) {
            console.error("Error fetching quotations:", error);
            setFetchError(error?.message || 'No se pudieron cargar las cotizaciones.');
        } finally {
            setLoading(false);
        }
    }, [canViewAll, isSellerRole, profile?.id]);

    const fetchProducts = async () => {
        // Explicit columns: never fetch potential cost/margin fields to seller UI.
        const { data } = await supabase
            .from('inventory')
            .select('id, sku, name, price, stock_qty, category')
            .order('name');
        if (data) setProducts(data);
    };

    const fetchAvailableSellers = useCallback(async () => {
        if (effectiveRole !== 'facturador') {
            setAvailableSellers([]);
            return;
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, status')
            .eq('status', 'active')
            .in('role', ['seller', 'jefe', 'admin'])
            .order('full_name');

        if (error) {
            console.error('Error fetching sellers for quotation assignment:', error);
            setAvailableSellers([]);
            return;
        }

        setAvailableSellers((data || []) as SellerOption[]);
    }, [effectiveRole]);

    const fetchClientsForModal = useCallback(async () => {
        let query = supabase.from('clients').select('*').order('name');
        if (isSellerRole && profile?.id) query = query.eq('created_by', profile.id);
        else if (!canViewAll && profile?.id) query = query.eq('created_by', profile.id);
        const { data } = await query;
        if (data) setAvailableClients(data);
    }, [canViewAll, isSellerRole, profile?.id]);

    useEffect(() => {
        fetchQuotations();
        fetchClientsForModal();
        fetchProducts();
        void fetchAvailableSellers();
    }, [fetchAvailableSellers, fetchQuotations, fetchClientsForModal, permissions]);

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
                    setDiscountApprovalRequested(Boolean(draft.discountApprovalRequested));
                    setApprovalReason(String(draft.approvalReason || ''));
                    setSelectedSellerId(draft.selectedSellerId || null);
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
                paymentTerms: paymentTerms,
                discountApprovalRequested,
                approvalReason,
                selectedSellerId
            };
            localStorage.setItem('quotation_draft', JSON.stringify(draft));
        } else if (!isItemModalOpen && !editingQuotation) {
            // Clear draft if closed and not editing
            localStorage.removeItem('quotation_draft');
        }
    }, [isItemModalOpen, selectedClient, formItems, formComments, paymentTerms, editingQuotation, discountApprovalRequested, approvalReason, selectedSellerId]);

    useEffect(() => {
        if (!selectedClient?.id || availableClients.length === 0) return;
        const freshClient = availableClients.find((client) => client.id === selectedClient.id);
        if (!freshClient) return;

        if (freshClient !== selectedClient) {
            setSelectedClient((prev: any) => {
                if (!prev || prev.id !== freshClient.id) return prev;
                return prev.credit_days === freshClient.credit_days
                    && prev.name === freshClient.name
                    && prev.office === freshClient.office
                    ? prev
                    : freshClient;
            });
        }

        const nextPaymentTerms = getPaymentTermsFromCreditDays(getClientCreditDays(freshClient));
        setPaymentTerms((prev) => (
            prev.type === nextPaymentTerms.type && prev.days === nextPaymentTerms.days
                ? prev
                : nextPaymentTerms
        ));
    }, [availableClients, selectedClient]);

    const handleClientSelect = (client: any) => {
        setSelectedClient(client);
        setIsClientModalOpen(false);
        setIsItemModalOpen(true);
        // Reset form
        setFormItems([{ productId: null, code: '', detail: '', qty: 1, price: 0, discountPct: 0, netPrice: 0 }]);
        setFormComments('');
        setPaymentTerms(getPaymentTermsFromCreditDays(getClientCreditDays(client)));
        setManualLocation(null);
        setEditingQuotation(null); // Ensure we are NOT in edit mode
        setDiscountApprovalRequested(false);
        setApprovalReason('');
        setApprovalReasonError(null);
        setSelectedSellerId((prev) => effectiveRole === 'facturador' ? prev : (profile?.id || null));
    };

    const handleEditQuotation = (q: any) => {
        setEditingQuotation(q);
        setSelectedClient(q.client);
        const loadedItems = (q.items || []).map((item: any) => {
            const basePrice = Number(item.price || 0);
            const discountPct = Number(item.discount || 0);
            const netPrice = basePrice > 0 ? Math.round(basePrice * (1 - (discountPct / 100))) : Number(item.net_price || 0);
            return {
                productId: item.product_id || null,
                code: item.code || '',
                detail: item.detail || '',
                qty: Number(item.qty || 1),
                price: basePrice,
                discountPct,
                netPrice: Number(item.net_price ?? netPrice ?? basePrice)
            };
        });
        setFormItems(loadedItems.length > 0 ? loadedItems : [{ productId: null, code: '', detail: '', qty: 1, price: 0, discountPct: 0, netPrice: 0 }]);
        setFormComments(q.comments || '');
        setPaymentTerms(getPaymentTermsFromCreditDays(getClientCreditDays(q.client)));
        setCreateError(null);
        setDiscountApprovalRequested(q.discount_approval?.status === 'pending');
        setApprovalReason(getApprovalReason(q.discount_approval));
        setApprovalReasonError(null);
        setSelectedSellerId(q.seller_id || null);
        setIsItemModalOpen(true);
    };

    const applyItemPricing = (index: number, updater: (item: any) => any) => {
        setFormItems((prev: any[]) => {
            const clone = [...prev];
            const current = clone[index];
            const updated = updater({ ...current });
            const listPrice = Number(updated.price || 0);
            const discountPct = Math.max(0, Number(updated.discountPct || 0));
            const netPrice = listPrice > 0
                ? Math.max(0, Number(updated.netPrice ?? Math.round(listPrice * (1 - (discountPct / 100)))))
                : Math.max(0, Number(updated.netPrice || 0));
            const recomputedDiscount = listPrice > 0 ? Math.max(0, ((listPrice - netPrice) / listPrice) * 100) : 0;

            clone[index] = {
                ...updated,
                discountPct: Number(recomputedDiscount.toFixed(2)),
                netPrice: Number(netPrice.toFixed(2))
            };
            return clone;
        });
    };

    const resolveInventoryProduct = useCallback((item: any) => {
        if (item?.productId) {
            const byId = products.find((p: any) => p.id === item.productId);
            if (byId) return byId;
        }

        const code = String(item?.code || '').trim().toLowerCase();
        if (code) {
            const bySku = products.find((p: any) => (p.sku || '').toLowerCase() === code);
            if (bySku) return bySku;
        }

        const detail = String(item?.detail || '').trim().toLowerCase();
        if (detail) {
            const byName = products.find((p: any) => (p.name || '').toLowerCase() === detail);
            if (byName) return byName;
        }

        return null;
    }, [products]);

    const getEffectiveDiscountPct = useCallback((item: any) => {
        const inventoryProduct = resolveInventoryProduct(item);
        const catalogPrice = Number(inventoryProduct?.price || 0);
        const fallbackPrice = Number(item?.price || 0);
        const referencePrice = catalogPrice > 0 ? catalogPrice : fallbackPrice;
        const netPrice = Math.max(0, Number(item?.netPrice ?? item?.price ?? 0));

        if (referencePrice <= 0) return Math.max(0, Number(item?.discountPct || 0));

        const discount = ((referencePrice - netPrice) / referencePrice) * 100;
        return Math.max(0, Number(discount.toFixed(2)));
    }, [resolveInventoryProduct]);

    const isDispatchServiceProduct = useCallback((product: any | null) => {
        if (!product) return false;
        const skuKey = normalizeProductKey(String(product.sku || ''));
        const nameKey = normalizeProductKey(String(product.name || ''));
        return skuKey === DISPATCH_SERVICE_SKU_KEY || nameKey === DISPATCH_SERVICE_NAME_KEY;
    }, []);

    const getQuotationCreditDays = useCallback((quotation: any) => getClientCreditDays(quotation?.client), []);

    const validatePaymentProofFile = useCallback((file: File | null) => {
        if (!file) return 'Debes adjuntar el comprobante de pago.';
        if (file.size > PAYMENT_PROOF_MAX_BYTES) {
            return 'El comprobante supera el máximo de 20MB.';
        }
        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const mimeType = (file.type || '').toLowerCase();
        const validMime = mimeType === 'application/pdf'
            || mimeType === 'image/jpeg'
            || mimeType === 'image/png'
            || mimeType === 'image/webp';
        if (!allowedPaymentProofExtensions.has(extension) && !validMime) {
            return 'Formato inválido. Usa PDF, JPG, JPEG, PNG o WEBP.';
        }
        return null;
    }, []);

    const uploadPaymentProof = useCallback(async (quotation: any, file: File) => {
        if (!profile?.id) throw new Error('No se pudo identificar al vendedor para subir el comprobante.');
        const fileExt = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const safeBaseName = file.name
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, 80) || 'comprobante';
        const filePath = `${profile.id}/${quotation.id}/${Date.now()}_${safeBaseName}.${fileExt}`;

        const { error } = await supabase.storage
            .from(PAYMENT_PROOFS_BUCKET)
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || undefined
            });

        if (error) throw error;

        return {
            path: filePath,
            name: file.name,
            mimeType: file.type || 'application/octet-stream'
        };
    }, [profile?.id]);

    const buildOrderEmailPayload = useCallback((quotation: any, orderFolio: number | string) => {
        const creditDays = getQuotationCreditDays(quotation);
        const client = quotation?.client || {};
        return {
            folio: orderFolio,
            quotationFolio: quotation?.folio || null,
            date: new Date().toLocaleDateString('es-CL'),
            clientName: client?.name || quotation?.client_name || 'Cliente',
            clientRut: client?.rut || '',
            clientAddress: client?.address || client?.comuna || '',
            clientOffice: client?.office || '',
            clientPhone: client?.phone || '',
            clientEmail: client?.email || '',
            clientGiro: client?.giro || '',
            clientCity: client?.zone || 'Santiago',
            clientComuna: client?.comuna || '',
            clientContact: quotation?.client_contact || client?.purchase_contact || '',
            paymentTerms: formatPaymentTermsFromCreditDays(creditDays),
            sellerName: quotation?.seller_name || 'Vendedor',
            sellerEmail: quotation?.seller_email || '',
            items: (quotation?.items || []).map((item: any) => ({
                code: item.code || '',
                detail: item.detail || '',
                qty: Number(item.qty || 0),
                unit: item.unit || 'UN',
                unitPrice: Number(item.net_price ?? item.netPrice ?? item.price ?? 0),
                total: Number(item.total ?? (Number(item.qty || 0) * Number(item.net_price ?? item.netPrice ?? item.price ?? 0) || 0))
            })),
            totalAmount: Number(quotation?.total_amount || 0),
            comments: quotation?.comments || (quotation?.folio ? `Pedido generado desde cotización #${quotation.folio}.` : 'Pedido generado desde CRM.')
        };
    }, [getQuotationCreditDays]);

    const closePaymentProofModal = useCallback(() => {
        setQuotationPendingOrder(null);
        setPaymentProofFile(null);
        setPaymentProofError(null);
    }, []);

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
        const sellerIdForQuotation = effectiveRole === 'facturador' ? selectedSellerId : profile.id;
        if (!sellerIdForQuotation) {
            setCreateError('Debes seleccionar un vendedor para la cotización.');
            return;
        }
        const normalizedItems = formItems
            .map(item => ({
                ...item,
                detail: String(item.detail || '').trim(),
                qty: Number(item.qty) || 0,
                price: Number(item.price) || 0,
                discountPct: Number(item.discountPct) || 0,
                netPrice: Number(item.netPrice) || 0
            }))
            .filter(item => item.detail.length > 0 || item.qty > 0 || item.price > 0);

        if (normalizedItems.length === 0) {
            setCreateError('Debes agregar al menos un ítem válido.');
            return;
        }
        const invalidItem = normalizedItems.find(item => !item.detail || item.qty <= 0 || item.price < 0);
        if (invalidItem) {
            setCreateError('Cada ítem debe tener descripción, cantidad mayor a 0 y precio válido.');
            return;
        }
        if (normalizedItems.some((item) => !resolveInventoryProduct(item))) {
            setCreateError('Solo se permiten productos del inventario. Selecciona cada ítem desde las sugerencias.');
            return;
        }
        if (paymentTerms.type === 'Crédito' && paymentTerms.days <= 0) {
            setCreateError('Para pago a crédito debes indicar días mayores a 0.');
            return;
        }
        const maxDiscountPct = normalizedItems.reduce((max, item) => Math.max(max, getEffectiveDiscountPct(item)), 0);
        const requiresApproval = isSellerRole && maxDiscountPct > SELLER_MAX_DISCOUNT_PCT;
        const hasPendingApproval = editingQuotation?.discount_approval?.status === 'pending';
        const shouldCreateApprovalRequest = requiresApproval && !hasPendingApproval;
        if (requiresApproval && !discountApprovalRequested) {
            setCreateError(`Si el precio neto manual supera ${SELLER_MAX_DISCOUNT_PCT}% de descuento del precio de sistema, debes usar "Pedir autorización".`);
            return;
        }
        if (shouldCreateApprovalRequest && !approvalReason.trim()) {
            setCreateError('Debes indicar la razón del sobre descuento antes de solicitar autorización.');
            return;
        }

        setSubmitting(true);
        setCreateError(null);

        try {
            let latitude: number | null = null;
            let longitude: number | null = null;
            const shouldCaptureSellerLocation = !(effectiveRole === 'facturador' && sellerIdForQuotation !== profile.id);

            if (manualLocation && shouldCaptureSellerLocation) {
                latitude = manualLocation.lat;
                longitude = manualLocation.lng;
                console.log("Using Manual Location:", manualLocation);
            } else if (shouldCaptureSellerLocation) {
                try {
                    const position = await checkGPSConnection({ showAlert: false, timeoutMs: 12000, retries: 1, minAccuracyMeters: 600 });
                    latitude = position.coords.latitude;
                    longitude = position.coords.longitude;
                } catch (gpsError) {
                    console.warn("GPS unavailable while creating quotation. Saving quotation and deferring location.", gpsError);
                }
            }

            // ... calculations ...
            const calculatedItems = normalizedItems.map(item => {
                const inventoryProduct = resolveInventoryProduct(item);
                const qty = parseInt(item.qty) || 1;
                const price = parseFloat(item.price) || 0;
                const netPrice = price > 0 ? Number(item.netPrice || price) : 0;
                const discount = price > 0 ? getEffectiveDiscountPct(item) : 0;
                return {
                    ...item,
                    product_id: inventoryProduct?.id || item.productId || null,
                    qty,
                    price,
                    net_price: netPrice,
                    unit: 'UN',
                    discount,
                    total: qty * netPrice
                };
            });
            const netAmount = calculatedItems.reduce((sum, item) => sum + item.total, 0);
            const tax = Math.round(netAmount * 0.19);
            const grandTotal = netAmount + tax;
            const requestedItems = buildDiscountApprovalRequestedItems(calculatedItems, SELLER_MAX_DISCOUNT_PCT);
            const sellerName = selectedSellerProfile?.full_name || selectedSellerProfile?.email?.split('@')[0]?.toUpperCase() || 'Vendedor';
            const sellerEmail = selectedSellerProfile?.email || null;
            const trimmedApprovalReason = approvalReason.trim();
            const shouldStartAsSent =
                !shouldCreateApprovalRequest
                && (selectedInteractionType === 'WhatsApp' || selectedInteractionType === 'Teléfono');
            const initialQuotationStatus = shouldStartAsSent ? 'sent' : 'draft';
            const initialSentAt = shouldStartAsSent ? new Date().toISOString() : null;

            // 3. Direct Insert (Bypassing RPC to ensure items are saved)
            if (editingQuotation) {
                const { error: updateError } = await supabase
                    .from('quotations')
                    .update({
                        seller_id: sellerIdForQuotation,
                        items: calculatedItems,
                        total_amount: grandTotal,
                        payment_terms: paymentTerms,
                        comments: formComments,
                    })
                    .eq('id', editingQuotation.id);

                if (updateError) throw updateError;
                if (shouldCreateApprovalRequest) {
                    const { data: approvalRow, error: approvalError } = await supabase
                        .from('approval_requests')
                        .insert({
                            module: 'sales',
                            entity_id: editingQuotation.id,
                            requester_id: profile.id,
                            approval_type: 'extra_discount',
                            payload: {
                                quotation_id: editingQuotation.id,
                                folio: editingQuotation.folio || null,
                                client_name: selectedClient?.name || null,
                                max_discount_pct: Number(maxDiscountPct.toFixed(2)),
                                limit_pct: SELLER_MAX_DISCOUNT_PCT,
                                total_amount: grandTotal,
                                request_reason: trimmedApprovalReason,
                                seller_name: sellerName,
                                seller_email: sellerEmail,
                                requested_items: requestedItems
                            },
                            status: 'pending'
                        } as any)
                        .select('id')
                        .single();
                    if (approvalError) throw approvalError;
                    if (approvalRow?.id) {
                        void notifyApprovalPush(approvalRow.id);
                    }
                }
                alert('Cotización actualizada correctamente');
            } else {
                const { data: insertData, error: insertError } = await supabase
                    .from('quotations')
                    .insert({
                        id: crypto.randomUUID(),
                        client_id: selectedClient.id,
                        seller_id: sellerIdForQuotation,
                        items: calculatedItems,
                        total_amount: grandTotal,
                        payment_terms: paymentTerms,
                        status: initialQuotationStatus,
                        sent_at: initialSentAt,
                        comments: formComments,
                        interaction_type: selectedInteractionType,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (insertError) throw insertError;
                if (shouldStartAsSent && insertData?.id) {
                    await markQuotationAsSent(insertData.id);
                }
                if (shouldCreateApprovalRequest && insertData) {
                    const { data: approvalRow, error: approvalError } = await supabase
                        .from('approval_requests')
                        .insert({
                            module: 'sales',
                            entity_id: insertData.id,
                            requester_id: profile.id,
                            approval_type: 'extra_discount',
                            payload: {
                                quotation_id: insertData.id,
                                folio: insertData.folio || null,
                                client_name: selectedClient?.name || null,
                                max_discount_pct: Number(maxDiscountPct.toFixed(2)),
                                limit_pct: SELLER_MAX_DISCOUNT_PCT,
                                total_amount: grandTotal,
                                request_reason: trimmedApprovalReason,
                                seller_name: sellerName,
                                seller_email: sellerEmail,
                                requested_items: requestedItems
                            },
                            status: 'pending'
                        } as any)
                        .select('id')
                        .single();
                    if (approvalError) throw approvalError;
                    if (approvalRow?.id) {
                        void notifyApprovalPush(approvalRow.id);
                    }
                }

                let locationNotice = '';
                if (latitude !== null && longitude !== null && insertData) {
                    const locationResult = await queueQuotationLocation({
                        seller_id: sellerIdForQuotation,
                        quotation_id: insertData.id,
                        lat: latitude,
                        lng: longitude
                    });

                    if (locationResult.queued) {
                        locationNotice = ' Ubicación guardada en cola y se sincronizará cuando vuelva la conexión.';
                    }
                } else {
                    locationNotice = ' Cotización creada sin coordenadas GPS (puedes usar ubicación manual en próximas capturas).';
                }

                const folioLabel = insertData?.folio ? `#${insertData.folio}` : `ID ${insertData.id.slice(0, 8)}`;
                alert(`Cotización ${folioLabel} creada con éxito.${locationNotice}`);
            }

            // Reset and refresh
            setIsItemModalOpen(false);
            setFormItems([{ productId: null, code: '', detail: '', qty: 1, price: 0, discountPct: 0, netPrice: 0 }]);
            setFormComments('');
            setPaymentTerms({ type: 'Contado', days: 0 });
            setSelectedClient(null);
            setCreateError(null);
            setEditingQuotation(null);
            setDiscountApprovalRequested(false);
            setApprovalReason('');
            setApprovalReasonError(null);
            setIsApprovalReasonModalOpen(false);
            setSelectedSellerId((prev) => effectiveRole === 'facturador' ? prev : profile.id);
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

    useEffect(() => {
        if (isClientModalOpen) setClientSelectorSearch('');
    }, [isClientModalOpen]);
    const executeConvertToOrder = useCallback(async (quotation: any, proofFile: File | null) => {
        if (!profile?.id) {
            alert('No se pudo identificar el usuario actual. Cierra y vuelve a iniciar sesión.');
            return;
        }
        if (quotation?.seller_id !== profile.id) {
            alert('Solo el vendedor dueño de la cotización puede convertirla a pedido.');
            return;
        }
        if (quotation?.discount_approval?.status === 'pending' || quotation?.discount_approval?.status === 'rejected') {
            alert('Esta cotización no se puede vender hasta resolver la aprobación de descuento.');
            return;
        }

        const creditDays = getQuotationCreditDays(quotation);
        const requiresProof = creditDays === 0;
        const validationError = requiresProof ? validatePaymentProofFile(proofFile) : null;
        if (validationError) {
            setPaymentProofError(validationError);
            return;
        }

        setSubmitting(true);
        let uploadedProof: { path: string; name: string; mimeType: string } | null = null;
        let createdOrderId: string | null = null;

        try {
            if (requiresProof && proofFile) {
                uploadedProof = await uploadPaymentProof(quotation, proofFile);
            }

            const { data, error } = await supabase.rpc('convert_quotation_to_order', {
                p_quotation_id: quotation.id,
                p_user_id: profile.id,
                p_payment_proof_path: uploadedProof?.path ?? null,
                p_payment_proof_name: uploadedProof?.name ?? null,
                p_payment_proof_mime_type: uploadedProof?.mimeType ?? null
            });

            if (error) throw error;

            const response = (data || {}) as any;
            if (response?.already_exists) {
                closePaymentProofModal();
                alert('Esta cotización ya tenía un pedido asociado. Revisa el módulo de Pedidos para su estado de correo.');
                fetchQuotations();
                return;
            }

            createdOrderId = response?.order_id || null;
            const orderFolio = response?.order_folio || response?.order_id?.slice?.(0, 8) || 'N/A';

            try {
                await sendOrderNotificationEmail({
                    orderId: createdOrderId || response?.order_id,
                    requestSource: 'quotation_conversion',
                    order: buildOrderEmailPayload(quotation, orderFolio),
                });
                alert('Pedido generado y correo enviado a facturación correctamente.');
            } catch (emailError: any) {
                alert('Pedido generado, pero el correo a facturación falló. Puedes reenviarlo desde el módulo de Pedidos.');
            }

            closePaymentProofModal();
            fetchQuotations();
        } catch (error: any) {
            if (uploadedProof?.path && !createdOrderId) {
                await supabase.storage.from(PAYMENT_PROOFS_BUCKET).remove([uploadedProof.path]);
            }
            console.error('Error converting to order:', error);
            alert('Error al generar la venta: ' + (error.message || error.details || error));
        } finally {
            setSubmitting(false);
        }
    }, [
        buildOrderEmailPayload,
        closePaymentProofModal,
        fetchQuotations,
        getQuotationCreditDays,
        profile?.id,
        uploadPaymentProof,
        validatePaymentProofFile
    ]);

    const handleConvertToOrder = async (quotation: any) => {
        if (!confirm('¿Confirmar que el cliente aceptó esta cotización? Se generará un pedido y se enviará a facturación desde el buzón corporativo.')) return;
        if (!profile?.id) {
            alert('No se pudo identificar el usuario actual. Cierra y vuelve a iniciar sesión.');
            return;
        }
        if (quotation?.seller_id !== profile.id) {
            alert('Solo el vendedor dueño de la cotización puede convertirla a pedido.');
            return;
        }

        const creditDays = getQuotationCreditDays(quotation);
        if (creditDays === 0) {
            setQuotationPendingOrder(quotation);
            setPaymentProofFile(null);
            setPaymentProofError(null);
            return;
        }

        await executeConvertToOrder(quotation, null);
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

    const filteredQuotations = useMemo(() => {
        const searchLower = quotationSearch.trim().toLowerCase();
        const filtered = quotations
            .filter((q) => {
                if (activeFilter === 'All') return true;
                if (activeFilter === 'Draft') return q.status === 'draft';
                if (activeFilter === 'Sent') return q.status === 'sent';
                if (activeFilter === 'Approved') return q.status === 'approved';
                return true;
            })
            .filter((q) => {
                if (!searchLower) return true;
                return q.client_name?.toLowerCase().includes(searchLower) || q.folio?.toString().includes(searchLower);
            });

        if (effectiveRole !== 'seller') return filtered;

        return [...filtered].sort((a, b) => {
            const aPending = a.discount_approval?.status === 'pending' && a.seller_id === profile?.id ? 1 : 0;
            const bPending = b.discount_approval?.status === 'pending' && b.seller_id === profile?.id ? 1 : 0;
            if (aPending !== bPending) return bPending - aPending;
            const aDate = new Date(a.created_at || 0).getTime();
            const bDate = new Date(b.created_at || 0).getTime();
            return bDate - aDate;
        });
    }, [quotations, activeFilter, quotationSearch, effectiveRole, profile?.id]);

    const quotationStats = useMemo(() => {
        const drafts = quotations.filter((q) => q.status === 'draft').length;
        const sent = quotations.filter((q) => q.status === 'sent').length;
        const approved = quotations.filter((q) => q.status === 'approved').length;
        const totalAmount = quotations.reduce((acc, q) => acc + Number(q.total_amount || 0), 0);
        return { total: quotations.length, drafts, sent, approved, totalAmount };
    }, [quotations]);
    const pendingApprovalMineCount = useMemo(() => {
        if (effectiveRole !== 'seller') return 0;
        return filteredQuotations.filter((q) => q.discount_approval?.status === 'pending' && q.seller_id === profile?.id).length;
    }, [filteredQuotations, effectiveRole, profile?.id]);
    const formMaxDiscountPct = useMemo(() => {
        return formItems.reduce((max, item) => Math.max(max, getEffectiveDiscountPct(item)), 0);
    }, [formItems, getEffectiveDiscountPct]);
    const formSubtotal = useMemo(() => {
        return formItems.reduce((sum, item) => {
            const qty = Number(item.qty || 0);
            const unitNet = Number(item.netPrice ?? item.price ?? 0);
            return sum + (qty * unitNet);
        }, 0);
    }, [formItems]);
    const formTax = useMemo(() => Math.round(formSubtotal * 0.19), [formSubtotal]);
    const formGrandTotal = useMemo(() => formSubtotal + formTax, [formSubtotal, formTax]);
    const formItemCount = useMemo(() => {
        return formItems.reduce((count, item) => count + (Number(item.qty || 0) > 0 ? Number(item.qty || 0) : 0), 0);
    }, [formItems]);
    const selectedSellerProfile = useMemo(() => {
        if (!selectedSellerId) return null;
        if (profile?.id === selectedSellerId) {
            return {
                id: profile.id,
                full_name: profile.full_name || null,
                email: profile.email || null,
                role: effectiveRole,
                status: profile.status || null
            } as SellerOption;
        }
        return availableSellers.find((seller) => seller.id === selectedSellerId) || null;
    }, [availableSellers, effectiveRole, profile?.email, profile?.full_name, profile?.id, profile?.status, selectedSellerId]);

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
                        value={quotationSearch}
                        onChange={(e) => setQuotationSearch(e.target.value)}
                    />
                </div>
                <div className="flex gap-2">
                    {FILTER_OPTIONS.map((filter) => (
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

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Total</p>
                    <p className="text-2xl font-black text-gray-900 mt-1">{quotationStats.total}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Borrador</p>
                    <p className="text-2xl font-black text-gray-700 mt-1">{quotationStats.drafts}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Enviadas</p>
                    <p className="text-2xl font-black text-blue-600 mt-1">{quotationStats.sent}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Aprobadas</p>
                    <p className="text-2xl font-black text-emerald-600 mt-1">{quotationStats.approved}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4 col-span-2 md:col-span-1">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-wider">Total cotizado</p>
                    <p className="text-xl font-black text-indigo-600 mt-1">{formatMoney(quotationStats.totalAmount)}</p>
                </div>
            </div>

            {fetchError && (
                <div className="p-4 rounded-2xl border border-red-100 bg-red-50 text-red-700 text-sm font-medium">
                    {fetchError}
                </div>
            )}

            {effectiveRole === 'seller' && pendingApprovalMineCount > 0 && (
                <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-800 text-sm font-bold">
                    Tienes {pendingApprovalMineCount} cotización(es) pendiente(s) de aprobación. Se muestran primero en el listado.
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {loading ? (
                    Array(4).fill(0).map((_, i) => (
                        <div key={i} className="bg-white rounded-2xl p-4 h-32 animate-pulse shadow-sm"></div>
                    ))
                ) : filteredQuotations.length === 0 ? (
                    <div className="md:col-span-2 bg-white rounded-[2rem] border border-gray-100 p-12 text-center">
                        <p className="text-lg font-black text-gray-900">No hay cotizaciones para este filtro</p>
                        <p className="text-sm text-gray-500 mt-2">Ajusta búsqueda o estado para ver resultados.</p>
                    </div>
                ) : (
                    filteredQuotations.map((q) => {
                        const hasPendingDiscountBlock = q.discount_approval?.status === 'pending' || q.discount_approval?.status === 'rejected';
                        const hasWhatsappTarget = Boolean(normalizePhoneForWhatsapp(q.client_phone || q.client?.phone));
                        const hasEmailTarget = Boolean(String(q.client_email || q.client?.email || '').trim());
                        const canConvertOrder = q.seller_id === profile?.id;

                        return (
                        <div key={q.id} className="premium-card p-4 flex flex-col justify-between group">
                            <div className="space-y-3">
                                <div className="flex justify-between items-start">
                                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center border border-indigo-100 text-indigo-600 font-black text-sm uppercase shadow-sm">
                                        {(q.client_name || 'CL').substring(0, 2)}
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="flex gap-1">
                                            {/* Stage Badge */}
                                            {q.stage && (
                                                <span className={`px-1.5 py-0.5 rounded-md text-[7px] font-black uppercase tracking-wide border ${q.stage === 'won' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                                    q.stage === 'lost' ? 'bg-red-100 text-red-700 border-red-200' :
                                                        q.stage === 'sent' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                                        q.stage === 'negotiation' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                                            q.stage === 'contacted' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                                                                'bg-gray-100 text-gray-600 border-gray-200'
                                                    }`}>
                                                    {q.stage === 'won' ? 'Ganada' :
                                                        q.stage === 'lost' ? 'Perdida' :
                                                            q.stage === 'sent' ? 'Enviada' :
                                                            q.stage === 'negotiation' ? 'Negociación' :
                                                        q.stage === 'contacted' ? 'Contactado' : 'Nueva'}
                                                </span>
                                            )}
                                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border shadow-sm ${getStatusStyles(q.status)}`}>
                                                {getStatusLabel(q.status)}
                                            </span>
                                        </div>
                                        {q.interaction_type && (
                                            <span className={`px-1.5 py-0.5 rounded-md text-[7px] font-bold uppercase tracking-wide border ${q.interaction_type === 'Presencial' ? 'bg-purple-50 text-purple-700 border-purple-100' :
                                                q.interaction_type === 'WhatsApp' ? 'bg-green-50 text-green-700 border-green-100' :
                                                    'bg-blue-50 text-blue-700 border-blue-100'
                                                }`}>
                                                {q.interaction_type}
                                            </span>
                                        )}
                                        <p className="text-[9px] font-bold text-gray-400 italic">Folio {q.folio || 'N/A'}</p>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-base font-black text-gray-900 group-hover:text-indigo-600 transition-colors truncate uppercase tracking-tight" title={q.client_name}>
                                        {q.client_name}
                                    </h3>
                                    <div className="flex items-center text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                                        <Clock size={11} className="mr-1 text-indigo-400" />
                                        <span>{new Date(q.created_at).toLocaleDateString()}</span>
                                        <span className="mx-1.5 text-gray-200">|</span>
                                        <span>{new Date(q.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 py-2 border-t border-gray-50">
                                    <div>
                                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest mb-1">Vendedor</p>
                                        <p className="text-[11px] font-bold text-gray-700 truncate">{q.seller_name}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest mb-1">Total Cotizado</p>
                                        <p className="text-xs font-black text-indigo-600">{formatMoney(q.total_amount)}</p>
                                    </div>
                                </div>

                                <div className="px-3 py-2 bg-gray-50/60 rounded-xl border border-gray-100">
                                    <p className="text-[9px] font-bold text-gray-500 uppercase truncate">
                                        {q.client_contact || 'Sin contacto'} | {q.client_phone || 'Sin teléfono'}
                                    </p>
                                </div>

                                {q.sent_at && (
                                    <div className="px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
                                        <p className="text-[9px] font-black text-blue-700 uppercase tracking-wider">
                                            Enviada a cliente
                                        </p>
                                        <p className="text-[10px] font-bold text-blue-600">
                                            {new Date(q.sent_at).toLocaleDateString('es-CL')} {new Date(q.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="pt-3 mt-auto space-y-2">
                                <button
                                    onClick={() => setSelectedForTemplate(q)}
                                    className="w-full bg-gray-900 text-white py-2 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all flex items-center justify-center hover:bg-indigo-700 hover:shadow-indigo-100"
                                >
                                    <Eye size={12} className="mr-1.5" />
                                    Ver Documento
                                </button>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => openQuoteViaWhatsApp(q)}
                                        disabled={!hasWhatsappTarget || hasPendingDiscountBlock}
                                        className={`flex-1 min-w-[78px] px-2 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm border active:scale-95 transition-all flex items-center justify-center ${!hasWhatsappTarget || hasPendingDiscountBlock
                                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                                : 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-600 hover:text-white'
                                            }`}
                                        title={
                                            hasPendingDiscountBlock
                                                ? 'Cotización bloqueada por aprobación de descuento'
                                                : hasWhatsappTarget
                                                    ? 'Enviar por WhatsApp'
                                                    : 'Cliente sin celular válido'
                                        }
                                    >
                                        <MessageSquare size={12} className="mr-1" />
                                        WSP
                                    </button>

                                    <button
                                        onClick={() => openQuoteViaEmail(q)}
                                        disabled={!hasEmailTarget || hasPendingDiscountBlock}
                                        className={`flex-1 min-w-[86px] px-2 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm border active:scale-95 transition-all flex items-center justify-center ${!hasEmailTarget || hasPendingDiscountBlock
                                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                                : 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-600 hover:text-white'
                                            }`}
                                        title={
                                            hasPendingDiscountBlock
                                                ? 'Cotización bloqueada por aprobación de descuento'
                                                : hasEmailTarget
                                                    ? 'Compartir PDF con correo como respaldo'
                                                    : 'Cliente sin correo'
                                        }
                                    >
                                        <Share2 size={12} className="mr-1" />
                                        Compartir
                                    </button>

                                    {q.status !== 'approved' && (
                                        <button
                                            onClick={() => handleConvertToOrder(q)}
                                            disabled={submitting || q.status === 'rejected' || hasPendingDiscountBlock || !canConvertOrder}
                                            className={`flex-1 min-w-[110px] px-2 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm border active:scale-95 transition-all flex items-center justify-center ${submitting || q.status === 'rejected' || hasPendingDiscountBlock || !canConvertOrder
                                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                                : 'bg-green-50 text-green-600 border-green-100 hover:bg-green-600 hover:text-white'
                                                }`}
                                            title={canConvertOrder ? 'Convertir en Pedido' : 'Solo el vendedor dueño puede convertir y enviar el correo'}
                                        >
                                            <ShoppingBag size={12} className="mr-1" />
                                            {q.status === 'sent' ? 'Cerrar Venta' : 'Vender'}
                                        </button>
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    {q.discount_approval?.status && (
                                        <span className={`px-1.5 py-1 rounded-lg text-[8px] font-black uppercase border ${q.discount_approval.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-100' : q.discount_approval.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                            Desc. {q.discount_approval.status === 'pending' ? 'Pendiente' : q.discount_approval.status === 'approved' ? 'Aprobado' : 'Rechazado'}
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1 ml-auto">
                                        {q.location && (
                                            <button
                                                onClick={() => setSelectedLocation(q)}
                                                className="p-2 bg-white text-gray-400 rounded-lg border border-gray-100 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                                                title="Ver Ubicación"
                                            >
                                                <MapPin size={14} />
                                            </button>
                                        )}
                                        {(isSupervisor || q.seller_id === profile?.id) && (
                                            <>
                                                <button
                                                    onClick={() => handleEditQuotation(q)}
                                                    className="p-2 bg-white text-gray-400 rounded-lg border border-gray-100 hover:text-amber-600 hover:bg-amber-50 transition-all"
                                                    title="Editar"
                                                >
                                                    <Edit2 size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteQuotation(q.id)}
                                                    disabled={isDeleting === q.id}
                                                    className={`p-2 bg-white text-gray-400 rounded-lg border border-gray-100 hover:text-red-600 hover:bg-red-50 transition-all ${isDeleting === q.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    title="Eliminar"
                                                >
                                                    {isDeleting === q.id ? (
                                                        <div className="w-4 h-4 border-2 border-red-600 border-t-transparent animate-spin rounded-full"></div>
                                                    ) : (
                                                        <Trash2 size={14} />
                                                    )}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )})
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
                    <Suspense fallback={<div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm" />}>
                        {(() => {
                            const discountApprovalStatus = selectedForTemplate.discount_approval?.status as string | undefined;
                            const blockedByDiscountApproval = discountApprovalStatus === 'pending' || discountApprovalStatus === 'rejected';
                            const shareBlockReason = discountApprovalStatus === 'pending'
                                ? 'Descuento adicional pendiente de aprobación: no se puede enviar ni descargar hasta su resolución.'
                                : discountApprovalStatus === 'rejected'
                                    ? 'Descuento adicional rechazado: ajusta la cotización o solicita nueva aprobación.'
                                    : undefined;

                            return (
                        <QuotationTemplate
                            data={buildQuotationPreviewData(
                                selectedForTemplate,
                                formatPaymentTermsFromCreditDays(getClientCreditDays(selectedForTemplate.client))
                            )}
                            onSendEmail={(pdfAttachment) => openQuoteViaEmail(selectedForTemplate, pdfAttachment)}
                            onMarkedAsSent={async () => {
                                await markQuotationAsSent(selectedForTemplate.id);
                            }}
                            canShareAndDownload={!blockedByDiscountApproval}
                            shareBlockReason={shareBlockReason}
                            onClose={() => setSelectedForTemplate(null)}
                        />
                            );
                        })()}
                    </Suspense>
                )
            }

            {/* Client Selector Modal */}
            {
                isApprovalReasonModalOpen && (
                    <div className="fixed inset-0 z-[2050] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                            <div className="p-6 bg-gradient-to-br from-amber-500 to-orange-600 text-white flex justify-between items-center">
                                <div>
                                    <h3 className="font-bold text-lg">Razón del sobre descuento</h3>
                                    <p className="text-white/80 text-sm">Este motivo se enviará a aprobación.</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setIsApprovalReasonModalOpen(false);
                                        setApprovalReasonError(null);
                                    }}
                                    className="p-2 hover:bg-white/20 rounded-full transition-all"
                                >
                                    <XIcon size={20} />
                                </button>
                            </div>

                            <div className="p-6 space-y-4">
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-medium text-amber-900">
                                    Describe por qué esta cotización necesita un descuento superior al {SELLER_MAX_DISCOUNT_PCT}% permitido para vendedor.
                                </div>

                                <textarea
                                    value={approvalReason}
                                    onChange={(e) => {
                                        setApprovalReason(e.target.value);
                                        if (approvalReasonError) setApprovalReasonError(null);
                                    }}
                                    placeholder="Ej: negociación por volumen, cierre de oportunidad, ajuste comercial aprobado con cliente clave..."
                                    className="w-full min-h-[140px] rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                                    autoFocus
                                />

                                {approvalReasonError && (
                                    <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                                        {approvalReasonError}
                                    </div>
                                )}

                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsApprovalReasonModalOpen(false);
                                            setApprovalReasonError(null);
                                        }}
                                        className="flex-1 px-4 py-3 rounded-2xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-all"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!approvalReason.trim()) {
                                                setApprovalReasonError('Debes escribir la razón del sobre descuento.');
                                                return;
                                            }
                                            setDiscountApprovalRequested(true);
                                            setApprovalReason(approvalReason.trim());
                                            setApprovalReasonError(null);
                                            setCreateError(null);
                                            setIsApprovalReasonModalOpen(false);
                                        }}
                                        className="flex-1 px-4 py-3 rounded-2xl bg-amber-600 text-white font-bold hover:bg-amber-700 transition-all"
                                    >
                                        Guardar motivo
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

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
                                        value={clientSelectorSearch}
                                        onChange={(e) => setClientSelectorSearch(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                                    {availableClients
                                        .filter(c => c.name.toLowerCase().includes(clientSelectorSearch.toLowerCase()))
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
                                    {availableClients.filter(c => c.name.toLowerCase().includes(clientSelectorSearch.toLowerCase())).length === 0 && (
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

            {
                quotationPendingOrder && (
                    <div className="fixed inset-0 z-[2100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
                            <div className="p-6 bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex justify-between items-center">
                                <div>
                                    <h3 className="font-bold text-lg">Comprobante de Pago</h3>
                                    <p className="text-white/80 text-sm">{quotationPendingOrder.client_name}</p>
                                </div>
                                <button onClick={closePaymentProofModal} className="p-2 hover:bg-white/20 rounded-full transition-all">
                                    <XIcon size={20} />
                                </button>
                            </div>

                            <div className="p-6 space-y-4">
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-medium text-amber-900">
                                    Este cliente no tiene crédito. Debes adjuntar el comprobante de pago para generar el pedido y enviar el correo a soporte y amerino.
                                </div>

                                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Archivos permitidos</p>
                                    <p className="mt-1 text-sm font-bold text-gray-700">PDF, JPG, JPEG, PNG, WEBP hasta 20MB</p>
                                </div>

                                <div className="space-y-3">
                                    <input
                                        type="file"
                                        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0] || null;
                                            setPaymentProofFile(file);
                                            setPaymentProofError(file ? validatePaymentProofFile(file) : null);
                                        }}
                                        className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-xl file:border-0 file:bg-emerald-600 file:px-4 file:py-3 file:font-bold file:text-white hover:file:bg-emerald-700"
                                    />
                                    {paymentProofFile && (
                                        <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
                                            <p className="text-sm font-bold text-gray-800">{paymentProofFile.name}</p>
                                            <p className="text-xs text-gray-500 mt-1">{(paymentProofFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                    )}
                                    {paymentProofError && (
                                        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                                            {paymentProofError}
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={closePaymentProofModal}
                                        className="flex-1 px-4 py-3 rounded-2xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50 transition-all"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => executeConvertToOrder(quotationPendingOrder, paymentProofFile)}
                                        disabled={submitting}
                                        className="flex-1 px-4 py-3 rounded-2xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center"
                                    >
                                        {submitting ? (
                                            <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                                        ) : (
                                            <>
                                                <Upload size={16} className="mr-2" />
                                                Generar Pedido
                                            </>
                                        )}
                                    </button>
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
                                    {effectiveRole === 'admin' && (
                                        <button
                                            onClick={() => setIsLocationPickerOpen(true)}
                                            className={`p-2 rounded-full transition-all border ${manualLocation ? 'bg-green-400 text-white border-green-500' : 'bg-white/10 border-white/20 hover:bg-white/20'}`}
                                            title={manualLocation ? "Ubicación Simulada Activa" : "Simular Ubicación en Mapa"}
                                        >
                                            <MapPin size={20} />
                                        </button>
                                    )}
                                    <button onClick={() => setIsItemModalOpen(false)} className="p-2 hover:bg-white/20 rounded-full transition-all">
                                        <XIcon size={20} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 overflow-y-auto">
                                {isSellerRole && (
                                    <div className="mb-4 p-3 rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-800 text-xs font-bold">
                                        Vista comercial: costos y márgenes internos no se muestran en esta pantalla.
                                        <div className="mt-1 font-semibold">
                                            Puedes editar precio neto manual. Si supera {SELLER_MAX_DISCOUNT_PCT}% de descuento, se solicitará autorización.
                                        </div>
                                    </div>
                                )}
                                {effectiveRole === 'facturador' && (
                                    <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                                        <label className="text-[10px] uppercase font-black tracking-widest text-indigo-500">Vendedor asignado</label>
                                        <select
                                            value={selectedSellerId || ''}
                                            onChange={(e) => setSelectedSellerId(e.target.value || null)}
                                            className="mt-3 w-full rounded-2xl border border-indigo-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="">Selecciona un vendedor</option>
                                            {availableSellers.map((seller) => (
                                                <option key={seller.id} value={seller.id}>
                                                    {(seller.full_name || seller.email || 'Usuario').toUpperCase()}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="mt-2 text-xs font-medium text-indigo-700">
                                            La cotización quedará asignada al vendedor seleccionado y seguirá su flujo normal dentro del CRM.
                                        </p>
                                    </div>
                                )}
                                <h4 className="font-bold text-gray-700 mb-4 flex items-center"><ShoppingBag size={18} className="mr-2 text-indigo-500" /> Ítems</h4>

                                <div className="space-y-4">
                                    {formItems.map((item, index) => (
                                        <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100 relative group">
                                            {(() => {
                                                const resolvedProduct = resolveInventoryProduct(item);
                                                const allowManualUnitPrice = !isSellerRole || isDispatchServiceProduct(resolvedProduct);
                                                const allowManualNetPrice = !isSellerRole || Boolean(resolvedProduct);
                                                return (
                                                    <>
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
                                                        newItems[index].productId = null;
                                                        setFormItems(newItems);

                                                        if (val.length > 1) {
                                                            const filtered = products.filter(p => p.sku?.toLowerCase().includes(val.toLowerCase()));
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
                                                    <div
                                                        className="absolute z-50 w-64 max-h-72 overflow-y-auto overscroll-contain bg-white border border-gray-100 rounded-xl shadow-2xl mt-1"
                                                        onMouseDown={(e) => e.preventDefault()}
                                                    >
                                                        {suggestions.map((p, i) => (
                                                            <button
                                                                key={i}
                                                                className="w-full text-left px-4 py-3 hover:bg-gray-50 flex flex-col border-b border-gray-50 last:border-0"
                                                                onClick={() => {
                                                                    const newItems = [...formItems];
                                                                    newItems[index] = {
                                                                        ...newItems[index],
                                                                        productId: p.id || null,
                                                                        code: p.sku || '',
                                                                        detail: p.name,
                                                                        price: p.price || 0,
                                                                        discountPct: 0,
                                                                        netPrice: p.price || 0
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
                                                        newItems[index].productId = null;
                                                        setFormItems(newItems);

                                                        if (val.length > 2) {
                                                            const filtered = products.filter(p => p.name?.toLowerCase().includes(val.toLowerCase()));
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
                                                    <div
                                                        className="absolute z-50 w-full max-h-72 overflow-y-auto overscroll-contain bg-white border border-gray-100 rounded-xl shadow-2xl mt-1"
                                                        onMouseDown={(e) => e.preventDefault()}
                                                    >
                                                        {suggestions.map((p, i) => (
                                                            <button
                                                                key={i}
                                                                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0"
                                                                onClick={() => {
                                                                    const newItems = [...formItems];
                                                                    newItems[index] = {
                                                                        ...newItems[index],
                                                                        productId: p.id || null,
                                                                        code: p.sku || '',
                                                                        detail: p.name,
                                                                        price: p.price || 0,
                                                                        discountPct: 0,
                                                                        netPrice: p.price || 0
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
                                                    disabled={!allowManualUnitPrice}
                                                    className={`w-full border rounded-lg px-3 py-2 text-sm font-medium outline-none ${allowManualUnitPrice
                                                        ? 'bg-white border-gray-200 focus:ring-2 focus:ring-indigo-500'
                                                        : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                                        }`}
                                                    placeholder="$ 0"
                                                    value={item.price}
                                                    onChange={(e) => {
                                                        if (!allowManualUnitPrice) return;
                                                        const price = parseFloat(e.target.value) || 0;
                                                        applyItemPricing(index, (current) => ({ ...current, price, netPrice: price }));
                                                    }}
                                                />
                                            </div>
                                            <div className="col-span-1 md:col-span-2">
                                                <label className="text-[10px] uppercase font-bold text-gray-400">% Desc</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    value={item.discountPct || 0}
                                                    onChange={(e) => {
                                                        const discountPct = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
                                                        applyItemPricing(index, (current) => {
                                                            const listPrice = Number(current.price || 0);
                                                            const netPrice = listPrice > 0 ? listPrice * (1 - (discountPct / 100)) : 0;
                                                            return { ...current, discountPct, netPrice };
                                                        });
                                                    }}
                                                />
                                            </div>
                                            <div className="col-span-1 md:col-span-3">
                                                <label className="text-[10px] uppercase font-bold text-gray-400">Precio Neto</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    disabled={!allowManualNetPrice}
                                                    className={`w-full border rounded-lg px-3 py-2 text-sm font-medium outline-none ${allowManualNetPrice
                                                        ? 'bg-white border-gray-200 focus:ring-2 focus:ring-indigo-500'
                                                        : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                                                        }`}
                                                    value={item.netPrice ?? item.price ?? 0}
                                                    onChange={(e) => {
                                                        if (!allowManualNetPrice) return;
                                                        const netPrice = Math.max(0, parseFloat(e.target.value) || 0);
                                                        applyItemPricing(index, (current) => ({ ...current, netPrice }));
                                                    }}
                                                />
                                            </div>
                                            <div className="col-span-1 md:col-span-12 flex items-end justify-between md:justify-end gap-3">
                                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                                                    Desc. aplicado: {getEffectiveDiscountPct(item).toFixed(2)}%
                                                </p>
                                                <p className="font-black text-lg text-gray-700">$ {((item.qty || 0) * ((item.netPrice || item.price) || 0)).toLocaleString()}</p>
                                            </div>
                                                    </>
                                                );
                                            })()}

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
                                        onClick={() => setFormItems([...formItems, { productId: null, code: '', detail: '', qty: 1, price: 0, discountPct: 0, netPrice: 0 }])}
                                        className="w-full py-3 border-2 border-dashed border-indigo-200 rounded-xl text-indigo-500 font-bold hover:bg-indigo-50 transition-all flex items-center justify-center"
                                    >
                                        <Plus size={18} className="mr-2" /> Agregar otro ítem
                                    </button>
                                </div>

                                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="text-xs uppercase font-bold text-gray-400 mb-2 block">Condición de Pago</label>
                                        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4">
                                            <p className="text-lg font-black text-indigo-700">{formatPaymentTermsFromCreditDays(getClientCreditDays(selectedClient))}</p>
                                            <p className="mt-1 text-xs font-medium text-indigo-600">
                                                Se toma automáticamente desde la ficha del cliente y no se puede modificar en la cotización.
                                            </p>
                                        </div>
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

                                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="rounded-2xl border border-gray-100 bg-white p-4">
                                        <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Resumen comercial</p>
                                        <div className="mt-3 space-y-2 text-sm">
                                            <div className="flex justify-between font-medium text-gray-600">
                                                <span>Unidades</span>
                                                <span>{formItemCount}</span>
                                            </div>
                                            <div className="flex justify-between font-medium text-gray-600">
                                                <span>Subtotal</span>
                                                <span>{formatMoney(formSubtotal)}</span>
                                            </div>
                                            <div className="flex justify-between font-medium text-gray-600">
                                                <span>IVA (19%)</span>
                                                <span>{formatMoney(formTax)}</span>
                                            </div>
                                            <div className="pt-2 border-t border-gray-100 flex justify-between font-black text-indigo-700">
                                                <span>Total final</span>
                                                <span>{formatMoney(formGrandTotal)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                                        <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Estado de descuento</p>
                                        <p className={`mt-2 text-sm font-bold ${formMaxDiscountPct > SELLER_MAX_DISCOUNT_PCT ? 'text-red-600' : 'text-emerald-600'}`}>
                                            Máximo aplicado: {formMaxDiscountPct.toFixed(2)}%
                                        </p>
                                        {isSellerRole && formMaxDiscountPct > SELLER_MAX_DISCOUNT_PCT && (
                                            <p className="mt-2 text-xs font-medium text-red-600">
                                                Supera el {SELLER_MAX_DISCOUNT_PCT}%. Debes solicitar autorización para guardar.
                                            </p>
                                        )}
                                        {isSellerRole && discountApprovalRequested && approvalReason.trim() && (
                                            <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                                                <p className="text-[10px] uppercase tracking-widest font-black text-amber-500">Motivo registrado</p>
                                                <p className="mt-1 text-xs font-medium text-amber-800 line-clamp-3">{approvalReason.trim()}</p>
                                            </div>
                                        )}
                                        {isSellerRole && formMaxDiscountPct <= SELLER_MAX_DISCOUNT_PCT && (
                                            <p className="mt-2 text-xs font-medium text-gray-500">
                                                Dentro del límite permitido para vendedor.
                                            </p>
                                        )}
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
                                        {formatMoney(formGrandTotal)}
                                    </p>
                                    {isSellerRole && (
                                        <p className={`text-xs font-bold mt-1 ${formMaxDiscountPct > SELLER_MAX_DISCOUNT_PCT ? 'text-red-600' : 'text-gray-500'}`}>
                                            Máx descuento aplicado: {formMaxDiscountPct.toFixed(2)}% (límite vendedor {SELLER_MAX_DISCOUNT_PCT}%)
                                        </p>
                                    )}
                                </div>
                                <div className="w-full md:w-auto flex gap-2">
                                    {isSellerRole && formMaxDiscountPct > SELLER_MAX_DISCOUNT_PCT && (
                                        <button
                                            onClick={() => {
                                                setApprovalReasonError(null);
                                                setIsApprovalReasonModalOpen(true);
                                            }}
                                            className={`w-full md:w-auto px-6 py-3 md:py-4 rounded-2xl font-bold transition-all border ${discountApprovalRequested ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'}`}
                                        >
                                            {discountApprovalRequested ? 'Editar motivo autorización' : 'Pedir autorización'}
                                        </button>
                                    )}
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
            {!loading && quotations.length === 0 && (
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
            )}
        </div>
    );
};

export default Quotations;
