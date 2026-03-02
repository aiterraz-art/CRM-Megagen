import { useMemo, useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow } from '@vis.gl/react-google-maps';
import { MapPin, Phone, Mail, MessageCircle } from 'lucide-react';
import { normalizeChileanPhone } from '../utils/messageTemplates';

export type LeadMapItem = {
    id: string;
    name: string;
    purchase_contact: string | null;
    status: string | null;
    lat: number | null;
    lng: number | null;
    phone: string | null;
    email: string | null;
};

type Props = {
    leads: LeadMapItem[];
    onCall: (lead: LeadMapItem) => void;
    onWhatsApp: (lead: LeadMapItem) => void;
    onEmail: (lead: LeadMapItem) => void;
};

const getPinColor = (status: string | null) => {
    if (status === 'prospect_contacted') return '#2563eb';
    if (status === 'prospect_evaluating') return '#16a34a';
    return '#f59e0b';
};

const SANTIAGO_CENTER = { lat: -33.4489, lng: -70.6693 };

const LeadHeatmap = ({ leads, onCall, onWhatsApp, onEmail }: Props) => {
    const [selectedLead, setSelectedLead] = useState<LeadMapItem | null>(null);

    const mappableLeads = useMemo(() => leads.filter((l) => typeof l.lat === 'number' && typeof l.lng === 'number'), [leads]);

    const center = useMemo(() => {
        if (mappableLeads.length === 0) return SANTIAGO_CENTER;
        const sum = mappableLeads.reduce((acc, current) => ({
            lat: acc.lat + (current.lat || 0),
            lng: acc.lng + (current.lng || 0)
        }), { lat: 0, lng: 0 });

        return {
            lat: sum.lat / mappableLeads.length,
            lng: sum.lng / mappableLeads.length
        };
    }, [mappableLeads]);

    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
        return <div className="premium-card p-6 text-sm font-bold text-red-600">Falta VITE_GOOGLE_MAPS_API_KEY para vista mapa.</div>;
    }

    if (mappableLeads.length === 0) {
        return (
            <div className="premium-card p-10 text-center">
                <MapPin className="mx-auto mb-3 text-gray-300" size={40} />
                <p className="text-gray-500 font-bold">No hay leads con coordenadas para mostrar en el mapa.</p>
            </div>
        );
    }

    const selectedHasPhone = normalizeChileanPhone(selectedLead?.phone || null);

    return (
        <div className="premium-card p-3 h-[72vh] min-h-[520px] overflow-hidden">
            <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
                <Map
                    defaultCenter={center}
                    defaultZoom={11}
                    mapId="LEAD_PIPELINE_MAP"
                    className="w-full h-full rounded-2xl"
                >
                    {mappableLeads.map((lead) => (
                        <AdvancedMarker
                            key={lead.id}
                            position={{ lat: Number(lead.lat), lng: Number(lead.lng) }}
                            onClick={() => setSelectedLead(lead)}
                        >
                            <Pin
                                background={getPinColor(lead.status)}
                                borderColor={getPinColor(lead.status)}
                                glyphColor="#ffffff"
                            />
                        </AdvancedMarker>
                    ))}

                    {selectedLead && selectedLead.lat && selectedLead.lng && (
                        <InfoWindow
                            position={{ lat: Number(selectedLead.lat), lng: Number(selectedLead.lng) }}
                            onCloseClick={() => setSelectedLead(null)}
                        >
                            <div className="min-w-56 space-y-2">
                                <p className="font-black text-gray-900">{selectedLead.name}</p>
                                <p className="text-xs font-bold text-gray-600">{selectedLead.purchase_contact || 'Sin doctor/contacto'}</p>
                                <p className="text-[10px] uppercase tracking-widest font-black text-indigo-600">Etapa: {selectedLead.status || 'N/A'}</p>
                                <div className="grid grid-cols-3 gap-1.5 pt-1">
                                    <button
                                        onClick={() => onCall(selectedLead)}
                                        className="px-2 py-2 rounded-lg bg-gray-100 text-gray-700 text-[10px] font-black uppercase flex items-center justify-center"
                                        disabled={!selectedLead.phone}
                                    >
                                        <Phone size={12} className="mr-1" />Llamar
                                    </button>
                                    <button
                                        onClick={() => onWhatsApp(selectedLead)}
                                        disabled={!selectedHasPhone}
                                        className={`px-2 py-2 rounded-lg text-[10px] font-black uppercase flex items-center justify-center ${selectedHasPhone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}
                                    >
                                        <MessageCircle size={12} className="mr-1" />
                                        {selectedHasPhone ? 'WA' : 'Sin cel'}
                                    </button>
                                    <button
                                        onClick={() => onEmail(selectedLead)}
                                        disabled={!selectedLead.email}
                                        className={`px-2 py-2 rounded-lg text-[10px] font-black uppercase flex items-center justify-center ${selectedLead.email ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'}`}
                                    >
                                        <Mail size={12} className="mr-1" />Mail
                                    </button>
                                </div>
                            </div>
                        </InfoWindow>
                    )}
                </Map>
            </APIProvider>
        </div>
    );
};

export default LeadHeatmap;
