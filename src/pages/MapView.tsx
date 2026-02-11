import { useState, useEffect, useCallback } from 'react';
import { APIProvider, Map, Marker, InfoWindow, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { clientService } from '../services/clientService';
import { Database } from '../types/supabase';
import { MapPin, Search, Crosshair, Navigation, Plus, UserPlus, History, X, Calendar, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { calculateDistance } from '../utils/geo';

type Client = Database['public']['Tables']['clients']['Row'];
type ClientInsert = Database['public']['Tables']['clients']['Insert'];

const isValidLoc = (lat: any, lng: any) => {
    const nLat = Number(lat);
    const nLng = Number(lng);
    return !isNaN(nLat) && !isNaN(nLng) && (nLat !== 0 || nLng !== 0);
};

const Circle = ({ center, radius, map }: { center: google.maps.LatLngLiteral, radius: number, map: google.maps.Map | null }) => {
    const [circle, setCircle] = useState<google.maps.Circle | null>(null);

    useEffect(() => {
        if (!map) return;
        const newCircle = new google.maps.Circle({
            strokeColor: '#6366f1',
            strokeOpacity: 0.8,
            strokeWeight: 1,
            fillColor: '#6366f1',
            fillOpacity: 0.1,
            map,
            center,
            radius,
        });
        setCircle(newCircle);

        return () => {
            newCircle.setMap(null);
        };
    }, [map]);

    useEffect(() => {
        if (circle) {
            circle.setCenter(center);
            circle.setRadius(radius);
        }
    }, [circle, center, radius]);

    return null;
};

const MapContent = () => {
    const navigate = useNavigate();
    const map = useMap();
    const placesLib = useMapsLibrary('places');
    const markerLib = useMapsLibrary('marker');

    const [clients, setClients] = useState<Client[]>([]);
    const [leads, setLeads] = useState<google.maps.places.PlaceResult[]>([]);
    const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
    const [radius, setRadius] = useState<number>(2); // km
    const [search, setSearch] = useState('');
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [selectedLead, setSelectedLead] = useState<google.maps.places.PlaceResult | null>(null);
    const [placesService, setPlacesService] = useState<google.maps.places.PlacesService | null>(null);
    const [isSearchingLeads, setIsSearchingLeads] = useState(false);



    // Tracking state
    const { profile, isSupervisor, hasPermission } = useUser();
    const [isTrackingMode, setIsTrackingMode] = useState(false);
    const [sellerLocations, setSellerLocations] = useState<any[]>([]);
    const [selectedSellerLoc, setSelectedSellerLoc] = useState<any>(null);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [timeFilter, setTimeFilter] = useState<'today' | 'yesterday' | 'week' | 'all'>('today');

    const fetchSellerLocations = async () => {
        let query = supabase
            .from('seller_locations')
            .select('*, profile:profiles(email), quotation:quotations(total_amount, status)')
            .order('created_at', { ascending: false });

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).toISOString();

        const lastWeek = new Date(now);
        lastWeek.setDate(lastWeek.getDate() - 7);
        const startOfLastWeek = lastWeek.toISOString();

        if (timeFilter === 'today') {
            query = query.gte('created_at', startOfToday);
        } else if (timeFilter === 'yesterday') {
            query = query.gte('created_at', startOfYesterday).lt('created_at', startOfToday);
        } else if (timeFilter === 'week') {
            query = query.gte('created_at', startOfLastWeek);
        }

        const { data, error } = await query;

        if (error) console.error('Error fetching locations:', error);
        else setSellerLocations(data || []);
    };

    const formatTimestamp = (ts: string) => {
        const date = new Date(ts);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (ts: string) => {
        const date = new Date(ts);
        return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
    };

    useEffect(() => {
        const fetchMapClients = async () => {
            const canViewAll = hasPermission('VIEW_ALL_CLIENTS') || isSupervisor;
            const userIdToFilter = !canViewAll ? profile?.id : undefined;
            const data = await clientService.getClients(userIdToFilter);
            setClients(data);
        };
        fetchMapClients();

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                setUserLocation(loc);
                if (map) map.panTo(loc);
            },
            (err) => console.error(err)
        );
    }, [map, profile, isSupervisor]);

    useEffect(() => {
        if (isTrackingMode) {
            fetchSellerLocations();
        }
    }, [timeFilter, isTrackingMode]);

    useEffect(() => {
        if (!placesLib || !map) return;
        setPlacesService(new placesLib.PlacesService(map));
    }, [placesLib, map]);

    const handleCenterLocation = useCallback(() => {
        if (userLocation && map) {
            map.panTo(userLocation);
            map.setZoom(14);
        }
    }, [userLocation, map]);

    const handleSearchLeads = async () => {
        if (!placesService || !userLocation) return;

        setIsSearchingLeads(true);
        const keywords = ['dentist', 'clínica dental', 'odontología', 'ortodoncia', 'implantología', 'centro dental'];
        const allResults: google.maps.places.PlaceResult[] = [];
        const processedIds = new Set<string>();

        try {
            const searchPromises = keywords.map(keyword => {
                return new Promise<void>((resolve) => {
                    const request: google.maps.places.PlaceSearchRequest = {
                        location: userLocation,
                        radius: radius * 1000,
                        keyword: keyword,
                        // type: 'dentist' // Relaxing type restriction to allow broader keyword matches
                    };

                    placesService.nearbySearch(request, (results, status) => {
                        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                            results.forEach(place => {
                                if (place.place_id && !processedIds.has(place.place_id)) {
                                    processedIds.add(place.place_id);
                                    allResults.push(place);
                                }
                            });
                        }
                        resolve();
                    });
                });
            });

            await Promise.all(searchPromises);

            const newLeads = allResults.filter(place => {
                const placeLoc = place.geometry?.location;
                if (!placeLoc) return false;
                const isExisting = clients.some(c =>
                    calculateDistance(c.lat as number, c.lng as number, placeLoc.lat(), placeLoc.lng()) < 10
                );
                return !isExisting;
            });

            setLeads(newLeads);

        } catch (error) {
            console.error("Error searching leads:", error);
        } finally {
            setIsSearchingLeads(false);
        }
    };

    const handleAddLead = async (lead: google.maps.places.PlaceResult) => {
        if (!lead.geometry?.location || !lead.name) return;

        try {
            const newClient: any = {
                name: lead.name,
                address: lead.vicinity || lead.formatted_address || "Unknown Address",
                lat: lead.geometry.location.lat(),
                lng: lead.geometry.location.lng(),
                status: 'lead',
                zone: 'Unknown',
                last_visit_date: new Date().toISOString(),
                created_by: profile?.id
            };

            const createdClient = await clientService.createClient(newClient);
            setClients([...clients, createdClient]);
            setLeads(leads.filter(l => l.place_id !== lead.place_id));
            setSelectedLead(null);
            setSelectedClient(createdClient);
        } catch (error) {
            console.error("Failed to add lead:", error);
            alert("Failed to add client. Check console.");
        }
    };

    const filteredClients = clients.filter(client => {
        if (!userLocation) return true;
        const dist = calculateDistance(userLocation.lat, userLocation.lng, client.lat as number, client.lng as number);
        const matchesSearch = client.name.toLowerCase().includes(search.toLowerCase());
        return (dist / 1000) <= radius && matchesSearch;
    });



    // Wait for libraries to load
    if (!placesLib || !markerLib) return <div className="p-4 text-center">Loading Maps...</div>;

    return (
        <div className="h-full flex flex-col space-y-4 relative">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 z-[1000]">
                <div className="relative flex-1 max-w-xl">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Search for a clinic in the map..."
                        className="w-full pl-12 pr-4 py-4 bg-white border border-transparent rounded-2xl shadow-xl focus:ring-2 focus:ring-dental-500 outline-none"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="flex items-center space-x-2 bg-white p-2 rounded-2xl shadow-xl border border-gray-50">
                    {[1, 5, 10, 20, 50].map(r => (
                        <button
                            key={r}
                            onClick={() => setRadius(r)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${radius === r ? 'bg-dental-500 text-white shadow-lg shadow-dental-100' : 'text-gray-400 hover:bg-gray-50'}`}
                        >
                            {r}km
                        </button>
                    ))}
                    <div className="w-px h-6 bg-gray-100 mx-2"></div>
                    <button
                        onClick={handleCenterLocation}
                        className="p-2 text-dental-500 hover:bg-dental-50 rounded-xl transition-all"
                        title="Center on my location"
                    >
                        <Crosshair size={20} />
                    </button>
                    {isSupervisor && (
                        <>
                            <div className="w-px h-6 bg-gray-100 mx-2"></div>
                            <button
                                onClick={() => setIsTrackingMode(!isTrackingMode)}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center ${isTrackingMode ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-indigo-400 border border-indigo-100'}`}
                            >
                                <Navigation size={14} className="mr-2" />
                                {isTrackingMode ? 'Tracking: ON' : 'Track Sellers'}
                            </button>
                            <button
                                onClick={() => {
                                    setIsHistoryOpen(!isHistoryOpen);
                                    if (!isTrackingMode) setIsTrackingMode(true);
                                }}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center ${isHistoryOpen ? 'bg-indigo-100 text-indigo-600 shadow-inner' : 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50'}`}
                            >
                                <History size={14} className="mr-2" />
                                Historial
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="flex-1 flex gap-4 overflow-hidden relative">
                {/* Main Map */}
                <div className="flex-1 premium-card overflow-hidden relative z-0 rounded-3xl">
                    <Map
                        defaultCenter={{ lat: -33.4489, lng: -70.6693 }}
                        defaultZoom={13}
                        className="w-full h-full"
                        disableDefaultUI={true}
                    >
                        {userLocation && (
                            <>
                                <Marker position={userLocation} />
                                <Circle center={userLocation} radius={radius * 1000} map={map} />
                            </>
                        )}

                        {filteredClients.map(client => (
                            isValidLoc(client.lat, client.lng) && (
                                <Marker
                                    key={client.id}
                                    position={{ lat: Number(client.lat), lng: Number(client.lng) }}
                                    onClick={() => setSelectedClient(client)}
                                // icon={'http://maps.google.com/mapfiles/ms/icons/green-dot.png'}
                                />
                            )
                        ))}

                        {leads.map(lead => (
                            lead.geometry?.location && (
                                <Marker
                                    key={lead.place_id}
                                    position={lead.geometry.location}
                                    onClick={() => setSelectedLead(lead)}
                                    opacity={0.7}
                                />
                            )
                        ))}

                        {isTrackingMode && sellerLocations.map(loc => (
                            isValidLoc(loc.lat, loc.lng) && (
                                <Marker
                                    key={loc.id}
                                    position={{ lat: Number(loc.lat), lng: Number(loc.lng) }}
                                    onClick={() => setSelectedSellerLoc(loc)}
                                // icon={'http://maps.google.com/mapfiles/ms/icons/purple-dot.png'}
                                />
                            )
                        ))}

                        {selectedSellerLoc && isValidLoc(selectedSellerLoc.lat, selectedSellerLoc.lng) && (
                            <InfoWindow
                                position={{ lat: Number(selectedSellerLoc.lat), lng: Number(selectedSellerLoc.lng) }}
                                onCloseClick={() => setSelectedSellerLoc(null)}
                            >
                                <div className="p-2 space-y-2 min-w-[180px]">
                                    <div className="flex items-center space-x-2">
                                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-xs">
                                            {selectedSellerLoc.profile?.email?.[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="font-bold text-gray-900 text-xs">{selectedSellerLoc.profile?.email?.split('@')[0]}</p>
                                            <p className="text-[10px] text-gray-400 font-medium">{formatDate(selectedSellerLoc.created_at)} • {formatTimestamp(selectedSellerLoc.created_at)}</p>
                                        </div>
                                    </div>
                                    <div className="pt-2 border-t border-gray-50">
                                        <div className="flex justify-between items-center bg-gray-50 p-2 rounded-lg">
                                            <span className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Quotation</span>
                                            <span className="text-xs font-black text-indigo-600">${selectedSellerLoc.quotation?.total_amount?.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>
                            </InfoWindow>
                        )}

                        {selectedClient && (
                            <InfoWindow
                                position={{ lat: selectedClient.lat as number, lng: selectedClient.lng as number }}
                                onCloseClick={() => setSelectedClient(null)}
                            >
                                <div className="p-2 space-y-3 min-w-[200px]">
                                    <h3 className="font-bold text-gray-900 text-sm">{selectedClient.name}</h3>
                                    <div className="flex items-center text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                                        <MapPin size={12} className="mr-1" /> {selectedClient.address}
                                    </div>
                                    <button
                                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedClient.lat},${selectedClient.lng}`, '_blank')}
                                        className="w-full bg-white border border-gray-200 text-gray-700 py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-widest mb-2 flex items-center justify-center hover:bg-gray-50 transition-all"
                                    >
                                        <Navigation size={12} className="mr-2" /> Navigate
                                    </button>
                                    <button
                                        onClick={() => navigate(`/visit/${selectedClient.id}`)}
                                        className="w-full bg-dental-600 text-white py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-widest shadow-lg shadow-dental-100 mb-2"
                                    >
                                        Start Visit
                                    </button>
                                    <button
                                        onClick={() => navigate('/quotations')}
                                        className="w-full bg-white border border-gray-200 text-dental-600 py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-widest hover:bg-dental-50 transition-all font-bold"
                                    >
                                        New Quotation
                                    </button>
                                </div>
                            </InfoWindow>
                        )}

                        {selectedLead && (
                            <InfoWindow
                                position={selectedLead.geometry?.location}
                                onCloseClick={() => setSelectedLead(null)}
                            >
                                <div className="p-2 space-y-3 min-w-[200px]">
                                    <h3 className="font-bold text-gray-900 text-sm">{selectedLead.name}</h3>
                                    <div className="flex items-center text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                                        <MapPin size={12} className="mr-1" /> {selectedLead.vicinity}
                                    </div>
                                    <div className="flex items-center mb-2">
                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-lg font-bold uppercase tracking-wider">Potential Lead</span>
                                        {selectedLead.rating && <span className="text-xs ml-2 text-yellow-500 font-bold">★ {selectedLead.rating}</span>}
                                    </div>

                                    <button
                                        onClick={() => handleAddLead(selectedLead)}
                                        className="w-full bg-dental-600 text-white py-2 rounded-xl text-[10px] font-extrabold uppercase tracking-widest shadow-lg shadow-dental-100 flex items-center justify-center"
                                    >
                                        <UserPlus size={12} className="mr-2" /> Add Client
                                    </button>
                                </div>
                            </InfoWindow>
                        )}
                    </Map>

                    {/* Floating Search Leads Button */}
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[50]">
                        <button
                            onClick={handleSearchLeads}
                            disabled={isSearchingLeads}
                            className="bg-white text-dental-600 px-6 py-3 rounded-full shadow-xl font-bold text-sm hover:scale-105 active:scale-95 transition-all flex items-center border border-dental-100"
                        >
                            {isSearchingLeads ? (
                                <span className="animate-pulse">Searching...</span>
                            ) : (
                                <>
                                    <Search size={16} className="mr-2" />
                                    Search Nearby Dentists
                                </>
                            )}
                        </button>
                        {leads.length > 0 && (
                            <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-3 py-1 rounded-full whitespace-nowrap shadow-lg">
                                {leads.length} leads found
                            </div>
                        )}
                    </div>
                </div>

                {/* Tracking History Log Sidebar */}
                {isHistoryOpen && (
                    <div className="w-80 bg-white shadow-2xl rounded-3xl flex flex-col overflow-hidden border border-gray-100 animate-in slide-in-from-right duration-300">
                        <div className="p-6 bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center space-x-2">
                                    <History size={18} />
                                    <h3 className="font-bold tracking-tight">Tracking Log</h3>
                                </div>
                                <button onClick={() => setIsHistoryOpen(false)} className="p-1 hover:bg-white/20 rounded-lg">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 mt-4">
                                {['today', 'yesterday', 'week', 'all'].map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setTimeFilter(f as any)}
                                        className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${timeFilter === f ? 'bg-white text-indigo-600 shadow-lg' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {sellerLocations.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                                    <Calendar className="text-gray-200 mb-4" size={48} />
                                    <p className="text-gray-400 text-sm font-medium">No records found for this period</p>
                                </div>
                            ) : (
                                sellerLocations.map((loc) => (
                                    <div
                                        key={loc.id}
                                        onClick={() => {
                                            map?.panTo({ lat: Number(loc.lat), lng: Number(loc.lng) });
                                            setSelectedSellerLoc(loc);
                                        }}
                                        className="p-4 bg-gray-50 border border-transparent hover:border-indigo-100 hover:bg-white rounded-2xl cursor-pointer transition-all group"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <p className="text-xs font-black text-gray-900">{loc.profile?.email?.split('@')[0]}</p>
                                            <div className="flex items-center text-[10px] text-gray-400 font-bold bg-white px-2 py-1 rounded-lg">
                                                <Clock size={10} className="mr-1" />
                                                {formatTimestamp(loc.created_at)}
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between mt-3">
                                            <div className="flex items-center text-[10px] text-gray-500 font-bold">
                                                <Calendar size={12} className="mr-1" />
                                                {formatDate(loc.created_at)}
                                            </div>
                                            <p className="text-sm font-black text-indigo-600">${loc.quotation?.total_amount?.toLocaleString()}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

import ErrorBoundary from '../components/ErrorBoundary';

const MapView = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

    if (!apiKey) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-gray-100 text-gray-500 p-8 text-center rounded-3xl">
                <p className="font-bold mb-2">Google Maps API Key Missing</p>
                <p className="text-sm">Please add VITE_GOOGLE_MAPS_API_KEY to your .env file.</p>
            </div>
        );
    }

    return (
        <ErrorBoundary>
            <APIProvider apiKey={apiKey} libraries={['places', 'marker']}>
                <MapContent />
            </APIProvider>
        </ErrorBoundary>
    );
};

export default MapView;
