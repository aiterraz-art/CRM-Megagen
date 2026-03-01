import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { MapPin, Phone, CheckCircle2, Camera, Navigation, ArrowLeft, AlertTriangle } from 'lucide-react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { checkGPSConnection, watchCurrentLocation } from '../utils/gps';

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
    const [deliveryGps, setDeliveryGps] = useState<{ lat: number; lng: number } | null>(null);
    const [deliveryGpsStatus, setDeliveryGpsStatus] = useState<'idle' | 'searching' | 'ready' | 'error'>('idle');

    const [routeName, setRouteName] = useState<string>("Ruta de Hoy");
    const deliveryProofsBucket = import.meta.env.VITE_DELIVERY_PROOFS_BUCKET || 'evidence-photos';

    const fetchRoute = async () => {
        setLoading(true);
        try {
            if (!profile?.id) throw new Error("No hay perfil activo");

            // 1. Get Active Routes for this User (Use profile.id for impersonation support)
            const { data: myRoutes, error: routeError } = await supabase
                .from('delivery_routes')
                .select('id, name, status')
                .eq('driver_id', profile.id)
                .eq('status', 'in_progress');

            if (routeError) {
                console.error("Error fetching routes:", routeError);
                throw routeError;
            }

            if (!myRoutes || myRoutes.length === 0) {
                setOrders([]);
                setRouteName("Sin Ruta Asignada");
                setLoading(false);
                return;
            }

            // Set Route Name
            const names = myRoutes.map(r => r.name).join(", ");
            setRouteName(names || "Ruta de Hoy");

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

            // Map structure to flat format for component
            const mappedOrders = (data || []).map((item: any) => {
                if (!item.order) {
                    console.warn("Item without order visible:", item);
                    return null;
                }
                return {
                    id: item.order.id, // Keep order ID as primary key for actions
                    route_item_id: item.id,
                    route_id: item.route_id,
                    status: item.status,
                    delivery_status: item.order.delivery_status,
                    client: item.order.client || {}, // Safe fallback
                    folio: item.order.folio
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

    // Debug: Teleport function
    const handleTeleport = (lat: number, lng: number) => {
        setUserLocation({ lat, lng });
        alert(`📍 Teletransportado a: ${lat}, ${lng}`);
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
            alert(`⛔ Estás muy lejos del punto de entrega (${Math.round(dist)}m). Debes estar a menos de 500m. (Tip: Activa Modo Debug para omitir esto)`);
            return false;
        }
        return true;
    };

    const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (photoPreview) URL.revokeObjectURL(photoPreview);
            setPhotoFile(file);
            setPhotoPreview(URL.createObjectURL(file));
        }
    };

    useEffect(() => {
        return () => {
            if (photoPreview) URL.revokeObjectURL(photoPreview);
        };
    }, [photoPreview]);

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

    const handleCompleteDelivery = async () => {
        if (!selectedOrder) return;
        if (!photoFile) {
            alert('Debes subir una foto como comprobante de entrega.');
            return;
        }

        setUploading(true);
        try {
            const deliveredAtIso = new Date().toISOString();
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

            // 1. Upload Photo
            const fileExt = photoFile.name.split('.').pop();
            const fileName = `${selectedOrder.id}_${Date.now()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from(deliveryProofsBucket)
                .upload(filePath, photoFile);

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from(deliveryProofsBucket)
                .getPublicUrl(filePath);

            // 2. Update Order
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    delivery_status: 'delivered',
                    delivered_at: deliveredAtIso,
                    delivery_photo_url: publicUrl,
                    delivered_lat: deliveryPosition?.lat ?? null,
                    delivered_lng: deliveryPosition?.lng ?? null
                })
                .eq('id', selectedOrder.id);

            if (updateError) throw updateError;

            // 2b. Update Route Item Status (Dual-write)
            let routeItemUpdate: any = supabase
                .from('route_items')
                .update({
                    status: 'delivered',
                    delivered_at: deliveredAtIso,
                    proof_photo_url: publicUrl,
                    delivered_lat: deliveryPosition?.lat ?? null,
                    delivered_lng: deliveryPosition?.lng ?? null
                });

            if (selectedOrder.route_item_id) {
                routeItemUpdate = routeItemUpdate.eq('id', selectedOrder.route_item_id);
            } else {
                routeItemUpdate = routeItemUpdate.eq('order_id', selectedOrder.id);
                if (selectedOrder.route_id) {
                    routeItemUpdate = routeItemUpdate.eq('route_id', selectedOrder.route_id);
                }
            }

            const { error: itemError } = await routeItemUpdate;

            if (itemError) console.warn("Could not update route_item status:", itemError);

            // 2c. Auto-close route if everything is delivered
            if (selectedOrder.route_id) {
                const { count: remainingItems, error: remainingError } = await supabase
                    .from('route_items')
                    .select('id', { count: 'exact', head: true })
                    .eq('route_id', selectedOrder.route_id)
                    .in('status', ['pending', 'rescheduled', 'failed']);

                if (remainingError) {
                    console.warn("Could not validate remaining items:", remainingError);
                } else if ((remainingItems || 0) === 0) {
                    const { error: routeCloseError } = await supabase
                        .from('delivery_routes')
                        .update({ status: 'completed' })
                        .eq('id', selectedOrder.route_id)
                        .neq('status', 'completed');

                    if (routeCloseError) {
                        console.warn("Could not close route automatically:", routeCloseError);
                    }
                }
            }

            // 3. Trigger Email Notification (Non-blocking)
            supabase.functions.invoke('send-delivery-notification', {
                body: { order_id: selectedOrder.id }
            }).then(({ error }) => {
                if (error) console.error("Error sending email:", error);
                else console.log("Email notification sent successfully.");
            });

            alert("¡Entrega completada exitosamente! Se ha enviado un correo al cliente.");
            setSelectedOrder(null);
            setPhotoFile(null);
            if (photoPreview) URL.revokeObjectURL(photoPreview);
            setPhotoPreview(null);
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
                    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
                        <GoogleMap
                            defaultCenter={{ lat: -33.4489, lng: -70.6693 }}
                            defaultZoom={12}
                            mapId="DRIVER_MAP"
                            className="w-full h-full"
                        >
                            <Directions orders={orders} userLocation={userLocation} />

                            {orders.filter(o => o.client?.lat).map((order, index) => (
                                <AdvancedMarker
                                    key={order.id}
                                    position={{ lat: Number(order.client.lat), lng: Number(order.client.lng) }}
                                    onClick={() => {
                                        if (validateGeofence(order)) setSelectedOrder(order);
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
                    </APIProvider>
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
                                        if (validateGeofence(order)) setSelectedOrder(order);
                                    }}
                                    className="w-full mt-4 bg-slate-900 text-white py-3 rounded-xl font-bold text-sm shadow-lg active:bg-slate-800"
                                >
                                    Entregar
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
                            <button onClick={() => setSelectedOrder(null)} className="p-2 bg-gray-100 rounded-full">
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
                                onChange={handlePhotoSelect}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
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
                            disabled={!photoFile || uploading || deliveryGpsStatus !== 'ready' || !deliveryGps}
                            onClick={handleCompleteDelivery}
                            className="w-full bg-green-500 text-white py-4 rounded-xl font-bold text-lg shadow-xl shadow-green-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {uploading ? (
                                'Subiendo...'
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
    );
};

export default DeliveryRoute;
