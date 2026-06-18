import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { MapPin, Phone, CheckCircle2, Camera, Navigation, ArrowLeft, AlertTriangle } from 'lucide-react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { checkGPSConnection, watchCurrentLocation } from '../utils/gps';
import { convertHeicToJpeg, isHeicLikeFile, materializeBrowserFile } from '../utils/heic';
import { completeDeliveryProof } from '../utils/deliveryProof';

// Helper for distance calc (Haversine formula)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

const DEFAULT_SANTIAGO_CENTER = { lat: -33.4489, lng: -70.6693 };
const DELIVERY_PROOF_DRAFT_KEY = 'delivery_route_proof_draft';
const DELIVERY_PROOF_RESTORE_MESSAGE = 'La app se recargo mientras seleccionabas la foto de entrega. Vuelve a elegir la imagen y luego finaliza la entrega.';

type DeliveryProofDraft = {
    actorId: string;
    orderId: string;
    routeId: string | null;
    pendingPicker: boolean;
    updatedAt: string;
};

const isDefaultFallbackCoordinate = (lat: unknown, lng: unknown) => {
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return false;

    return (
        Math.abs(parsedLat - DEFAULT_SANTIAGO_CENTER.lat) < 0.0001 &&
        Math.abs(parsedLng - DEFAULT_SANTIAGO_CENTER.lng) < 0.0001
    );
};

