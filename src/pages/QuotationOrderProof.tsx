import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, FileText, Image as ImageIcon, Upload } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { sendOrderNotificationEmail } from '../utils/orderEmail';
import { logQuotationOrderConversionSafe } from '../utils/quotationOrderConversionLog';
import { formatPaymentTermsFromCreditDays, getClientCreditDays } from '../utils/credit';
import { convertHeicToJpeg, isHeicLikeFile } from '../utils/heic';

const PAYMENT_PROOFS_BUCKET = 'payment-proofs';
const PAYMENT_PROOF_MAX_BYTES = 20 * 1024 * 1024;
const ORDER_CONVERSION_TIMEOUT_MS = 60_000;
const PROOF_ROUTE_DRAFT_KEY = 'quotation_order_proof_route';
const PROOF_ROUTE_RESTORE_MESSAGE = 'La app se recargó mientras seleccionabas el comprobante. Vuelve a elegir el archivo y luego genera el pedido.';
const allowedPaymentProofExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

type ProofRouteDraft = {
    quotationId: string;
    actorId: string;
    pendingPicker: boolean;
    updatedAt: string;
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
};

const toWholeMoney = (value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.round(parsed));
};

const QuotationOrderProof = () => {
    const navigate = useNavigate();
    const { quotationId } = useParams<{ quotationId: string }>();
    const { profile } = useUser();

    const [quotation, setQuotation] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
    const [paymentProofError, setPaymentProofError] = useState<string | null>(null);
    const [paymentProofPreparing, setPaymentProofPreparing] = useState(false);
    const [orderConversionStage, setOrderConversionStage] = useState<string | null>(null);

    const paymentProofImageInputRef = useRef<HTMLInputElement | null>(null);
    const paymentProofCameraInputRef = useRef<HTMLInputElement | null>(null);
    const paymentProofPdfInputRef = useRef<HTMLInputElement | null>(null);

    const isAndroidDevice = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        return /Android/i.test(navigator.userAgent || '');
    }, []);

    const loadDraft = useCallback((): ProofRouteDraft | null => {
        if (typeof window === 'undefined') return null;
        try {
            const raw = window.localStorage.getItem(PROOF_ROUTE_DRAFT_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as Partial<ProofRouteDraft>;
            if (!parsed.quotationId || !parsed.actorId) {
                window.localStorage.removeItem(PROOF_ROUTE_DRAFT_KEY);
                return null;
            }
            return {
                quotationId: String(parsed.quotationId),
                actorId: String(parsed.actorId),
                pendingPicker: Boolean(parsed.pendingPicker),
                updatedAt: String(parsed.updatedAt || ''),
            };
        } catch {
            window.localStorage.removeItem(PROOF_ROUTE_DRAFT_KEY);
            return null;
        }
    }, []);

    const saveDraft = useCallback((pendingPicker: boolean) => {
        if (typeof window === 'undefined' || !quotationId || !profile?.id) return;
        window.localStorage.setItem(PROOF_ROUTE_DRAFT_KEY, JSON.stringify({
            quotationId,
            actorId: profile.id,
            pendingPicker,
            updatedAt: new Date().toISOString(),
        } satisfies ProofRouteDraft));
    }, [profile?.id, quotationId]);

    const clearDraft = useCallback(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(PROOF_ROUTE_DRAFT_KEY);
    }, []);

    const validatePaymentProofFile = useCallback((file: File | null) => {
        if (!file) return 'Debes adjuntar el comprobante de pago.';
        if (file.size > PAYMENT_PROOF_MAX_BYTES) return 'El comprobante supera el maximo de 20MB.';

        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const mimeType = (file.type || '').toLowerCase();
        const validMime = mimeType === 'application/pdf'
            || mimeType === 'image/jpeg'
            || mimeType === 'image/png'
            || mimeType === 'image/webp'
            || mimeType === 'image/heic'
            || mimeType === 'image/heif'
            || mimeType === 'application/heic'
            || mimeType === 'application/heif';

        if (!allowedPaymentProofExtensions.has(extension) && !validMime) {
            return 'Formato invalido. Usa PDF, JPG, JPEG, PNG, WEBP o HEIC.';
        }

        return null;
    }, []);

    const getQuotationCreditDays = useCallback((quote: any) => getClientCreditDays(quote?.client), []);

    const uploadPaymentProof = useCallback(async (quote: any, file: File) => {
        if (!profile?.id) throw new Error('No se pudo identificar al vendedor para subir el comprobante.');
        const fileExt = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const safeBaseName = file.name
            .replace(/\.[^.]+$/, '')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .slice(0, 80) || 'comprobante';
        const filePath = `${profile.id}/${quote.id}/${Date.now()}_${safeBaseName}.${fileExt}`;

        const { error } = await supabase.storage
            .from(PAYMENT_PROOFS_BUCKET)
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || undefined,
            });

        if (error) throw error;

        return {
            path: filePath,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
        };
    }, [profile?.id]);

    const buildOrderEmailPayload = useCallback((quote: any, orderFolio: number | string) => {
        const creditDays = getQuotationCreditDays(quote);
        const client = quote?.client || {};
        return {
            folio: orderFolio,
            quotationFolio: quote?.folio || null,
            date: new Date().toLocaleDateString('es-CL'),
            clientName: client?.name || quote?.client_name || 'Cliente',
            clientRut: client?.rut || '',
            clientAddress: client?.address || client?.comuna || '',
            clientOffice: client?.office || '',
            clientPhone: client?.phone || '',
            clientEmail: client?.email || '',
            clientGiro: client?.giro || '',
            clientCity: client?.zone || 'Santiago',
            clientComuna: client?.comuna || '',
            clientContact: quote?.client_contact || client?.purchase_contact || '',
            paymentTerms: formatPaymentTermsFromCreditDays(creditDays),
            sellerName: quote?.seller_name || 'Vendedor',
            sellerEmail: quote?.seller_email || '',
            items: (quote?.items || []).map((item: any) => ({
                code: item.code || '',
                detail: item.detail || '',
                qty: Number(item.qty || 0),
                unit: item.unit || 'UN',
                unitPrice: toWholeMoney(item.net_price ?? item.netPrice ?? item.price ?? 0),
                total: toWholeMoney(item.total ?? (Number(item.qty || 0) * Number(item.net_price ?? item.netPrice ?? item.price ?? 0) || 0)),
            })),
            totalAmount: toWholeMoney(quote?.total_amount || 0),
            comments: quote?.comments || (quote?.folio ? `Pedido generado desde cotizacion #${quote.folio}.` : 'Pedido generado desde CRM.'),
        };
    }, [getQuotationCreditDays]);

    useEffect(() => {
        const fetchQuotation = async () => {
            if (!quotationId) {
                setPaymentProofError('Cotizacion no encontrada.');
                setLoading(false);
                return;
            }

            setLoading(true);
            try {
                const { data: quoteRow, error: quoteError } = await supabase
                    .from('quotations')
                    .select(`
                        *,
                        clients (id, name, rut, address, zone, purchase_contact, status, phone, email, giro, comuna, office, credit_days)
                    `)
                    .eq('id', quotationId)
                    .single();

                if (quoteError) throw quoteError;

                const sellerId = quoteRow?.seller_id || null;
                let sellerProfile: any = null;
                if (sellerId) {
                    const { data: sellerRow } = await supabase
                        .from('profiles')
                        .select('id, email, full_name')
                        .eq('id', sellerId)
                        .maybeSingle();
                    sellerProfile = sellerRow;
                }

                const client = Array.isArray(quoteRow.clients) ? quoteRow.clients[0] : quoteRow.clients;
                setQuotation({
                    ...quoteRow,
                    client,
                    seller: sellerProfile,
                    client_name: client?.name || 'Cliente',
                    client_contact: client?.purchase_contact || '',
                    seller_email: sellerProfile?.email || '',
                    seller_name: sellerProfile?.full_name || sellerProfile?.email?.split('@')[0]?.toUpperCase() || 'Vendedor',
                    items: typeof quoteRow.items === 'string' ? (() => { try { return JSON.parse(quoteRow.items); } catch { return []; } })() : (quoteRow.items || []),
                });
            } catch (error: any) {
                setPaymentProofError(error?.message || 'No se pudo cargar la cotizacion.');
            } finally {
                setLoading(false);
            }
        };

        void fetchQuotation();
    }, [quotationId]);

    useEffect(() => {
        if (!quotationId || !profile?.id) return;
        const draft = loadDraft();
        if (!draft) return;
        if (draft.quotationId !== quotationId || draft.actorId !== profile.id || !draft.pendingPicker) return;
        setPaymentProofError(PROOF_ROUTE_RESTORE_MESSAGE);
        saveDraft(false);
    }, [loadDraft, profile?.id, quotationId, saveDraft]);

    const openPicker = useCallback((picker: 'image' | 'camera' | 'pdf') => {
        if (paymentProofError === PROOF_ROUTE_RESTORE_MESSAGE) {
            setPaymentProofError(null);
        }

        saveDraft(true);

        if (picker === 'camera') {
            paymentProofCameraInputRef.current?.click();
            return;
        }

        if (picker === 'pdf') {
            paymentProofPdfInputRef.current?.click();
            return;
        }

        paymentProofImageInputRef.current?.click();
    }, [paymentProofError, saveDraft]);

    const handlePaymentProofFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0] || null;
        event.target.value = '';
        saveDraft(false);

        if (!selectedFile) {
            setPaymentProofFile(null);
            setPaymentProofError(null);
            return;
        }

        setPaymentProofPreparing(true);
        setPaymentProofError(null);

        try {
            const normalizedFile = await convertHeicToJpeg(selectedFile);
            const validationError = validatePaymentProofFile(normalizedFile);
            if (validationError) {
                setPaymentProofFile(null);
                setPaymentProofError(validationError);
                return;
            }

            setPaymentProofFile(normalizedFile);
            setPaymentProofError(isHeicLikeFile(selectedFile) ? 'Archivo HEIC convertido automaticamente a JPG para compatibilidad.' : null);
        } catch (error: any) {
            setPaymentProofFile(null);
            setPaymentProofError(error?.message || 'No se pudo procesar el comprobante seleccionado.');
        } finally {
            setPaymentProofPreparing(false);
        }
    }, [saveDraft, validatePaymentProofFile]);

    const executeConvertToOrder = useCallback(async () => {
        if (!quotation || !profile?.id) return;
        if (quotation?.seller_id !== profile.id) {
            alert('Solo el vendedor dueno de la cotizacion puede convertirla a pedido.');
            return;
        }

        const creditDays = getQuotationCreditDays(quotation);
        const requiresProof = creditDays === 0;
        const attemptId = crypto.randomUUID();
        let normalizedProofFile = paymentProofFile;
        let uploadedProof: { path: string; name: string; mimeType: string } | null = null;
        let createdOrderId: string | null = null;

        if (requiresProof && !paymentProofFile) {
            const validationError = 'Debes adjuntar el comprobante de pago.';
            setPaymentProofError(validationError);
            await logQuotationOrderConversionSafe({
                attemptId,
                quotationId: quotation.id,
                actorId: profile.id,
                stage: 'payment_proof_upload',
                status: 'failed',
                message: validationError,
                metadata: {
                    requiresProof,
                    quotationFolio: quotation?.folio || null,
                },
            });
            return;
        }

        if (requiresProof && paymentProofFile) {
            try {
                setPaymentProofPreparing(true);
                setOrderConversionStage(isHeicLikeFile(paymentProofFile) ? 'Convirtiendo comprobante HEIC a JPG...' : 'Validando comprobante de pago...');
                normalizedProofFile = await convertHeicToJpeg(paymentProofFile);
                const validationError = validatePaymentProofFile(normalizedProofFile);
                if (validationError) {
                    setPaymentProofFile(null);
                    setPaymentProofError(validationError);
                    return;
                }
                setPaymentProofFile(normalizedProofFile);
                setPaymentProofError(isHeicLikeFile(paymentProofFile) ? 'Archivo HEIC convertido automaticamente a JPG para compatibilidad.' : null);
            } catch (proofPreparationError: any) {
                setPaymentProofFile(null);
                setPaymentProofError(proofPreparationError?.message || 'No se pudo procesar el comprobante seleccionado.');
                return;
            } finally {
                setPaymentProofPreparing(false);
            }
        }

        setSubmitting(true);
        setPaymentProofError(null);
        setOrderConversionStage(requiresProof ? 'Subiendo comprobante de pago...' : 'Generando pedido...');

        try {
            await logQuotationOrderConversionSafe({
                attemptId,
                quotationId: quotation.id,
                actorId: profile.id,
                stage: 'started',
                status: 'info',
                message: 'Inicio de conversion de cotizacion a pedido.',
                metadata: {
                    quotationFolio: quotation?.folio || null,
                    requiresProof,
                    creditDays,
                    source: 'android_dedicated_screen',
                },
            });

            if (requiresProof && normalizedProofFile) {
                uploadedProof = await withTimeout(
                    uploadPaymentProof(quotation, normalizedProofFile),
                    ORDER_CONVERSION_TIMEOUT_MS,
                    'La subida del comprobante tardo demasiado. Revisa tu conexion e intentalo nuevamente.',
                );
            }

            setOrderConversionStage('Generando pedido...');
            const rpcResponse = await withTimeout(
                (async () => await supabase.rpc('convert_quotation_to_order', {
                    p_quotation_id: quotation.id,
                    p_user_id: profile.id,
                    p_payment_proof_path: uploadedProof?.path ?? null,
                    p_payment_proof_name: uploadedProof?.name ?? null,
                    p_payment_proof_mime_type: uploadedProof?.mimeType ?? null,
                }))(),
                ORDER_CONVERSION_TIMEOUT_MS,
                'La generacion del pedido tardo demasiado. Revisa Pedidos antes de reintentar.',
            ) as any;

            if (rpcResponse.error) throw rpcResponse.error;

            const response = (rpcResponse.data || {}) as any;
            createdOrderId = response?.order_id || null;
            const orderFolio = response?.order_folio || response?.order_id?.slice?.(0, 8) || 'N/A';

            if (response?.already_exists) {
                clearDraft();
                alert('Esta cotizacion ya tenia un pedido asociado. Revisa el modulo de Pedidos para su estado de correo.');
                navigate('/orders', { replace: true });
                return;
            }

            try {
                setOrderConversionStage('Enviando correo a facturacion...');
                await withTimeout(sendOrderNotificationEmail({
                    orderId: createdOrderId || response?.order_id,
                    requestSource: 'quotation_conversion',
                    order: buildOrderEmailPayload(quotation, orderFolio),
                }), ORDER_CONVERSION_TIMEOUT_MS, 'El correo a facturacion tardo demasiado. El pedido se genero igual y puedes reenviarlo desde Pedidos.');
                alert('Pedido generado y correo enviado a facturacion correctamente.');
            } catch (emailError: any) {
                alert(`Pedido generado, pero el correo a facturacion fallo. ${emailError?.message || 'Puedes reenviarlo desde Pedidos.'}`);
            }

            clearDraft();
            navigate('/orders', { replace: true });
        } catch (error: any) {
            if (uploadedProof?.path && !createdOrderId) {
                void supabase.storage.from(PAYMENT_PROOFS_BUCKET).remove([uploadedProof.path]);
            }
            setPaymentProofError(error?.message || 'No se pudo generar el pedido.');
            alert(error?.message || 'No se pudo generar el pedido.');
        } finally {
            setSubmitting(false);
            setOrderConversionStage(null);
        }
    }, [
        buildOrderEmailPayload,
        clearDraft,
        getQuotationCreditDays,
        paymentProofFile,
        profile?.id,
        quotation,
        uploadPaymentProof,
        validatePaymentProofFile,
    ]);

    if (loading) {
        return <div className="min-h-[60vh] flex items-center justify-center text-sm font-medium text-gray-500">Cargando comprobante...</div>;
    }

    return (
        <div className="min-h-[calc(100vh-120px)] bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto max-w-2xl">
                <button
                    type="button"
                    onClick={() => navigate('/quotations')}
                    className="mb-4 inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700"
                >
                    <ArrowLeft size={16} />
                    Volver a cotizaciones
                </button>

                <div className="overflow-hidden rounded-3xl bg-white shadow-xl">
                    <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white">
                        <h1 className="text-xl font-black">Comprobante de Pago</h1>
                        <p className="mt-1 text-sm text-white/80">{quotation?.client_name || 'Cliente'}</p>
                        <p className="mt-2 text-xs font-semibold text-white/70">Cotizacion #{quotation?.folio || '-'}</p>
                    </div>

                    <div className="space-y-4 p-6">
                        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-medium text-amber-900">
                            Este cliente no tiene credito. Adjunta el comprobante de pago para generar el pedido y enviarlo a facturacion.
                        </div>

                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                            <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Archivos permitidos</p>
                            <p className="mt-1 text-sm font-bold text-gray-700">PDF, JPG, JPEG, PNG, WEBP, HEIC hasta 20MB</p>
                            <p className="mt-1 text-xs text-gray-500">Los archivos HEIC/HEIF se convierten automaticamente a JPG.</p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={() => openPicker('image')}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-bold text-emerald-700"
                            >
                                <ImageIcon size={16} />
                                Elegir imagen
                            </button>
                            <button
                                type="button"
                                onClick={() => openPicker('pdf')}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-bold text-slate-700"
                            >
                                <FileText size={16} />
                                Elegir PDF
                            </button>
                            {isAndroidDevice && (
                                <button
                                    type="button"
                                    onClick={() => openPicker('camera')}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm font-bold text-blue-700 sm:col-span-2"
                                >
                                    <Camera size={16} />
                                    Tomar foto
                                </button>
                            )}
                        </div>

                        <input
                            ref={paymentProofImageInputRef}
                            type="file"
                            accept="image/*,.heic,.heif"
                            className="hidden"
                            onChange={handlePaymentProofFileChange}
                        />
                        <input
                            ref={paymentProofPdfInputRef}
                            type="file"
                            accept="application/pdf,.pdf"
                            className="hidden"
                            onChange={handlePaymentProofFileChange}
                        />
                        <input
                            ref={paymentProofCameraInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={handlePaymentProofFileChange}
                        />

                        {paymentProofFile && (
                            <div className="rounded-2xl border border-gray-100 bg-white px-4 py-3">
                                <p className="text-sm font-bold text-gray-800">{paymentProofFile.name}</p>
                                <p className="mt-1 text-xs text-gray-500">{(paymentProofFile.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                        )}

                        {paymentProofPreparing && (
                            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
                                Convirtiendo archivo HEIC para compatibilidad...
                            </div>
                        )}

                        {paymentProofError && (
                            <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${paymentProofError.includes('convertido')
                                ? 'border border-amber-100 bg-amber-50 text-amber-700'
                                : 'border border-red-100 bg-red-50 text-red-700'
                                }`}>
                                {paymentProofError}
                            </div>
                        )}

                        {submitting && orderConversionStage && (
                            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">
                                {orderConversionStage}
                            </div>
                        )}

                        <div className="flex gap-3 pt-2">
                            <button
                                type="button"
                                onClick={() => {
                                    clearDraft();
                                    navigate('/quotations');
                                }}
                                className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 font-bold text-gray-600"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => void executeConvertToOrder()}
                                disabled={submitting || paymentProofPreparing}
                                className="flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50"
                            >
                                {submitting ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Upload size={16} />}
                                Generar Pedido
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuotationOrderProof;
