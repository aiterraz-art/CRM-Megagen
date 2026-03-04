import React, { useEffect, useMemo, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { supabase } from '../services/supabase';
import { Calendar, User, Clock, Navigation, Search, Route as RouteIcon } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

type RoutePoint = {
    id: string;
    lat: number;
    lng: number;
    timestamp: string;
    kind: 'quotation' | 'visit_checkin' | 'visit_checkout';
    quotationFolio?: number | null;
    quotationAmount?: number | null;
    clientName?: string | null;
    visitType?: string | null;
    visitStatus?: string | null;
};

const isValidCoordinate = (value: any) => typeof value === 'number' && !Number.isNaN(value) && value !== 0;

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const MapBoundsHandler = ({ points }: { points: RoutePoint[] }) => {
    const map = useMap('SELLER_ROUTE_MAP');

    useEffect(() => {
        if (!map || points.length === 0) return;
        const bounds = new google.maps.LatLngBounds();
        points.forEach((point) => bounds.extend({ lat: point.lat, lng: point.lng }));
        map.fitBounds(bounds);

        const listener = google.maps.event.addListenerOnce(map, 'idle', () => {
            if (map.getZoom() && map.getZoom()! > 16) {
                map.setZoom(16);
            }
        });
        return () => google.maps.event.removeListener(listener);
    }, [map, points]);

    return null;
};

const RoutePolyline = ({ points }: { points: RoutePoint[] }) => {
    const map = useMap('SELLER_ROUTE_MAP');

    useEffect(() => {
        if (!map || points.length < 2) return;

        const path = points.map((point) => ({ lat: point.lat, lng: point.lng }));
        const polyline = new google.maps.Polyline({
            path,
            geodesic: true,
            strokeColor: '#4f46e5',
            strokeOpacity: 0.9,
            strokeWeight: 4,
            map
        });

        return () => polyline.setMap(null);
    }, [map, points]);

    return null;
};

const markerStyle = (kind: RoutePoint['kind']) => {
    if (kind === 'visit_checkin') return { bg: 'bg-emerald-600', label: 'IN' };
    if (kind === 'visit_checkout') return { bg: 'bg-orange-500', label: 'OUT' };
    return { bg: 'bg-indigo-600', label: 'Q' };
};

const pointDescription = (point: RoutePoint) => {
    if (point.kind === 'quotation') {
        return `Cotización ${point.quotationFolio ? `#${point.quotationFolio}` : ''} ${point.clientName ? `a ${point.clientName}` : ''}`.trim();
    }
    if (point.kind === 'visit_checkin') {
        return `Check-in de visita${point.clientName ? ` en ${point.clientName}` : ''}`;
    }
    return `Check-out de visita${point.clientName ? ` en ${point.clientName}` : ''}`;
};

const SellerRoutes = () => {
    const { isSupervisor, effectiveRole } = useUser();
    const [users, setUsers] = useState<Array<{ id: string; email: string | null; full_name: string | null }>>([]);
    const [selectedUser, setSelectedUser] = useState<string>('');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [selectedPoint, setSelectedPoint] = useState<RoutePoint | null>(null);
    const [loading, setLoading] = useState(false);
    const [points, setPoints] = useState<RoutePoint[]>([]);

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    useEffect(() => {
        const fetchUsers = async () => {
            const { data } = await supabase
                .from('profiles')
                .select('id, email, full_name, role, status');
            const normalized = (data || []).filter((p: any) => {
                const role = (p.role || '').toLowerCase();
                const status = (p.status || '').toLowerCase();
                return (role === 'seller' || role === 'jefe' || role === 'manager') && (status === '' || status === 'active');
            });
            setUsers(normalized as any);
        };
        fetchUsers();
    }, []);

    const fetchRoutePoints = async () => {
        if (!selectedUser) return;
        setLoading(true);
        try {
            const startOfDay = new Date(`${selectedDate}T00:00:00`);
            const endOfDay = new Date(`${selectedDate}T23:59:59.999`);
            const startIso = startOfDay.toISOString();
            const endIso = endOfDay.toISOString();

            const [quotationResp, visitsCheckinResp, visitsCheckoutResp] = await Promise.all([
                supabase
                    .from('seller_locations')
                    .select('id, lat, lng, created_at, quotation:quotations(folio, total_amount, client:clients(name))')
                    .eq('seller_id', selectedUser)
                    .gte('created_at', startIso)
                    .lte('created_at', endIso),
                supabase
                    .from('visits')
                    .select('id, check_in_time, lat, lng, type, status, client:clients(name)')
                    .eq('sales_rep_id', selectedUser)
                    .gte('check_in_time', startIso)
                    .lte('check_in_time', endIso),
                supabase
                    .from('visits')
                    .select('id, check_out_time, check_out_lat, check_out_lng, type, status, client:clients(name)')
                    .eq('sales_rep_id', selectedUser)
                    .gte('check_out_time', startIso)
                    .lte('check_out_time', endIso)
            ]);

            if (quotationResp.error) throw quotationResp.error;
            if (visitsCheckinResp.error) throw visitsCheckinResp.error;
            if (visitsCheckoutResp.error) throw visitsCheckoutResp.error;

            const quotationPoints: RoutePoint[] = (quotationResp.data || [])
                .filter((row: any) => isValidCoordinate(Number(row.lat)) && isValidCoordinate(Number(row.lng)))
                .map((row: any) => {
                    const clientJoined = Array.isArray(row.quotation?.client) ? row.quotation?.client[0] : row.quotation?.client;
                    return {
                        id: `quote-${row.id}`,
                        lat: Number(row.lat),
                        lng: Number(row.lng),
                        timestamp: row.created_at,
                        kind: 'quotation',
                        quotationFolio: row.quotation?.folio || null,
                        quotationAmount: row.quotation?.total_amount || null,
                        clientName: clientJoined?.name || null
                    };
                });

            const checkinPoints: RoutePoint[] = (visitsCheckinResp.data || [])
                .filter((row: any) => row.check_in_time && isValidCoordinate(Number(row.lat)) && isValidCoordinate(Number(row.lng)))
                .map((row: any) => {
                    const clientJoined = Array.isArray(row.client) ? row.client[0] : row.client;
                    return {
                        id: `in-${row.id}`,
                        lat: Number(row.lat),
                        lng: Number(row.lng),
                        timestamp: row.check_in_time,
                        kind: 'visit_checkin',
                        clientName: clientJoined?.name || null,
                        visitType: row.type || null,
                        visitStatus: row.status || null
                    };
                });

            const checkoutPoints: RoutePoint[] = (visitsCheckoutResp.data || [])
                .filter((row: any) => row.check_out_time && isValidCoordinate(Number(row.check_out_lat)) && isValidCoordinate(Number(row.check_out_lng)))
                .map((row: any) => {
                    const clientJoined = Array.isArray(row.client) ? row.client[0] : row.client;
                    return {
                        id: `out-${row.id}`,
                        lat: Number(row.check_out_lat),
                        lng: Number(row.check_out_lng),
                        timestamp: row.check_out_time,
                        kind: 'visit_checkout',
                        clientName: clientJoined?.name || null,
                        visitType: row.type || null,
                        visitStatus: row.status || null
                    };
                });

            const merged = [...quotationPoints, ...checkinPoints, ...checkoutPoints].sort(
                (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            setPoints(merged);
        } catch (error: any) {
            console.error('Error fetching seller route points:', error);
            alert(`No se pudo cargar la ruta: ${error?.message || 'desconocido'}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchRoutePoints();
    }, [selectedUser, selectedDate]);

    const timelineTitle = useMemo(() => {
        const quotations = points.filter((p) => p.kind === 'quotation').length;
        const checkins = points.filter((p) => p.kind === 'visit_checkin').length;
        const checkouts = points.filter((p) => p.kind === 'visit_checkout').length;
        return `Historial (${points.length}) · Q:${quotations} IN:${checkins} OUT:${checkouts}`;
    }, [points]);

    if (effectiveRole === 'seller' || !isSupervisor) return <Navigate to="/" />;
    if (!apiKey) return <div className="p-8">Missing Google Maps API Key</div>;

    return (
        <div className="flex h-[calc(100vh-100px)] gap-6">
            <div className="w-80 flex flex-col gap-4 shrink-0">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
                    <h2 className="font-black text-xl text-gray-900 flex items-center">
                        <RouteIcon className="mr-2 text-indigo-600" size={24} />
                        Rutas de Venta
                    </h2>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Vendedor</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <select
                                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
                                value={selectedUser}
                                onChange={(e) => setSelectedUser(e.target.value)}
                            >
                                <option value="">Seleccionar Vendedor...</option>
                                {users.map((u) => (
                                    <option key={u.id} value={u.id}>{u.full_name || u.email || u.id}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Fecha</label>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input
                                type="date"
                                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        onClick={() => void fetchRoutePoints()}
                        disabled={loading || !selectedUser}
                        className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                    >
                        <Search size={18} className="mr-2" />
                        {loading ? 'Buscando...' : 'Buscar Ruta'}
                    </button>
                </div>

                <div className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 overflow-y-auto">
                    <h3 className="font-bold text-gray-900 mb-4 px-2">{timelineTitle}</h3>
                    <div className="space-y-3 relative">
                        <div className="absolute left-[19px] top-2 bottom-2 w-0.5 bg-gray-100 z-0"></div>
                        {points.length === 0 ? (
                            <p className="text-gray-400 text-sm text-center py-8 italic">Sin actividad GPS registrada en esta fecha.</p>
                        ) : (
                            points.map((point) => {
                                const style = markerStyle(point.kind);
                                return (
                                    <div
                                        key={point.id}
                                        className="relative z-10 flex items-start group cursor-pointer"
                                        onClick={() => setSelectedPoint(point)}
                                    >
                                        <div className={`w-10 h-10 rounded-full ${style.bg} text-white border-4 border-white shadow-sm flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform text-[10px] font-black`}>
                                            {style.label}
                                        </div>
                                        <div className="ml-3 bg-gray-50 p-3 rounded-xl flex-1 border border-transparent group-hover:border-indigo-100 group-hover:bg-indigo-50/30 transition-all">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-bold text-xs text-indigo-600 inline-flex items-center">
                                                    <Clock size={12} className="mr-1" /> {formatTime(point.timestamp)}
                                                </span>
                                            </div>
                                            <p className="text-xs font-medium text-gray-700">{pointDescription(point)}</p>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 relative">
                <APIProvider apiKey={apiKey}>
                    <Map
                        defaultCenter={{ lat: -33.4489, lng: -70.6693 }}
                        defaultZoom={12}
                        mapId="SELLER_ROUTE_MAP"
                        className="w-full h-full"
                    >
                        <MapBoundsHandler points={points} />
                        <RoutePolyline points={points} />

                        {points.map((point, idx) => {
                            const style = markerStyle(point.kind);
                            return (
                                <AdvancedMarker
                                    key={point.id}
                                    position={{ lat: point.lat, lng: point.lng }}
                                    onClick={() => setSelectedPoint(point)}
                                >
                                    <div className={`relative ${style.bg} text-white w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shadow-lg border-2 border-white`}>
                                        {idx + 1}
                                    </div>
                                </AdvancedMarker>
                            );
                        })}

                        {selectedPoint && (
                            <InfoWindow
                                position={{ lat: selectedPoint.lat, lng: selectedPoint.lng }}
                                onCloseClick={() => setSelectedPoint(null)}
                            >
                                <div className="p-2 min-w-[220px]">
                                    <p className="font-bold text-sm mb-1">{formatTime(selectedPoint.timestamp)}</p>
                                    <p className="text-xs text-gray-600 mb-2">{pointDescription(selectedPoint)}</p>
                                    {selectedPoint.kind === 'quotation' && selectedPoint.quotationAmount ? (
                                        <p className="text-xs font-black text-indigo-700">Monto: ${Number(selectedPoint.quotationAmount).toLocaleString('es-CL')}</p>
                                    ) : null}
                                    {selectedPoint.visitType ? (
                                        <p className="text-xs text-gray-500">Tipo visita: {selectedPoint.visitType}</p>
                                    ) : null}
                                </div>
                            </InfoWindow>
                        )}
                    </Map>
                </APIProvider>
            </div>
        </div>
    );
};

export default SellerRoutes;