const loadDeliveryProofDraft = (): DeliveryProofDraft | null => {
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

// Internal Component for Directions
const Directions = ({ orders, userLocation }: { orders: any[], userLocation: { lat: number, lng: number } | null }) => {
    const map = useMap();
    const routesLibrary = useMapsLibrary('routes');
    const [directionsService, setDirectionsService] = useState<google.maps.DirectionsService>();
    const [directionsRenderer, setDirectionsRenderer] = useState<google.maps.DirectionsRenderer>();

    useEffect(() => {
        if (!routesLibrary || !map) return;
        setDirectionsService(new routesLibrary.DirectionsService());
        setDirectionsRenderer(new routesLibrary.DirectionsRenderer({
            map,
            suppressMarkers: true, // We use our own custom AdvancedMarkers
            polylineOptions: { strokeColor: "#4F46E5", strokeWeight: 5, strokeOpacity: 0.8 }
        }));
    }, [routesLibrary, map]);

    useEffect(() => {
        if (!directionsService || !directionsRenderer || orders.length === 0) return;

        const validOrders = orders.filter(o => o.client?.lat && o.client?.lng);
        if (validOrders.length === 0) return;

        // Origin: User location or first order
        const origin = userLocation
            ? { lat: userLocation.lat, lng: userLocation.lng }
            : { lat: Number(validOrders[0].client.lat), lng: Number(validOrders[0].client.lng) };

        // Destination: Last order
        const lastOrder = validOrders[validOrders.length - 1];
        const destination = { lat: Number(lastOrder.client.lat), lng: Number(lastOrder.client.lng) };

        // Waypoints: All orders except last (Google requires origin/dest separate)
        const waypoints = validOrders.slice(0, -1).map(order => ({
            location: { lat: Number(order.client.lat), lng: Number(order.client.lng) },
            stopover: true
        }));

        // Limit waypoints to 25 (Google API Limit)
        const limitedWaypoints = waypoints.slice(0, 25);

        directionsService.route({
            origin,
            destination,
            waypoints: limitedWaypoints,
            travelMode: google.maps.TravelMode.DRIVING,
            optimizeWaypoints: true // Google's recommended order
        }).then(response => {
            directionsRenderer.setDirections(response);
        }).catch(err => console.error("Directions request failed", err));

    }, [directionsService, directionsRenderer, orders, userLocation]);

    return null;
};

const DeliveryRoute: React.FC = () => {
    const { profile, effectiveRole, hasPermission } = useUser();
    const navigate = useNavigate();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [isMapMode, setIsMapMode] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Geofencing State
    const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [debugMode, setDebugMode] = useState(false);
    const geofenceDebugEnabled = import.meta.env.VITE_GEOFENCE_DEBUG === 'true';

    // For Photo Upload
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [photoPreparing, setPhotoPreparing] = useState(false);
    const [photoMessage, setPhotoMessage] = useState<string | null>(null);
    const [deliveryGps, setDeliveryGps] = useState<{ lat: number; lng: number } | null>(null);
    const [deliveryGpsStatus, setDeliveryGpsStatus] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle');

    const [routeName, setRouteName] = useState<string>("Ruta de Hoy");
    const [activeRouteIds, setActiveRouteIds] = useState<string[]>([]);
    const [hasDraftRoutes, setHasDraftRoutes] = useState(false);
    const [startingRoute, setStartingRoute] = useState(false);
    const [mapsApiLoaded, setMapsApiLoaded] = useState(false);
    const deliveryProofsBucket = import.meta.env.VITE_DELIVERY_PROOFS_BUCKET || 'evidence-photos';
    const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    const isAndroidDevice = useMemo(() => {
        if (typeof navigator === 'undefined') return false;
        return /Android/i.test(navigator.userAgent || '');
    }, []);

    const clearPhotoSelection = () => {
        setPhotoFile(null);
        setPhotoMessage(null);
        if (photoPreview) URL.revokeObjectURL(photoPreview);
        setPhotoPreview(null);
    };

    const saveDeliveryProofDraft = (order: any, pendingPicker: boolean) => {
        if (typeof window === 'undefined' || !profile?.id || !order?.id) return;

        window.localStorage.setItem(DELIVERY_PROOF_DRAFT_KEY, JSON.stringify({
            actorId: profile.id,
            orderId: String(order.id),
            routeId: order.route_id ? String(order.route_id) : null,
            pendingPicker,
            updatedAt: new Date().toISOString(),
        } satisfies DeliveryProofDraft));
    };

    const clearDeliveryProofDraft = () => {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(DELIVERY_PROOF_DRAFT_KEY);
    };

    const openDeliveryModal = (order: any) => {
        if (isAndroidDevice) {
            clearDeliveryProofDraft();
            navigate(`/delivery/${order.id}/proof`);
            return;
        }
        clearPhotoSelection();
        clearDeliveryProofDraft();
        setSelectedOrder(order);
    };

    const closeDeliveryModal = () => {
        clearDeliveryProofDraft();
        clearPhotoSelection();
        setSelectedOrder(null);
    };

    const fetchRoute = async () => {
        setLoading(true);
        try {
            if (!profile?.id) throw new Error("No hay perfil activo");

            // 1. Get Active Routes for this User (Use profile.id for impersonation support)
            const { data: myRoutes, error: routeError } = await supabase
                .from('delivery_routes')
                .select('id, name, status')
                .eq('driver_id', profile.id)
                .in('status', ['draft', 'in_progress']);

            if (routeError) {
                console.error("Error fetching routes:", routeError);
                throw routeError;
            }

            if (!myRoutes || myRoutes.length === 0) {
                setOrders([]);
                setRouteName("Sin Ruta Asignada");
                setActiveRouteIds([]);
                setHasDraftRoutes(false);
                setLoading(false);
                return;
            }

            // Set Route Name
            const names = myRoutes.map(r => r.name).join(", ");
            setRouteName(names || "Ruta de Hoy");
            setActiveRouteIds(myRoutes.map((route) => route.id));
            setHasDraftRoutes(myRoutes.some((route) => String(route.status || '').toLowerCase() === 'draft'));

            const routeIds = myRoutes.map(r => r.id);

            // 2. Get Route Items
            const { data, error } = await supabase
                .from('route_items')
                .select(`
                    id, route_id, status, sequence_order, notes,
                    order:orders (
                        id, folio, total_amount, delivery_status,
                        client:clients (name, address, phone, lat, lng, office)
                    )
                `)
                .in('route_id', routeIds)
                .in('status', ['pending', 'rescheduled'])
                .order('sequence_order', { ascending: true }); // Ensure fixed order

            if (error) {
                console.error("Error fetching items:", error);
                throw error;
            }

            const orderIds = (data || []).map((item: any) => item.order?.id).filter(Boolean);
            const { data: queueRows, error: queueError } = orderIds.length === 0
                ? { data: [], error: null }
                : await supabase
                    .from('dispatch_queue_items')
                    .select('order_id, invoice_number, client_name_snapshot, client_address_snapshot, client_office_snapshot, client_phone_snapshot, client_lat_snapshot, client_lng_snapshot')
                    .in('order_id', orderIds);

            if (queueError) {
                console.error("Error fetching dispatch queue snapshots:", queueError);
                throw queueError;
            }

            const queueByOrderId = new Map<string, any>();
            (queueRows || []).forEach((row: any) => {
                queueByOrderId.set(row.order_id, row);
            });

            // Map structure to flat format for component
            const mappedOrders = (data || []).map((item: any) => {
                if (!item.order) {
                    console.warn("Item without order visible:", item);
                    return null;
                }
                const queue = queueByOrderId.get(item.order.id);
                const clientAddress = queue?.client_address_snapshot || item.order.client?.address || '';
                const inheritedLat = queue?.client_lat_snapshot ?? item.order.client?.lat ?? null;
                const inheritedLng = queue?.client_lng_snapshot ?? item.order.client?.lng ?? null;
                const shouldDiscardFallbackCoords = clientAddress && isDefaultFallbackCoordinate(inheritedLat, inheritedLng);
                return {
                    id: item.order.id, // Keep order ID as primary key for actions
                    route_item_id: item.id,
                    route_id: item.route_id,
                    route_status: myRoutes.find((route) => route.id === item.route_id)?.status || null,
                    status: item.status,
                    delivery_status: item.order.delivery_status,
                    client: {
                        ...(item.order.client || {}),
                        name: queue?.client_name_snapshot || item.order.client?.name || 'Cliente',
                        address: clientAddress,
                        office: queue?.client_office_snapshot || item.order.client?.office || null,
                        phone: queue?.client_phone_snapshot || item.order.client?.phone || null,
                        lat: shouldDiscardFallbackCoords ? null : inheritedLat,
                        lng: shouldDiscardFallbackCoords ? null : inheritedLng
                    },
                    folio: item.order.folio,
                    invoice_number: queue?.invoice_number || null
                };
            }).filter(Boolean); // Remove nulls

            setOrders(mappedOrders);

        } catch (err: any) {
            console.error("Error fetching route:", err);
            setRouteName("Error de Carga");
            setOrders([]);
            // alert("Error cargando ruta: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRoute();

        let mounted = true;
        checkGPSConnection({ showAlert: false, timeoutMs: 12000, retries: 1, minAccuracyMeters: 500 })
            .then((pos) => {
                if (!mounted) return;
                setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            })
            .catch((error) => {
                console.warn("Initial GPS read failed:", error);
            });

        const watchId = watchCurrentLocation(
            (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => console.warn("Location watch warning:", err.message),
            { enableHighAccuracy: true, timeoutMs: 10000, maximumAgeMs: 2000, minAccuracyMeters: 700 }
        );
        return () => {
            mounted = false;
            if (typeof watchId === 'number') navigator.geolocation.clearWatch(watchId);
        };
    }, [profile?.id]); // Re-fetch if profile changes (Impersonation)

    useEffect(() => {
        if (!profile?.id || loading) return;

        const draft = loadDeliveryProofDraft();
        if (!draft || draft.actorId !== profile.id || !draft.pendingPicker) return;

        const draftOrder = orders.find((order) => {
            if (String(order.id) !== draft.orderId) return false;
            if (!draft.routeId) return true;
            return String(order.route_id || '') === draft.routeId;
        });

        if (draftOrder) {
            setSelectedOrder((current: any) => (current?.id === draftOrder.id ? current : draftOrder));
            setPhotoMessage(DELIVERY_PROOF_RESTORE_MESSAGE);
            saveDeliveryProofDraft(draftOrder, false);
            return;
        }

        if (orders.length === 0) {
            clearDeliveryProofDraft();
        }
    }, [loading, orders, profile?.id]);

    useEffect(() => {
        if (mapsApiLoaded) return;
        if (typeof window !== 'undefined' && window.google?.maps?.Geocoder) {
            setMapsApiLoaded(true);
        }
    }, [mapsApiLoaded, isMapMode, orders.length]);

    // Debug: Teleport function
    const handleTeleport = (lat: number, lng: number) => {
        setUserLocation({ lat, lng });
        alert(`📍 Teletransportado a: ${lat}, ${lng}`);
    };

    const geocodeAddress = async (address: string) => {
        const normalizedAddress = String(address || '').trim();
        if (!normalizedAddress || typeof window === 'undefined' || !window.google?.maps?.Geocoder) return null;

        const cacheKey = `delivery_geocode:v2:${normalizedAddress.toLowerCase()}`;
        const cached = typeof window !== 'undefined' ? window.sessionStorage.getItem(cacheKey) : null;
        if (cached) {
            try {
                return JSON.parse(cached) as { lat: number; lng: number };
            } catch {
                // ignore invalid cache
            }
        }

        const geocoder = new window.google.maps.Geocoder();
        const addressForLookup = /chile/i.test(normalizedAddress) ? normalizedAddress : `${normalizedAddress}, Chile`;
        const { results } = await geocoder.geocode({ address: addressForLookup });
        const location = results?.[0]?.geometry?.location;
        if (!location) return null;

        const coords = { lat: location.lat(), lng: location.lng() };
        if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(cacheKey, JSON.stringify(coords));
        }
        return coords;
    };

    const handleStartRoutes = async () => {
        if (activeRouteIds.length === 0) return;

        setStartingRoute(true);
        try {
            const { error } = await supabase.rpc('start_delivery_routes', {
                p_route_ids: activeRouteIds
            });

            if (error) throw error;

            await fetchRoute();
            alert('Ruta iniciada correctamente.');
        } catch (error: any) {
            console.error("Error starting delivery routes:", error);
            alert("No se pudo iniciar la ruta: " + error.message);
        } finally {
            setStartingRoute(false);
        }
    };

    const validateGeofence = (order: any) => {
        // [DEBUG] If debug mode is active, always allow
        if (geofenceDebugEnabled && debugMode) {
            console.log("Geofence bypassed (Debug Mode)");
            return true;
        }

        const clientLat = Number(order.client?.lat);
        const clientLng = Number(order.client?.lng);

        // If client has no valid coords, we can't validate, so allow.
        if (!Number.isFinite(clientLat) || !Number.isFinite(clientLng)) return true;

        if (!userLocation) {
            alert("⚠️ No se ha detectado tu ubicación. Activa el GPS.");
            return false;
        }

        const dist = calculateDistance(userLocation.lat, userLocation.lng, clientLat, clientLng);
        if (dist > 500) {
            alert(`⚠️ Estás lejos del punto de entrega (${Math.round(dist)}m). Se permitirá continuar solo para pruebas.`);
            return true;
        }
        return true;
    };

    const handlePhotoInputClick = () => {
        if (!selectedOrder) return;
        saveDeliveryProofDraft(selectedOrder, true);
        if (photoMessage === DELIVERY_PROOF_RESTORE_MESSAGE) {
            setPhotoMessage(null);
        }
    };

    const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        e.target.value = '';
        if (selectedOrder) {
            saveDeliveryProofDraft(selectedOrder, false);
        }

        if (!file) {
            return;
        }

        setPhotoPreparing(true);
        setPhotoMessage(null);

        try {
            const inMemoryFile = await materializeBrowserFile(file);
            const normalizedFile = await convertHeicToJpeg(inMemoryFile);

            if (photoPreview) URL.revokeObjectURL(photoPreview);
            setPhotoFile(normalizedFile);
            setPhotoPreview(URL.createObjectURL(normalizedFile));
            setPhotoMessage(isHeicLikeFile(file) ? 'Archivo HEIC convertido automaticamente a JPG para compatibilidad.' : null);
        } catch (error: any) {
            setPhotoFile(null);
            if (photoPreview) URL.revokeObjectURL(photoPreview);
            setPhotoPreview(null);
            setPhotoMessage(error?.message || 'No se pudo procesar la foto seleccionada.');
        } finally {
            setPhotoPreparing(false);
        }
    };

    useEffect(() => {
        return () => {
            if (photoPreview) URL.revokeObjectURL(photoPreview);
        };
    }, [photoPreview]);

    useEffect(() => {
        if (!selectedOrder) {
            clearPhotoSelection();
        }
    }, [selectedOrder]);

    useEffect(() => {
        if (!selectedOrder) {
            setDeliveryGps(null);
            setDeliveryGpsStatus('idle');
            return;
        }

        let mounted = true;
        setDeliveryGpsStatus('searching');

        checkGPSConnection({ showAlert: false, timeoutMs: 12000, retries: 2, minAccuracyMeters: 120 })
            .then((pos) => {
                if (!mounted) return;
                const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setDeliveryGps(point);
                setUserLocation(point);
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
    }, [selectedOrder]);

    useEffect(() => {
        if (!mapsApiLoaded || orders.length === 0) return;

        const ordersToResolve = orders.filter(
            (order) => order?.client?.address && !order?.client?.coordsResolvedFromAddress && !order?.client?.coordsResolutionAttempted
        );
        if (ordersToResolve.length === 0) return;

        let cancelled = false;

        (async () => {
            const resolvedEntries = await Promise.all(
                ordersToResolve.map(async (order) => {
                    try {
                        const coords = await geocodeAddress(order.client.address);
                        return [order.id, coords] as const;
                    } catch (error) {
                        console.warn('Address geocoding failed for delivery route:', order.client.address, error);
                        return [order.id, null] as const;
                    }
                })
            );

            if (cancelled) return;

            const resolvedMap = new Map<string, { lat: number; lng: number } | null>(resolvedEntries);
            setOrders((prev) => prev.map((order) => {
                const resolved = resolvedMap.get(order.id);
                if (resolvedMap.has(order.id)) {
                    return {
                        ...order,
                        client: {
                            ...order.client,
                            lat: resolved?.lat ?? order.client?.lat ?? null,
                            lng: resolved?.lng ?? order.client?.lng ?? null,
                            coordsResolvedFromAddress: Boolean(resolved),
                            coordsResolutionAttempted: true
                        }
                    };
                }
                return order;
            }));
        })();

        return () => {
            cancelled = true;
        };
    }, [mapsApiLoaded, orders]);

    const handleCompleteDelivery = async () => {
        if (!selectedOrder) return;
        if (!photoFile) {
            alert('Debes subir una foto como comprobante de entrega.');
            return;
        }

        setUploading(true);
        try {
            let deliveryPosition = deliveryGps || userLocation;
            if (!deliveryPosition) {
                try {
                    setDeliveryGpsStatus('searching');
                    const fresh = await checkGPSConnection({ showAlert: false, timeoutMs: 12000, retries: 2, minAccuracyMeters: 120 });
                    deliveryPosition = { lat: fresh.coords.latitude, lng: fresh.coords.longitude };
                    setUserLocation(deliveryPosition);
                    setDeliveryGps(deliveryPosition);
                    setDeliveryGpsStatus('ready');
                } catch (_gpsErr) {
                    setDeliveryGpsStatus('error');
                    alert('No se pudo obtener GPS preciso del repartidor. Activa ubicación e intenta nuevamente.');
                    return;
                }
            }

            await completeDeliveryProof({
                order: selectedOrder,
                photoFile,
                deliveryPosition,
                bucket: deliveryProofsBucket,
            });

            alert("¡Entrega completada exitosamente! Se ha enviado un correo al cliente.");
            closeDeliveryModal();
            fetchRoute(); // Refresh list

        } catch (error: any) {
            console.error("Error completing delivery:", error);
            alert("Error al finalizar entrega: " + error.message);
        } finally {
            setUploading(false);
        }
    };

    if (!(effectiveRole === 'driver' || hasPermission('EXECUTE_DELIVERY'))) {
        return <div className="p-8 text-center font-bold text-gray-500">Acceso denegado. Este módulo es solo para repartidores.</div>;
    }

    if (loading) return <div className="p-8 text-center">Cargando ruta...</div>;

    return (
        <APIProvider
            apiKey={googleMapsApiKey}
            onLoad={() => setMapsApiLoaded(true)}
            onError={(error) => console.error('Google Maps API failed to load in delivery route:', error)}
        >
            <div className="pb-20">
            {/* Header */}
            <div className="bg-slate-900 text-white p-6 rounded-b-[2rem] shadow-xl relative z-10">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h1 className="text-2xl font-black italic">{routeName}</h1>
                        <span className="bg-indigo-500 px-3 py-1 rounded-full text-xs font-bold">
                            {orders.length} Pendientes
                        </span>
                    </div>

                    {/* Debug Toggle */}
                    {geofenceDebugEnabled && (
                        <button
                            onClick={() => setDebugMode(!debugMode)}
                            className={`p-2 rounded-full ${debugMode ? 'bg-amber-100 text-amber-600' : 'bg-slate-800 text-slate-500'}`}
                        >
                            <AlertTriangle size={16} />
                        </button>
                    )}
                </div>
                {hasDraftRoutes && (
                    <button
                        onClick={handleStartRoutes}
                        disabled={startingRoute}
                        className="w-full mb-4 py-3 rounded-2xl bg-amber-400 text-slate-900 font-black text-sm hover:bg-amber-300 transition-all disabled:opacity-60"
                    >
                        {startingRoute ? 'Iniciando ruta...' : 'Iniciar ruta'}
                    </button>
                )}
                <div className="flex gap-2">
                    <button
                        onClick={() => setIsMapMode(false)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${!isMapMode ? 'bg-white text-slate-900' : 'bg-slate-800 text-slate-400'}`}
                    >
                        Lista
                    </button>
                    <button
                        onClick={() => setIsMapMode(true)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${isMapMode ? 'bg-white text-slate-900' : 'bg-slate-800 text-slate-400'}`}
                    >
                        Mapa
                    </button>
                </div>
            </div>

            {/* Content */}
            {isMapMode ? (
                <div className="h-[60vh] m-4 rounded-[2rem] overflow-hidden shadow-lg border border-gray-100">
                    <GoogleMap
                        defaultCenter={{ lat: -33.4489, lng: -70.6693 }}
                        defaultZoom={12}
                        mapId="DRIVER_MAP"
                        className="w-full h-full"
                    >
                        <Directions orders={orders} userLocation={userLocation} />

                        {orders
                            .filter((order) => Number.isFinite(Number(order.client?.lat)) && Number.isFinite(Number(order.client?.lng)))
                            .map((order, index) => (
                                <AdvancedMarker
                                    key={order.id}
                                    position={{ lat: Number(order.client.lat), lng: Number(order.client.lng) }}
                                    onClick={() => {
                                        if (String(order.route_status || '').toLowerCase() === 'draft') {
                                            alert('La ruta está asignada, pero aún no se ha iniciado.');
                                            return;
                                        }
                                        if (validateGeofence(order)) openDeliveryModal(order);
                                    }}
                                >
                                    <Pin
                                        background={'#4F46E5'}
                                        borderColor={'white'}
                                        glyph={String(index + 1)} // Numbered pin
                                        glyphColor={'white'}
                                        scale={1.2}
                                    />
                                </AdvancedMarker>
                            ))}
                    </GoogleMap>
                </div>
            ) : (
                <div className="p-4 space-y-4">
                    {orders.length === 0 ? (
                        <div className="text-center py-10 text-gray-400">
                            <CheckCircle2 size={48} className="mx-auto mb-4 opacity-50" />
                            <p>¡Todo entregado por hoy!</p>
                        </div>
                    ) : (
                        orders.map(order => (
                            <div key={order.id} className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 active:scale-95 transition-transform">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-[10px] font-black uppercase text-indigo-500 bg-indigo-50 px-2 py-1 rounded-md">
                                        #{order.folio || order.id.slice(0, 8)}
                                    </span>
                                    {/* Link to Waze/Maps */}
                                    <a
                                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.client.address || '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-600"
                                    >
                                        <Navigation size={14} />
                                    </a>
                                </div>
                                <h3 className="font-bold text-gray-900 text-lg">{order.client.name}</h3>
                                <p className="text-sm text-gray-500 mt-1 flex items-start gap-2">
                                    <MapPin size={14} className="mt-0.5 shrink-0" />
                                    {order.client.address || "Sin dirección"}
                                    {order.client.office && <span className="ml-1 text-indigo-500 font-bold">({order.client.office})</span>}
                                </p>
                                {order.client.phone && (
                                    <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
                                        <Phone size={14} />
                                        <a href={`tel:${order.client.phone}`} className="underline decoration-dotted">
                                            {order.client.phone}
                                        </a>
                                    </p>
                                )}

                                <button
                                    onClick={() => {
                                        if (String(order.route_status || '').toLowerCase() === 'draft') {
                                            alert('Debes iniciar la ruta antes de registrar entregas.');
                                            return;
                                        }
                                        if (validateGeofence(order)) openDeliveryModal(order);
                                    }}
                                    className="w-full mt-4 bg-slate-900 text-white py-3 rounded-xl font-bold text-sm shadow-lg active:bg-slate-800"
                                >
                                    {String(order.route_status || '').toLowerCase() === 'draft' ? 'Ruta asignada' : 'Entregar'}
                                </button>

                                {/* Teleport Button (Debug) */}
                                {geofenceDebugEnabled && debugMode && order.client?.lat && order.client?.lng && (
                                    <button
                                        onClick={() => handleTeleport(order.client.lat!, order.client.lng!)}
                                        className="w-full mt-2 py-2 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold border border-amber-200"
                                    >
                                        📍 [DEBUG] Teletransportar Aquí
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Delivery Modal */}
            {selectedOrder && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4">
                    <div className="bg-white w-full sm:max-w-md h-[80vh] sm:h-auto rounded-t-3xl sm:rounded-3xl p-6 animate-in slide-in-from-bottom duration-300 flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h2 className="text-xl font-black">Finalizar Entrega</h2>
                                <p className="text-sm text-gray-400">Pedido #{selectedOrder.folio}</p>
                            </div>
                            <button onClick={closeDeliveryModal} className="p-2 bg-gray-100 rounded-full">
                                <ArrowLeft size={20} />
                            </button>
                        </div>

                        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50 mb-6 relative overflow-hidden group">
                            {photoPreview ? (
                                <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-center p-8">
                                    <Camera size={48} className="mx-auto text-gray-300 mb-2" />
                                    <p className="font-bold text-gray-400">Toma una foto</p>
                                    <p className="text-xs text-gray-300">Prueba de entrega requerida</p>
                                </div>
                            )}

                            <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onClick={handlePhotoInputClick}
                                onChange={handlePhotoSelect}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                        </div>

                        <div className="mb-4 min-h-[20px]">
                            {photoPreparing && (
                                <p className="text-xs font-bold text-amber-600">Procesando foto...</p>
                            )}
                            {!photoPreparing && photoMessage && (
                                <p className={`text-xs font-bold ${photoMessage === DELIVERY_PROOF_RESTORE_MESSAGE ? 'text-amber-600' : 'text-indigo-600'}`}>
                                    {photoMessage}
                                </p>
                            )}
                        </div>

                        <div className="mb-4 p-3 rounded-xl border bg-gray-50">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Estado GPS de entrega</p>
                            {deliveryGpsStatus === 'searching' && (
                                <p className="text-xs font-bold text-amber-600">Buscando ubicación precisa...</p>
                            )}
                            {deliveryGpsStatus === 'ready' && deliveryGps && (
                                <p className="text-xs font-bold text-emerald-700">
                                    GPS listo: {deliveryGps.lat.toFixed(6)}, {deliveryGps.lng.toFixed(6)}
                                </p>
                            )}
                            {deliveryGpsStatus === 'error' && (
                                <p className="text-xs font-bold text-red-600">No se pudo leer GPS. Activa ubicación e intenta nuevamente.</p>
                            )}
                            {deliveryGpsStatus === 'idle' && (
                                <p className="text-xs font-bold text-gray-500">Esperando validación de GPS...</p>
                            )}
                        </div>

                        <button
                            disabled={!photoFile || uploading || photoPreparing || deliveryGpsStatus !== 'ready' || !deliveryGps}
                            onClick={handleCompleteDelivery}
                            className="w-full bg-green-500 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-green-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
            )}
            </div>
        </APIProvider>
    );
};

export default DeliveryRoute;
