import React, { useState, useEffect } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { supabase } from '../services/supabase';
import { Calendar, User, Clock, MapPin, Navigation, Search } from 'lucide-react';

// Component to handle map bounds - Must be child of APIProvider
const MapBoundsHandler = ({ locations }: { locations: any[] }) => {
    const map = useMap('SELLER_ROUTE_MAP');

    useEffect(() => {
        if (!map || locations.length === 0) return;

        const bounds = new google.maps.LatLngBounds();
        let hasValidLocations = false;

        locations.forEach(loc => {
            if (loc.lat && loc.lng) {
                bounds.extend({ lat: Number(loc.lat), lng: Number(loc.lng) });
                hasValidLocations = true;
            }
        });

        if (hasValidLocations) {
            map.fitBounds(bounds);
            // Optional: Adjust zoom if too zoomed in
            const listener = google.maps.event.addListenerOnce(map, "idle", () => {
                if (map && map.getZoom()! > 15) map.setZoom(15);
            });
        }
    }, [map, locations]);

    return null;
};

const SellerRoutes = () => {
    const [locations, setLocations] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [selectedUser, setSelectedUser] = useState<string>('');
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [selectedLocation, setSelectedLocation] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    // Fetch potential sellers
    useEffect(() => {
        const fetchUsers = async () => {
            const { data } = await supabase
                .from('profiles')
                .select('*');

            setUsers(data || []);
        };
        fetchUsers();
    }, []);

    // Fetch locations when filters change
    // Fetch locations logic
    const fetchLocations = async () => {
        if (!selectedUser) return;

        setLoading(true);
        try {
            // Use local date string and create bounds for the entire day
            const startOfDay = new Date(`${selectedDate}T00:00:00`);
            const endOfDay = new Date(`${selectedDate}T23:59:59.999`);

            console.log("Fetching for:", selectedUser, "Date range:", startOfDay.toISOString(), "to", endOfDay.toISOString());

            const { data, error } = await supabase
                .from('seller_locations')
                .select(`
                    *,
                    quotation:quotations(folio, total_amount, client:clients(name))
                `)
                .eq('seller_id', selectedUser)
                .gte('created_at', startOfDay.toISOString())
                .lte('created_at', endOfDay.toISOString())
                .order('created_at', { ascending: true });

            if (error) {
                console.error("Error fetching locations", error);
            } else {
                setLocations(data || []);
            }
        } catch (err) {
            console.error("Fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    // Auto-fetch on user or date change
    useEffect(() => {
        fetchLocations();
    }, [selectedUser, selectedDate]);

    const formatTime = (iso: string) => {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) return <div className="p-8">Missing Google Maps API Key</div>;

    return (
        <div className="flex h-[calc(100vh-100px)] gap-6">
            {/* Sidebar Controls */}
            <div className="w-80 flex flex-col gap-4 shrink-0">
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
                    <h2 className="font-black text-xl text-gray-900 flex items-center">
                        <Navigation className="mr-2 text-indigo-600" size={24} />
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
                                {users.map(u => (
                                    <option key={u.id} value={u.id}>{u.email}</option>
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
                        onClick={fetchLocations}
                        disabled={loading || !selectedUser}
                        className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                    >
                        <Search size={18} className="mr-2" />
                        {loading ? 'Buscando...' : 'Buscar Ruta'}
                    </button>
                </div>

                {/* Timeline List */}
                <div className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 overflow-y-auto">
                    <h3 className="font-bold text-gray-900 mb-4 px-2">Historial ({locations.length})</h3>
                    <div className="space-y-3 relative">
                        {/* Vertical Line */}
                        <div className="absolute left-[19px] top-2 bottom-2 w-0.5 bg-gray-100 z-0"></div>

                        {locations.length === 0 ? (
                            <p className="text-gray-400 text-sm text-center py-8 italic">Sin actividad registrada en esta fecha.</p>
                        ) : (
                            locations.map((loc, idx) => (
                                <div
                                    key={loc.id}
                                    className="relative z-10 flex items-start group cursor-pointer"
                                    onClick={() => setSelectedLocation(loc)}
                                >
                                    <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 border-4 border-white shadow-sm flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                                        <Clock size={16} />
                                    </div>
                                    <div className="ml-3 bg-gray-50 p-3 rounded-xl flex-1 border border-transparent group-hover:border-indigo-100 group-hover:bg-indigo-50/30 transition-all">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-xs text-indigo-600">{formatTime(loc.created_at)}</span>
                                            {loc.quotation && (
                                                <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                                                    Folio #{loc.quotation.folio}
                                                </span>
                                            )}
                                        </div>
                                        {loc.quotation ? (
                                            <p className="text-xs font-medium text-gray-700">
                                                Cotización a <strong>{loc.quotation.client?.name || 'Cliente'}</strong> por ${loc.quotation.total_amount?.toLocaleString()}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-gray-500 italic">Registro de ubicación</p>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Map Area */}
            <div className="flex-1 bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100 relative">
                <APIProvider apiKey={apiKey}>
                    <Map
                        defaultCenter={{ lat: -33.4489, lng: -70.6693 }}
                        defaultZoom={12}
                        mapId="SELLER_ROUTE_MAP"
                        className="w-full h-full"
                    >
                        <MapBoundsHandler locations={locations} />

                        {locations.map((loc, idx) => (
                            <AdvancedMarker
                                key={loc.id}
                                position={{ lat: Number(loc.lat), lng: Number(loc.lng) }}
                                onClick={() => setSelectedLocation(loc)}
                            >
                                <div className="relative">
                                    <div className="bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shadow-lg border-2 border-white">
                                        {idx + 1}
                                    </div>
                                </div>
                            </AdvancedMarker>
                        ))}

                        {selectedLocation && (
                            <InfoWindow
                                position={{ lat: Number(selectedLocation.lat), lng: Number(selectedLocation.lng) }}
                                onCloseClick={() => setSelectedLocation(null)}
                            >
                                <div className="p-2 min-w-[200px]">
                                    <p className="font-bold text-sm mb-1">{formatTime(selectedLocation.created_at)}</p>
                                    {selectedLocation.quotation && (
                                        <>
                                            <p className="text-xs text-gray-500 mb-2">Cliente: {selectedLocation.quotation.client?.name}</p>
                                            <button className="w-full bg-indigo-600 text-white py-1.5 rounded-lg text-xs font-bold">
                                                Ver Cotización #{selectedLocation.quotation.folio}
                                            </button>
                                        </>
                                    )}
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
