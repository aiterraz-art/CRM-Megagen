import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';
import { Truck, Route, Clock3, Camera, RefreshCw, ExternalLink } from 'lucide-react';
import KPICard from '../components/KPICard';

type ActiveRoute = {
    id: string;
    name: string;
    driver_id: string | null;
    created_at: string;
    pendingCount: number;
    deliveredCount: number;
    driverName: string;
};

type PendingDelivery = {
    id: string;
    sequence_order: number | null;
    route_id: string | null;
    status: string;
    routeName: string;
    folio: number | null;
    clientName: string;
    address: string;
};

type DeliveryProof = {
    id: string;
    folio: number | null;
    delivered_at: string | null;
    delivery_photo_url: string | null;
    clientName: string;
    address: string;
};

const AdministrativeDashboard = () => {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [activeRoutes, setActiveRoutes] = useState<ActiveRoute[]>([]);
    const [pendingDeliveries, setPendingDeliveries] = useState<PendingDelivery[]>([]);
    const [deliveryProofs, setDeliveryProofs] = useState<DeliveryProof[]>([]);

    const [dispatchedOrdersCount, setDispatchedOrdersCount] = useState(0);
    const [activeRoutesCount, setActiveRoutesCount] = useState(0);
    const [pendingDeliveriesCount, setPendingDeliveriesCount] = useState(0);
    const [proofsTodayCount, setProofsTodayCount] = useState(0);

    const fetchDashboard = useCallback(async () => {
        try {
            const now = new Date();
            const startOfDay = new Date(now);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(now);
            endOfDay.setHours(23, 59, 59, 999);

            const [
                { data: routesData, error: routesError },
                { data: routeItemsData, error: routeItemsError },
                { data: pendingItemsData, error: pendingItemsError },
                { count: dispatchedCount, error: dispatchedError },
                { data: proofsData, error: proofsError },
                { count: proofsCountToday, error: proofsCountError },
            ] = await Promise.all([
                supabase
                    .from('delivery_routes')
                    .select('id, name, driver_id, created_at')
                    .eq('status', 'in_progress')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('route_items')
                    .select('route_id, status'),
                supabase
                    .from('route_items')
                    .select(`
                        id, route_id, sequence_order, status,
                        route:delivery_routes(name),
                        order:orders(folio, client:clients(name, address))
                    `)
                    .in('status', ['pending', 'rescheduled'])
                    .order('sequence_order', { ascending: true })
                    .limit(30),
                supabase
                    .from('orders')
                    .select('id', { count: 'exact', head: true })
                    .eq('delivery_status', 'out_for_delivery'),
                supabase
                    .from('orders')
                    .select('id, folio, delivered_at, delivery_photo_url, client:clients(name, address)')
                    .eq('delivery_status', 'delivered')
                    .not('delivery_photo_url', 'is', null)
                    .order('delivered_at', { ascending: false })
                    .limit(18),
                supabase
                    .from('orders')
                    .select('id', { count: 'exact', head: true })
                    .eq('delivery_status', 'delivered')
                    .not('delivery_photo_url', 'is', null)
                    .gte('delivered_at', startOfDay.toISOString())
                    .lte('delivered_at', endOfDay.toISOString()),
            ]);

            if (routesError) throw routesError;
            if (routeItemsError) throw routeItemsError;
            if (pendingItemsError) throw pendingItemsError;
            if (dispatchedError) throw dispatchedError;
            if (proofsError) throw proofsError;
            if (proofsCountError) throw proofsCountError;

            const routes = routesData || [];
            const routeItems = routeItemsData || [];
            const driverIds = Array.from(new Set(routes.map((r: any) => r.driver_id).filter(Boolean)));

            let driverNameById: Record<string, string> = {};
            if (driverIds.length > 0) {
                const { data: drivers } = await supabase
                    .from('profiles')
                    .select('id, full_name, email')
                    .in('id', driverIds as string[]);
                (drivers || []).forEach((d: any) => {
                    driverNameById[d.id] = d.full_name || d.email || 'Repartidor';
                });
            }

            const active = routes.map((r: any) => {
                const items = routeItems.filter((i: any) => i.route_id === r.id);
                const pendingCount = items.filter((i: any) => i.status === 'pending' || i.status === 'rescheduled').length;
                const deliveredCount = items.filter((i: any) => i.status === 'delivered').length;
                return {
                    id: r.id,
                    name: r.name || 'Ruta',
                    driver_id: r.driver_id,
                    created_at: r.created_at,
                    pendingCount,
                    deliveredCount,
                    driverName: driverNameById[r.driver_id || ''] || 'Sin repartidor',
                } as ActiveRoute;
            });
            setActiveRoutes(active);
            setActiveRoutesCount(active.length);

            const pendingRows = (pendingItemsData || []).map((row: any) => ({
                id: row.id,
                sequence_order: row.sequence_order,
                route_id: row.route_id,
                status: row.status,
                routeName: row.route?.name || 'Ruta',
                folio: row.order?.folio ?? null,
                clientName: row.order?.client?.name || 'Cliente',
                address: row.order?.client?.address || 'Sin dirección',
            })) as PendingDelivery[];
            setPendingDeliveries(pendingRows);
            setPendingDeliveriesCount(pendingRows.length);

            const proofRows = (proofsData || []).map((p: any) => ({
                id: p.id,
                folio: p.folio ?? null,
                delivered_at: p.delivered_at,
                delivery_photo_url: p.delivery_photo_url,
                clientName: p.client?.name || 'Cliente',
                address: p.client?.address || 'Sin dirección',
            })) as DeliveryProof[];
            setDeliveryProofs(proofRows);

            setDispatchedOrdersCount(dispatchedCount || 0);
            setProofsTodayCount(proofsCountToday || 0);
        } catch (error: any) {
            console.error('AdministrativeDashboard error:', error);
            alert(`Error cargando dashboard backoffice: ${error?.message || 'desconocido'}`);
        }
    }, []);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            await fetchDashboard();
            setLoading(false);
        };
        load();
    }, [fetchDashboard]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchDashboard();
        setRefreshing(false);
    };

    const pendingByRoute = useMemo(() => {
        const map = new Map<string, number>();
        pendingDeliveries.forEach((p) => map.set(p.routeName, (map.get(p.routeName) || 0) + 1));
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [pendingDeliveries]);

    if (loading) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent animate-spin rounded-full"></div>
                <p className="text-gray-500 font-bold uppercase tracking-widest text-xs">Cargando panel backoffice...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 w-full mx-auto px-4 pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black text-gray-900 tracking-tight">Dashboard Backoffice</h1>
                    <p className="text-gray-500 font-medium mt-1">Seguimiento operativo de despacho, rutas y pruebas de entrega.</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="px-5 py-3 rounded-2xl bg-white border border-gray-100 text-gray-700 font-bold shadow-sm hover:bg-gray-50 disabled:opacity-60 flex items-center gap-2"
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard title="Pedidos Despachados" value={dispatchedOrdersCount} icon={Truck} color="amber" />
                <KPICard title="Rutas Activas" value={activeRoutesCount} icon={Route} color="indigo" />
                <KPICard title="Pendientes Entrega" value={pendingDeliveriesCount} icon={Clock3} color="blue" />
                <KPICard title="Pruebas Hoy" value={proofsTodayCount} icon={Camera} color="emerald" />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 premium-card overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                        <h3 className="text-lg font-black text-gray-900">Rutas activas</h3>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {activeRoutes.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">No hay rutas activas en este momento.</div>
                        ) : (
                            activeRoutes.map((r) => (
                                <div key={r.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div>
                                        <p className="font-black text-gray-900">{r.name}</p>
                                        <p className="text-xs text-gray-500 font-bold">{r.driverName}</p>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-100">
                                            Pendientes: {r.pendingCount}
                                        </span>
                                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-100">
                                            Entregados: {r.deliveredCount}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="premium-card p-5">
                    <h3 className="text-lg font-black text-gray-900 mb-4">Pendientes por ruta</h3>
                    <div className="space-y-3">
                        {pendingByRoute.length === 0 ? (
                            <p className="text-sm text-gray-400 italic">Sin pendientes.</p>
                        ) : (
                            pendingByRoute.map(([name, count]) => (
                                <div key={name} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                                    <span className="text-sm font-bold text-gray-700">{name}</span>
                                    <span className="text-xs font-black text-indigo-600">{count}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="premium-card overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                        <h3 className="text-lg font-black text-gray-900">Pedidos pendientes de entrega</h3>
                    </div>
                    <div className="max-h-[420px] overflow-auto">
                        {pendingDeliveries.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">No hay pedidos pendientes.</div>
                        ) : (
                            pendingDeliveries.map((p) => (
                                <div key={p.id} className="p-4 border-b border-gray-50 last:border-0">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-black text-gray-900">#{p.folio || p.id.slice(0, 8)} · {p.clientName}</p>
                                        <span className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-lg">
                                            {p.routeName}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">{p.address}</p>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="premium-card overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                        <h3 className="text-lg font-black text-gray-900">Pruebas de entrega</h3>
                    </div>
                    <div className="max-h-[420px] overflow-auto">
                        {deliveryProofs.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 italic">Aún no hay comprobantes de entrega.</div>
                        ) : (
                            deliveryProofs.map((proof) => (
                                <div key={proof.id} className="p-4 border-b border-gray-50 last:border-0 flex items-start gap-3">
                                    <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 border border-gray-100 shrink-0">
                                        {proof.delivery_photo_url ? (
                                            <img src={proof.delivery_photo_url} alt="Prueba entrega" className="w-full h-full object-cover" />
                                        ) : null}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-black text-gray-900 text-sm truncate">#{proof.folio || proof.id.slice(0, 8)} · {proof.clientName}</p>
                                        <p className="text-xs text-gray-500 truncate">{proof.address}</p>
                                        <p className="text-[11px] text-gray-400 font-bold mt-1">
                                            {proof.delivered_at ? new Date(proof.delivered_at).toLocaleString() : 'Sin fecha'}
                                        </p>
                                    </div>
                                    {proof.delivery_photo_url && (
                                        <a
                                            href={proof.delivery_photo_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-2 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                                            title="Abrir comprobante"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdministrativeDashboard;
