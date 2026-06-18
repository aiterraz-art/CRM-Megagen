import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { checkGPSConnection } from '../utils/gps';
import { completeDeliveryProof } from '../utils/deliveryProof';
import { convertHeicToJpeg, isHeicLikeFile, materializeBrowserFile } from '../utils/heic';

const DELIVERY_PROOF_DRAFT_KEY = 'delivery_route_proof_draft';
const DELIVERY_PROOF_RESTORE_MESSAGE = 'La app se recargo mientras seleccionabas la foto de entrega. Vuelve a elegir la imagen y luego finaliza la entrega.';

type DeliveryProofDraft = {
    actorId: string;
    orderId: string;
    routeId: string | null;
    pendingPicker: boolean;
    updatedAt: string;
};

const loadDraft = (): DeliveryProofDraft | null => {
    if (typeof window === 'undefined') return null;

    try {
        const raw = window.localStorage.getItem(DELIVERY_PROOF_DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DeliveryProofDraft>;
        if (!parsed.actorId || !parsed.orderId) {
            window.localStorage.removeItem(DELIVERY_PROOF_DRAFT_KEY);
            return null;
        }

        return {
            actorId: String(parsed.actorId),
            orderId: String(parsed.orderId),
            routeId: parsed.routeId ? String(parsed.routeId) : null,
            pendingPicker: Boolean(parsed.pendingPicker),
            updatedAt: String(parsed.updatedAt || ''),
        };
    } catch {
        window.localStorage.removeItem(DELIVERY_PROOF_DRAFT_KEY);
        return null;
    }
};

const DeliveryProofCapture = () => {
    const navigate = useNavigate();
    const { orderId } = useParams<{ orderId: string }>();
    const { profile, effectiveRole, hasPermission } = useUser();

    const [order, setOrder] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreparing, setPhotoPreparing] = useState(false);
    const [photoMessage, setPhotoMessage] = useState<string | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [deliveryGps, setDeliveryGps] = useState<{ lat: number; lng: number } | null>(null);
    const [deliveryGpsStatus, setDeliveryGpsStatus] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle');

    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const cameraInputRef = useRef<HTMLInputElement | null>(null);
    const deliveryProofsBucket = import.meta.env.VITE_DELIVERY_PROOFS_BUCKET || 'evidence-photos';
    const canAccess = effectiveRole === 'driver' || hasPermission('EXECUTE_DELIVERY');
    const isAndroidDevice = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        return /Android/i.test(navigator.userAgent || '');
    }, []);

    const saveDraft = useCallback((pendingPicker: boolean) => {
        if (typeof window === 'undefined' || !profile?.id || !orderId) return;
        window.localStorage.setItem(DELIVERY_PROOF_DRAFT_KEY, JSON.stringify({
            actorId: profile.id,
            orderId,
            routeId: order?.route_id ? String(order.route_id) : null,
            pendingPicker,
            updatedAt: new Date().toISOString(),
        } satisfies DeliveryProofDraft));
    }, [order?.route_id, orderId, profile?.id]);

    const clearDraft = useCallback(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(DELIVERY_PROOF_DRAFT_KEY);
    }, []);

    const clearPhotoSelection = useCallback(() => {
        setPhotoFile(null);
        setPhotoMessage(null);
        if (photoPreview) URL.revokeObjectURL(photoPreview);
        setPhotoPreview(null);
    }, [photoPreview]);

    useEffect(() => {
        return () => {
            if (photoPreview) URL.revokeObjectURL(photoPreview);
        };
    }, [photoPreview]);

    useEffect(() => {
        const fetchOrder = async () => {
            if (!profile?.id || !orderId || !canAccess) {
                setLoading(false);
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const { data: myRoutes, error: routesError } = await supabase
                    .from('delivery_routes')
                    .select('id, name, status')
                    .eq('driver_id', profile.id)
                    .in('status', ['draft', 'in_progress']);

                if (routesError) throw routesError;

                const routeIds = (myRoutes || []).map((route) => route.id);
                if (routeIds.length === 0) {
                    throw new Error('No tienes rutas activas asignadas.');
                }

                const { data: routeItems, error: itemError } = await supabase
                    .from('route_items')
                    .select(`
                        id, route_id, status,
                        order:orders (
                            id, folio, delivery_status,
                            client:clients (name, address, phone, lat, lng, office)
                        )
                    `)
                    .in('route_id', routeIds)
                    .eq('order_id', orderId)
                    .in('status', ['pending', 'rescheduled'])
                    .limit(1);

                if (itemError) throw itemError;
                const routeItem = routeItems?.[0];
                const routeOrder = Array.isArray(routeItem?.order) ? routeItem.order[0] : routeItem?.order;
                const routeClient = Array.isArray(routeOrder?.client) ? routeOrder.client[0] : routeOrder?.client;

                if (!routeOrder) {
                    throw new Error('No se encontró el pedido pendiente para esta ruta.');
                }

                const { data: queueRows, error: queueError } = await supabase
                    .from('dispatch_queue_items')
                    .select('order_id, invoice_number, client_name_snapshot, client_address_snapshot, client_office_snapshot, client_phone_snapshot, client_lat_snapshot, client_lng_snapshot')
                    .eq('order_id', orderId)
                    .limit(1);

                if (queueError) throw queueError;
                const queue = queueRows?.[0];
                const route = myRoutes?.find((candidate) => candidate.id === routeItem.route_id) || null;

                setOrder({
                    id: routeOrder.id,
                    folio: routeOrder.folio,
                    route_item_id: routeItem.id,
                    route_id: routeItem.route_id,
                    route_status: route?.status || null,
                    client: {
                        ...(routeClient || {}),
                        name: queue?.client_name_snapshot || routeClient?.name || 'Cliente',
                        address: queue?.client_address_snapshot || routeClient?.address || '',
                        office: queue?.client_office_snapshot || routeClient?.office || null,
                        phone: queue?.client_phone_snapshot || routeClient?.phone || null,
                        lat: queue?.client_lat_snapshot ?? routeClient?.lat ?? null,
                        lng: queue?.client_lng_snapshot ?? routeClient?.lng ?? null,
                    },
                    invoice_number: queue?.invoice_number || null,
                });
            } catch (fetchError: any) {
                console.error('Error loading delivery proof order:', fetchError);
                setError(fetchError?.message || 'No se pudo cargar el pedido para la entrega.');
            } finally {
                setLoading(false);
            }
        };

        void fetchOrder();
    }, [canAccess, orderId, profile?.id]);

    useEffect(() => {
        if (!order) {
            setDeliveryGps(null);
            setDeliveryGpsStatus('idle');
            return;
        }

        let mounted = true;
        setDeliveryGpsStatus('searching');

        checkGPSConnection({ showAlert: false, timeoutMs: 12000, retries: 2, minAccuracyMeters: 120 })
            .then((pos) => {
                if (!mounted) return;
                setDeliveryGps({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                });
                setDeliveryGpsStatus('ready');
            })
            .catch(() => {
                if (!mounted) return;
                setDeliveryGps(null);
                setDeliveryGpsStatus('error');
            });

        return () => {
            mounted = false;
        };
    }, [order]);

    useEffect(() => {
        if (!profile?.id || !orderId) return;
        const draft = loadDraft();
        if (!draft || draft.actorId !== profile.id || draft.orderId !== orderId || !draft.pendingPicker) return;
        setPhotoMessage(DELIVERY_PROOF_RESTORE_MESSAGE);
        saveDraft(false);
    }, [orderId, profile?.id, saveDraft]);

    const openPicker = useCallback((picker: 'image' | 'camera') => {
        if (photoMessage === DELIVERY_PROOF_RESTORE_MESSAGE) {
            setPhotoMessage(null);
        }
        saveDraft(true);

        if (picker === 'camera') {
            cameraInputRef.current?.click();
            return;
        }

        imageInputRef.current?.click();
    }, [photoMessage, saveDraft]);

    const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        saveDraft(false);

        if (!file) return;

        setPhotoPreparing(true);
        setPhotoMessage(null);
        setError(null);

        try {
            const inMemoryFile = await materializeBrowserFile(file);
            const normalizedFile = await convertHeicToJpeg(inMemoryFile);
            clearPhotoSelection();
            setPhotoFile(normalizedFile);
            setPhotoPreview(URL.createObjectURL(normalizedFile));
            setPhotoMessage(isHeicLikeFile(file) ? 'Archivo HEIC convertido automaticamente a JPG para compatibilidad.' : null);
        } catch (fileError: any) {
            clearPhotoSelection();
            setError(fileError?.message || 'No se pudo procesar la foto seleccionada.');
        } finally {
            setPhotoPreparing(false);
        }
    }, [clearPhotoSelection, saveDraft]);

    const handleComplete = useCallback(async () => {
        if (!order || !photoFile) {
            setError('Debes adjuntar una foto como comprobante de entrega.');
            return;
        }

        if (!deliveryGps) {
            setError('No se pudo obtener GPS preciso del repartidor. Activa ubicación e intenta nuevamente.');
            return;
        }

        setUploading(true);
        setError(null);

        try {
            await completeDeliveryProof({
                order,
                photoFile,
                deliveryPosition: deliveryGps,
                bucket: deliveryProofsBucket,
            });

            clearDraft();
            clearPhotoSelection();
            alert('¡Entrega completada exitosamente! Se ha enviado un correo al cliente.');
            navigate('/delivery', { replace: true });
        } catch (completeError: any) {
            console.error('Error completing delivery from dedicated proof route:', completeError);
            setError(completeError?.message || 'No se pudo finalizar la entrega.');
        } finally {
            setUploading(false);
        }
    }, [clearDraft, clearPhotoSelection, deliveryGps, deliveryProofsBucket, navigate, order, photoFile]);

    if (!canAccess) {
        return <div className="p-8 text-center font-bold text-gray-500">Acceso denegado. Este módulo es solo para repartidores.</div>;
    }

    if (loading) {
        return <div className="min-h-[60vh] flex items-center justify-center text-sm font-medium text-gray-500">Cargando entrega...</div>;
    }

    return (
        <div className="min-h-[calc(100vh-120px)] bg-slate-50 p-4 sm:p-6">
            <div className="mx-auto max-w-2xl">
                <button
                    type="button"
                    onClick={() => navigate('/delivery')}
                    className="mb-4 inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700"
                >
                    <ArrowLeft size={16} />
                    Volver a ruta
                </button>

                <div className="overflow-hidden rounded-3xl bg-white shadow-xl">
                    <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white">
                        <h1 className="text-xl font-black">Prueba de Entrega</h1>
                        <p className="mt-1 text-sm text-white/80">{order?.client?.name || 'Cliente'}</p>
                        <p className="mt-2 text-xs font-semibold text-white/70">Pedido #{order?.folio || '-'}</p>
                    </div>

                    <div className="space-y-4 p-6">
                        {error && (
                            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                                {error}
                            </div>
                        )}

                        {order?.route_status === 'draft' && (
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
                                La ruta está asignada, pero aún no ha sido iniciada.
                            </div>
                        )}

                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                            <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Dirección</p>
                            <p className="mt-1 text-sm font-bold text-gray-700">{order?.client?.address || 'Sin dirección'}</p>
                            {order?.client?.office && (
                                <p className="mt-1 text-xs font-semibold text-indigo-600">Oficina: {order.client.office}</p>
                            )}
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
                                onClick={() => openPicker(isAndroidDevice ? 'camera' : 'image')}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm font-bold text-blue-700"
                            >
                                <Camera size={16} />
                                {isAndroidDevice ? 'Tomar foto' : 'Abrir cámara'}
                            </button>
                        </div>

                        <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*,.heic,.heif"
                            className="hidden"
                            onChange={handleFileChange}
                        />
                        <input
                            ref={cameraInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={handleFileChange}
                        />

                        <div className="overflow-hidden rounded-3xl border-2 border-dashed border-gray-200 bg-gray-50">
                            {photoPreview ? (
                                <img src={photoPreview} alt="Preview entrega" className="h-72 w-full object-cover" />
                            ) : (
                                <div className="flex h-72 flex-col items-center justify-center p-8 text-center">
                                    <Camera size={48} className="mb-2 text-gray-300" />
                                    <p className="font-bold text-gray-400">Toma o selecciona una foto</p>
                                    <p className="text-xs text-gray-300">La prueba de entrega es obligatoria</p>
                                </div>
                            )}
                        </div>

                        <div className="min-h-[20px]">
                            {photoPreparing && (
                                <p className="text-xs font-bold text-amber-600">Procesando foto...</p>
                            )}
                            {!photoPreparing && photoMessage && (
                                <p className={`text-xs font-bold ${photoMessage === DELIVERY_PROOF_RESTORE_MESSAGE ? 'text-amber-600' : 'text-indigo-600'}`}>
                                    {photoMessage}
                                </p>
                            )}
                        </div>

                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                            <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Estado GPS de entrega</p>
                            {deliveryGpsStatus === 'searching' && (
                                <p className="mt-1 text-xs font-bold text-amber-600">Buscando ubicación precisa...</p>
                            )}
                            {deliveryGpsStatus === 'ready' && deliveryGps && (
                                <p className="mt-1 text-xs font-bold text-emerald-700">
                                    GPS listo: {deliveryGps.lat.toFixed(6)}, {deliveryGps.lng.toFixed(6)}
                                </p>
                            )}
                            {deliveryGpsStatus === 'error' && (
                                <p className="mt-1 text-xs font-bold text-red-600">No se pudo leer GPS. Activa ubicación e intenta nuevamente.</p>
                            )}
                            {deliveryGpsStatus === 'idle' && (
                                <p className="mt-1 text-xs font-bold text-gray-500">Esperando validación de GPS...</p>
                            )}
                        </div>

                        <button
                            type="button"
                            disabled={!photoFile || uploading || photoPreparing || !deliveryGps || deliveryGpsStatus !== 'ready' || order?.route_status === 'draft'}
                            onClick={handleComplete}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-green-500 px-4 py-4 text-lg font-bold text-white shadow-xl shadow-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {uploading || photoPreparing ? (
                                photoPreparing ? 'Procesando foto...' : 'Subiendo...'
                            ) : (
                                <>
                                    <CheckCircle2 size={20} />
                                    Confirmar Entrega
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DeliveryProofCapture;
