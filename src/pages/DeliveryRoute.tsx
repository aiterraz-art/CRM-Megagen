import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { MapPin, Phone, CheckCircle2, Camera, Navigation, ArrowLeft, AlertTriangle } from 'lucide-react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

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
    const { profile } = useUser();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState<any>(null);
    const [isMapMode, setIsMapMode] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Geofencing State
    const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [debugMode, setDebugMode] = useState(false);

    // For Photo Upload
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);

    const [routeName, setRouteName] = useState<string>("Ruta de Hoy");

    const fetchRoute = async () => {
        setLoading(true);
        try {
            if (!profile?.id) throw new Error("No hay perfil activo");

            // 1. Get Active Routes for this User (Use profile.id for impersonation support)
            const { data: myRoutes, error: routeError } = await supabase
                .from('delivery_routes')
                .select('id, name')
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
                    id, status, sequence_order, notes,
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

        // Track location
        if (navigator.geolocation) {
            const watchId = navigator.geolocation.watchPosition(
                (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                (err) => console.error("Location error", err),
                { enableHighAccuracy: true }
            );
            return () => navigator.geolocation.clearWatch(watchId);
        }
    }, [profile?.id]); // Re-fetch if profile changes (Impersonation)

    // Debug: Teleport function
    const handleTeleport = (lat: number, lng: number) => {
        setUserLocation({ lat, lng });
        alert(`📍 Teletransportado a: ${lat}, ${lng}`);
    };

    const validateGeofence = (order: any) => {
        // [DEBUG] If debug mode is active, always allow
        if (debugMode) {
            console.log("Geofence bypassed (Debug Mode)");
            return true;
        }

        // If client has no coords, we can't validate, so allow.
        if (!order.client?.lat || !order.client?.lng) return true;

        if (!userLocation) {
            alert("⚠️ No se ha detectado tu ubicación. Activa el GPS.");
            return false;
        }

        const dist = calculateDistance(userLocation.lat, userLocation.lng, order.client.lat, order.client.lng);
        if (dist > 500) {
            alert(`⛔ Estás muy lejos del punto de entrega (${Math.round(dist)}m). Debes estar a menos de 500m. (Tip: Activa Modo Debug para omitir esto)`);
            return false;
        }
        return true;
    };

    const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setPhotoFile(file);
            setPhotoPreview(URL.createObjectURL(file));
        }
    };

    const handleCompleteDelivery = async () => {
        if (!selectedOrder || !photoFile) return;

        setUploading(true);
        try {
            // 1. Upload Photo
            const fileExt = photoFile.name.split('.').pop();
            const fileName = `${selectedOrder.id}_${Date.now()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('delivery-proofs')
                .upload(filePath, photoFile);

            if (uploadError) throw uploadError;

            // Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('delivery-proofs')
                .getPublicUrl(filePath);

            // 2. Update Order
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    delivery_status: 'delivered',
                    delivered_at: new Date().toISOString(),
                    delivery_photo_url: publicUrl
                })
                .eq('id', selectedOrder.id);

            if (updateError) throw updateError;

            // 2b. Update Route Item Status (Dual-write)
            const { error: itemError } = await supabase
                .from('route_items')
                .update({
                    status: 'delivered',
                    delivered_at: new Date().toISOString(),
                    proof_photo_url: publicUrl
                })
                .eq('order_id', selectedOrder.id);

            if (itemError) console.warn("Could not update route_item status:", itemError);

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
            setPhotoPreview(null);
            fetchRoute(); // Refresh list

        } catch (error: any) {
            console.error("Error completing delivery:", error);
            alert("Error al finalizar entrega: " + error.message);
        } finally {
            setUploading(false);
        }
    };

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
                    <button
                        onClick={() => setDebugMode(!debugMode)}
                        className={`p-2 rounded-full ${debugMode ? 'bg-amber-100 text-amber-600' : 'bg-slate-800 text-slate-500'}`}
                    >
                        <AlertTriangle size={16} />
                    </button>
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
                                        #{selectedOrder?.folio || order.id.slice(0, 8)}
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
                                {debugMode && order.client?.lat && order.client?.lng && (
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

                        <button
                            disabled={!photoFile || uploading}
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
