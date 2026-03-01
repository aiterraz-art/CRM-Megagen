import React, { useEffect, useMemo, useState } from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Truck, MapPin, Clock3, CheckCircle2, Navigation } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

type OrderRow = {
    id: string;
    folio: number | null;
    created_at: string | null;
    delivery_status: string | null;
    route_id?: string | null;
    delivered_at?: string | null;
    total_amount?: number | null;
    client?: {
        name?: string | null;
        address?: string | null;
        lat?: number | null;
        lng?: number | null;
    } | null;
};

type RouteItemRow = {
    id: string;
    route_id: string;
    order_id: string;
    sequence_order: number;
    status: string;
};

type DeliveryRouteRow = {
    id: string;
    driver_id: string | null;
};

type ProfileRow = {
    id: string;
    full_name: string | null;
    email: string | null;
};

const OFFICE_LOCATION = { lat: -33.3768, lng: -70.6725 };

const StatusContent: React.FC = () => {
    const { profile, effectiveRole } = useUser();
    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [routeItems, setRouteItems] = useState<RouteItemRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [etaByOrder, setEtaByOrder] = useState<Record<string, string>>({});
    const [driverNameByRoute, setDriverNameByRoute] = useState<Record<string, string>>({});
    const routesLibrary = useMapsLibrary('routes');

    const fetchData = async () => {
        if (!profile?.id) return;
        setLoading(true);
        try {
            const buildBaseQuery = () =>
                supabase
                    .from('orders')
                    .select(`
          id, folio, created_at, delivery_status, route_id, delivered_at, total_amount,
          client:clients(name, address, lat, lng)
        `)
                    .order('created_at', { ascending: false })
                    .limit(300);

            // Prefer seller_id, fallback to user_id if schema differs.
            const firstTry = await (buildBaseQuery() as any).eq('seller_id', profile.id);
            let data: any[] | null = firstTry.data;
            let error: any = firstTry.error;
            const firstErrorText = String(error?.message || '').toLowerCase();
            if (error && (firstErrorText.includes('column orders.seller_id does not exist') || firstErrorText.includes('seller_id'))) {
                const secondTry = await (buildBaseQuery() as any).eq('user_id', profile.id);
                data = secondTry.data;
                error = secondTry.error;
            }
            const secondErrorText = String(error?.message || '').toLowerCase();
            if (error && (secondErrorText.includes('column orders.user_id does not exist') || secondErrorText.includes('user_id'))) {
                error = new Error('Tu instancia no tiene seller_id ni user_id en orders. Debemos mapear el dueño del pedido.');
            }
            if (error) throw error;

            const loadedOrders = (data || []) as OrderRow[];
            setOrders(loadedOrders);

            const routeIds = Array.from(new Set(loadedOrders.map((o) => o.route_id).filter(Boolean)));
            if (routeIds.length > 0) {
                const { data: items, error: itemsError } = await supabase
                    .from('route_items')
                    .select('id, route_id, order_id, sequence_order, status')
                    .in('route_id', routeIds as string[]);
                if (itemsError) throw itemsError;
                setRouteItems((items || []) as RouteItemRow[]);

                const { data: routeRows, error: routeError } = await supabase
                    .from('delivery_routes')
                    .select('id, driver_id')
                    .in('id', routeIds as string[]);
                if (routeError) throw routeError;
                const routes = (routeRows || []) as DeliveryRouteRow[];
                const driverIds = Array.from(new Set(routes.map((r) => r.driver_id).filter(Boolean))) as string[];
                let profileMap: Record<string, string> = {};
                if (driverIds.length > 0) {
                    const { data: profiles, error: profileError } = await supabase
                        .from('profiles')
                        .select('id, full_name, email')
                        .in('id', driverIds);
                    if (profileError) throw profileError;
                    (profiles || []).forEach((p: ProfileRow) => {
                        profileMap[p.id] = p.full_name || p.email || 'Repartidor';
                    });
                }
                const routeDriverMap: Record<string, string> = {};
                routes.forEach((r) => {
                    routeDriverMap[r.id] = r.driver_id ? (profileMap[r.driver_id] || 'Repartidor') : 'Sin repartidor';
                });
                setDriverNameByRoute(routeDriverMap);
            } else {
                setRouteItems([]);
                setDriverNameByRoute({});
            }
        } catch (err: any) {
            alert(`Error cargando estado de pedidos: ${err.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const id = window.setInterval(fetchData, 60000);
        return () => window.clearInterval(id);
    }, [profile?.id]);

    const queueByOrder = useMemo(() => {
        const byRoute = new Map<string, RouteItemRow[]>();
        routeItems.forEach((ri) => {
            if (!byRoute.has(ri.route_id)) byRoute.set(ri.route_id, []);
            byRoute.get(ri.route_id)!.push(ri);
        });
        byRoute.forEach((items) => items.sort((a, b) => a.sequence_order - b.sequence_order));

        const result: Record<string, number> = {};
        orders.forEach((o) => {
            if (!o.route_id) {
                result[o.id] = -1;
                return;
            }
            const items = byRoute.get(o.route_id) || [];
            const current = items.find((x) => x.order_id === o.id);
            if (!current) {
                result[o.id] = -1;
                return;
            }
            if (current.status === 'delivered' || o.delivery_status === 'delivered') {
                result[o.id] = 0;
                return;
            }
            const pendingBefore = items.filter((x) =>
                x.sequence_order < current.sequence_order &&
                ['pending', 'rescheduled', 'failed'].includes((x.status || '').toLowerCase())
            ).length;
            result[o.id] = pendingBefore;
        });
        return result;
    }, [orders, routeItems]);

    useEffect(() => {
        if (!routesLibrary || orders.length === 0) return;
        const service = new routesLibrary.DirectionsService();
        const candidates = orders
            .filter((o) =>
                (o.delivery_status || '').toLowerCase() === 'out_for_delivery' &&
                Number.isFinite(Number(o.client?.lat)) &&
                Number.isFinite(Number(o.client?.lng))
            )
            .slice(0, 20);

        if (candidates.length === 0) {
            setEtaByOrder({});
            return;
        }

        (async () => {
            const next: Record<string, string> = {};
            for (const order of candidates) {
                try {
                    const response = await service.route({
                        origin: OFFICE_LOCATION,
                        destination: { lat: Number(order.client!.lat), lng: Number(order.client!.lng) },
                        travelMode: google.maps.TravelMode.DRIVING
                    });
                    const leg = response.routes?.[0]?.legs?.[0];
                    if (leg?.duration?.text) next[order.id] = leg.duration.text;
                } catch (_err) {
                    // ignore and fallback below
                }
            }
            setEtaByOrder(next);
        })();
    }, [routesLibrary, orders]);

    if (effectiveRole !== 'seller' && effectiveRole !== 'admin' && effectiveRole !== 'jefe') {
        return <div className="p-8 font-bold text-gray-500">Acceso denegado.</div>;
    }

    if (loading) return <div className="p-8 font-bold text-gray-500">Cargando estado de entregas...</div>;

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-black text-gray-900 flex items-center gap-2">
                    <Truck className="text-indigo-600" /> Estado de Entregas
                </h2>
                <p className="text-gray-500 font-medium">Seguimiento de tus pedidos despachados y en ruta</p>
            </div>

            {orders.length === 0 ? (
                <div className="bg-white rounded-3xl p-10 border border-gray-100 text-center text-gray-400 font-bold">
                    No tienes pedidos para seguimiento.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {orders.map((o) => {
                        const status = (o.delivery_status || 'pending').toLowerCase();
                        const queue = queueByOrder[o.id] ?? -1;
                        const etaFallbackMin = queue >= 0 ? Math.max(10, queue * 15 + 15) : null;
                        const etaGoogle = etaByOrder[o.id];
                        const etaText = status === 'delivered'
                            ? 'Entregado'
                            : etaGoogle
                                ? `ETA Google: ${etaGoogle}`
                                : etaFallbackMin !== null
                                    ? `ETA aprox: ${etaFallbackMin} min`
                                    : 'Sin ETA';

                        return (
                            <div key={o.id} className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-black uppercase text-indigo-500 bg-indigo-50 px-2 py-1 rounded-md">
                                        Folio #{o.folio || o.id.slice(0, 8)}
                                    </span>
                                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${status === 'delivered' ? 'bg-emerald-100 text-emerald-700' : status === 'out_for_delivery' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                                        {status === 'delivered' ? 'Entregado' : status === 'out_for_delivery' ? 'En Proceso' : 'Programado'}
                                    </span>
                                </div>
                                <h3 className="font-black text-gray-900">{o.client?.name || 'Cliente'}</h3>
                                <p className="text-xs text-gray-500 mt-1 flex items-start gap-1">
                                    <MapPin size={12} className="mt-0.5" /> {o.client?.address || 'Sin dirección'}
                                </p>

                                <div className="mt-3 space-y-1">
                                    <p className="text-xs font-bold text-gray-600 flex items-center gap-1">
                                        <Clock3 size={12} />
                                        {queue < 0 ? 'Pendiente de programación' : queue === 0 ? 'Próxima entrega' : `A ${queue} pedidos de entregar`}
                                    </p>
                                    <p className="text-xs font-bold text-indigo-600">{etaText}</p>
                                    <p className="text-xs text-gray-600 font-bold">
                                        Repartidor: {o.route_id ? (driverNameByRoute[o.route_id] || 'Sin repartidor') : 'No asignado'}
                                    </p>
                                    {status === 'delivered' && (
                                        <p className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                                            <CheckCircle2 size={12} /> Entregado: {o.delivered_at ? new Date(o.delivered_at).toLocaleString() : 'registrado'}
                                        </p>
                                    )}
                                </div>
                                <div className="mt-3">
                                    <a
                                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.client?.address || '')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-xs font-black text-indigo-600 hover:text-indigo-700"
                                    >
                                        <Navigation size={12} />
                                        Ver ruta en Google Maps
                                    </a>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const MyDeliveries: React.FC = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    if (!apiKey) return <StatusContent />;
    return (
        <APIProvider apiKey={apiKey}>
            <StatusContent />
        </APIProvider>
    );
};

export default MyDeliveries;
