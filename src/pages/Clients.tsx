import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, MapPin, ChevronRight, Phone, Mail, Trash2, Building2, Pencil, Send, Paperclip, X, FileText, Upload, AlertCircle, Users, UserCircle2, RefreshCw, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Database } from '../types/supabase';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { APIProvider, Map, AdvancedMarker, Pin, useMapsLibrary, useMap } from '@vis.gl/react-google-maps';
import ClientDetailModal from '../components/modals/ClientDetailModal';
import { checkGPSConnection } from '../utils/gps';
import { sendGmailMessage } from '../utils/gmail';
import { isProspectStatus } from '../utils/prospect';

type Client = Database['public']['Tables']['clients']['Row'];

// Google Maps Setup
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const SANTIAGO_CENTER = { lat: -33.4489, lng: -70.6693 };

// Helper to auto-pan map when location changes
const MapHandler = ({ place }: { place: { lat: number; lng: number } | null }) => {
    const map = useMap();
    useEffect(() => {
        if (!map || !place) return;
        if (place.lat !== 0 && place.lng !== 0) {
            map.panTo(place);
            map.setZoom(15);
        }
    }, [map, place]);
    return null;
};

const normalizeRut = (rut: string): string => {
    // 1. Remove non-alphanumeric
    let clean = rut.replace(/[^0-9kK]/g, '');
    if (clean.length < 2) return clean;

    // 2. Identify body and dv
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1).toUpperCase();

    // 3. Format with hyphen
    return `${body}-${dv}`;
};

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
};

const deg2rad = (deg: number) => {
    return deg * (Math.PI / 180);
};

const ClientsContent = () => {
    const { profile, hasPermission, isSupervisor, effectiveRole } = useUser();
    const navigate = useNavigate();
    const searchParams = new URLSearchParams(window.location.search);
    const initialFilter = searchParams.get('filter') || 'all';

    const [clients, setClients] = useState<Client[]>([]);
    const [neglectFilter, setNeglectFilter] = useState<'all' | 'neglected'>(initialFilter as any);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [profiles, setProfiles] = useState<any[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

    // Client 360 View State
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [neglectedData, setNeglectedData] = useState<Record<string, number>>({});

    // Client Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditing, setIsEditing] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Email Modal State
    const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailData, setEmailData] = useState({
        to: '',
        cc: '',
        subject: '',
        message: '',
        clientName: '',
        clientId: ''
    });
    const [attachment, setAttachment] = useState<File | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const csvInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);

    const [viewMode, setViewMode] = useState<'all' | 'mine'>('all'); // For Admins
    const [portfolioTab, setPortfolioTab] = useState<'portfolio' | 'pool'>('portfolio');
    const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'active' | 'prospect'>('all');
    const [poolAssigneeId, setPoolAssigneeId] = useState<string>('');
    const isSellerRole = effectiveRole === 'seller';
    const canReassignPoolLead = effectiveRole === 'admin' || effectiveRole === 'jefe';
    const canViewAll = useMemo(
        () => !isSellerRole && (hasPermission('VIEW_ALL_CLIENTS') || isSupervisor || profile?.email === (import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl')),
        [isSellerRole, hasPermission, isSupervisor, profile?.email]
    );

    // New/Edit Client Form State
    const [clientForm, setClientForm] = useState({
        name: '',
        rut: '',
        phone: '',
        email: '',
        address: '',
        lat: SANTIAGO_CENTER.lat,
        lng: SANTIAGO_CENTER.lng,
        notes: '',
        giro: '',
        comuna: '',
        office: ''
    });

    // Maps State for Modal
    const [manualLocation, setManualLocation] = useState<{ lat: number; lng: number } | null>(null);

    // Places Autocomplete Setup
    const placesLib = useMapsLibrary('places');
    const inputRef = useRef<HTMLInputElement>(null);
    const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

    // PERSISTENCE LOGIC: Save state to LocalStorage to prevent data loss on mobile app switch
    useEffect(() => {
        const savedState = localStorage.getItem('crm_client_draft');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                // Only restore if it was open
                if (parsed.isModalOpen) {
                    setClientForm(parsed.clientForm);
                    setManualLocation(parsed.manualLocation);
                    setIsEditing(parsed.isEditing);
                    setIsModalOpen(true);
                }
            } catch (e) {
                console.error("Error restoring client draft:", e);
                localStorage.removeItem('crm_client_draft');
            }
        }
    }, []);

    // Save state whenever it changes
    useEffect(() => {
        if (isModalOpen) {
            const stateToSave = {
                clientForm,
                manualLocation,
                isEditing,
                isModalOpen: true
            };
            localStorage.setItem('crm_client_draft', JSON.stringify(stateToSave));
        } else {
            // If closed explicitly, clear the draft to avoid phantom openings later
            localStorage.removeItem('crm_client_draft');
        }
    }, [clientForm, manualLocation, isEditing, isModalOpen]);

    useEffect(() => {
        if (!placesLib || !inputRef.current || !isModalOpen) return;

        const autocomplete = new placesLib.Autocomplete(inputRef.current, {
            componentRestrictions: { country: 'cl' },
            fields: ['formatted_address', 'geometry', 'address_components'],
            types: ['address']
        });

        autocompleteRef.current = autocomplete;

        const listener = autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place) return;

            const formattedAddress = place.formatted_address || inputRef.current?.value || '';
            const lat = place.geometry?.location?.lat();
            const lng = place.geometry?.location?.lng();

            let comuna = '';
            const components = place.address_components;
            if (components) {
                const comunaComponent = components.find((c: any) => c.types.includes('administrative_area_level_3'))
                    || components.find((c: any) => c.types.includes('locality'));
                comuna = comunaComponent?.long_name || comunaComponent?.short_name || '';
            }

            if (!comuna && formattedAddress) {
                const parts = formattedAddress.split(',');
                if (parts.length >= 2) {
                    comuna = parts[parts.length - 2].replace(/\d+/g, '').trim();
                }
            }

            setClientForm((prev) => ({
                ...prev,
                address: formattedAddress || prev.address,
                lat: typeof lat === 'number' ? lat : prev.lat,
                lng: typeof lng === 'number' ? lng : prev.lng,
                comuna: comuna || prev.comuna
            }));

            if (typeof lat === 'number' && typeof lng === 'number') {
                setManualLocation({ lat, lng });
            }
        });

        return () => {
            listener.remove();
            google.maps.event.clearInstanceListeners(autocomplete);
            autocompleteRef.current = null;
        };
    }, [placesLib, isModalOpen]);

    // Initial Fetch
    const fetchClients = async () => {
        setLoading(true);
        setErrorMessage(null);
        try {
            let query = supabase.from('clients').select('*').order('name');

            if (portfolioTab === 'pool') {
                const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                query = query.or(
                    `and(status.eq.prospect,last_visit_date.not.is.null,last_visit_date.lt.${cutoffDate}),` +
                    `and(status.ilike.prospect_*,last_visit_date.not.is.null,last_visit_date.lt.${cutoffDate}),` +
                    `and(status.eq.prospect,last_visit_date.is.null,created_at.lt.${cutoffDate}),` +
                    `and(status.ilike.prospect_*,last_visit_date.is.null,created_at.lt.${cutoffDate})`
                );
            } else if (isSellerRole && profile?.id) {
                query = query.eq('created_by', profile.id);
            } else if (!canViewAll && profile?.id) {
                query = query.eq('created_by', profile.id);
            }

            const { data, error } = await query;

            if (error) {
                console.error("Error fetching clients:", error);
                throw error;
            }

            if (data) {
                const visibleClients = data;
                setClients(visibleClients);
                setLastRefreshAt(new Date().toISOString());

                // OPTIMIZATION: Use 'last_visit_date' directly from client record
                // This avoids fetching ALL visits separately, which was causing massive slowness (O(N) vs O(1))
                const neglectMap: Record<string, number> = {};
                const now = new Date();

                visibleClients.forEach(client => {
                    if (client.last_visit_date) {
                        const days = Math.floor((now.getTime() - new Date(client.last_visit_date).getTime()) / (1000 * 60 * 60 * 24));
                        neglectMap[client.id] = days;
                    } else {
                        neglectMap[client.id] = 999; // Never visited
                    }
                });
                setNeglectedData(neglectMap);
            }
        } catch (err: any) {
            console.error("Critical error in fetchClients:", err);
            setErrorMessage(err?.message || 'No se pudo cargar la cartera de clientes.');
        } finally {
            setLoading(false);
        }
    };

    const fetchProfiles = async () => {
        const { data } = await supabase.from('profiles').select('id, email, full_name, role');
        if (data) {
            setProfiles(data);
            const firstSeller = data.find((p) => (p.role || '').toLowerCase() === 'seller');
            if (firstSeller && !poolAssigneeId) {
                setPoolAssigneeId(firstSeller.id);
            }
        }
    };

    useEffect(() => {
        if (profile?.id) {
            fetchClients();
            fetchProfiles();
        }
    }, [profile?.id, portfolioTab]);

    const handleOpenModal = (clientToEdit?: Client) => {
        if (clientToEdit) {
            setIsEditing(clientToEdit.id);
            setClientForm({
                name: clientToEdit.name,
                rut: clientToEdit.rut || '',
                phone: clientToEdit.phone || '',
                email: clientToEdit.email || '',
                address: clientToEdit.address || '',
                lat: clientToEdit.lat ?? SANTIAGO_CENTER.lat,
                lng: clientToEdit.lng ?? SANTIAGO_CENTER.lng,
                notes: clientToEdit.notes || '',
                giro: clientToEdit.giro || '',
                comuna: clientToEdit.comuna || '',
                office: clientToEdit.office || ''
            });
            if (clientToEdit.lat && clientToEdit.lng) {
                setManualLocation({ lat: clientToEdit.lat, lng: clientToEdit.lng });
            } else {
                setManualLocation(null);
            }
        } else {
            setIsEditing(null);
            setClientForm({
                name: '',
                rut: '',
                phone: '',
                email: '',
                address: '',
                lat: SANTIAGO_CENTER.lat,
                lng: SANTIAGO_CENTER.lng,
                notes: '',
                giro: '',
                comuna: '',
                office: ''
            });
            setManualLocation(null);
        }
        setIsModalOpen(true);
    };

    const handleOpenEmailModal = (client: Client) => {
        setEmailData({
            to: client.email || '',
            cc: '',
            subject: `Cotización Dental - ${client.name}`,
            message: `Estimados ${client.name},\n\nAdjunto lo solicitado.\n\nSaludos cordiales,\n${(profile as any)?.full_name || 'Dr. Alfredo Terraza'}`,
            clientName: client.name,
            clientId: client.id
        });
        setAttachment(null);
        setIsEmailModalOpen(true);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.size > 20 * 1024 * 1024) { // 20MB limit
                alert('⚠️ El archivo es muy pesado. Máximo 20MB.');
                return;
            }
            setAttachment(file);
        }
    };

    const handleSendGmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setSendingEmail(true);
        try {
            await sendGmailMessage({
                to: emailData.to,
                cc: emailData.cc,
                subject: emailData.subject,
                message: emailData.message,
                attachment,
                clientId: emailData.clientId,
                profileId: profile?.id
            });

            alert('¡Correo enviado exitosamente!');
            setIsEmailModalOpen(false);

        } catch (error: any) {
            console.error('Error sending email:', error);
            alert(`Error: ${error.message} `);
        } finally {
            setSendingEmail(false);
        }
    };

    const handleSaveClient = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        const normalizedRut = normalizeRut(clientForm.rut);

        // Always try to read from the input DOM value to capture latest typing.
        let finalAddress = (inputRef.current?.value || clientForm.address || '').trim();

        console.log('💾 SAVING CLIENT - Payload Address:', finalAddress);

        if (!clientForm.name || !normalizedRut || !clientForm.email || !clientForm.phone || !finalAddress || !clientForm.giro) {
            alert("⚠️ Todos los campos son obligatorios (Nombre, RUT, Email, Teléfono, Dirección, Giro), excepto las Notas.");
            setSubmitting(false);
            return;
        }

        // --- GEOCODING FALLBACK (DOBLE VERIFICACIÓN) ---
        // Si las coordenadas son las de Stgo Centro (default) o nulas, PERO tenemos dirección escrita...
        // ...usamos el Geocoder para obtener la ubicación real antes de guardar.
        let finalLat = manualLocation ? manualLocation.lat : clientForm.lat;
        let finalLng = manualLocation ? manualLocation.lng : clientForm.lng;

        const isDefaultLocation = Math.abs(finalLat - (-33.4489)) < 0.0001 && Math.abs(finalLng - (-70.6693)) < 0.0001;
        const hasAddress = finalAddress && finalAddress.length > 5;

        let finalComuna = clientForm.comuna;
        if ((!finalLat || !finalLng || isDefaultLocation) && hasAddress) {
            try {
                // console.log("⚠️ Coordenadas por defecto detectadas. Geocodificando dirección:", finalAddress);
                const geocoder = new google.maps.Geocoder();
                const { results } = await geocoder.geocode({ address: finalAddress + ', Chile' });

                if (results && results[0]) {
                    finalLat = results[0].geometry.location.lat();
                    finalLng = results[0].geometry.location.lng();

                    // Intentamos completar la Comuna si falta
                    if (!finalComuna) {
                        const place = results[0];
                        const components = place.address_components;
                        if (components) {
                            const comunaComponent = components.find((c: any) => c.types.includes('administrative_area_level_3'))
                                || components.find((c: any) => c.types.includes('locality'));
                            if (comunaComponent) {
                                finalComuna = comunaComponent.long_name;
                            }
                        }
                    }
                }
            } catch (geoError) {
                console.warn('Geocoding fallback failed:', geoError);
            }
        }
        // -----------------------------------------------

        try {
            if (isEditing) {
                const { error } = await supabase
                    .from('clients')
                    .update({
                        name: clientForm.name,
                        rut: normalizedRut,
                        phone: clientForm.phone,
                        email: clientForm.email,
                        address: finalAddress,
                        lat: finalLat,
                        lng: finalLng,
                        notes: clientForm.notes,
                        giro: clientForm.giro,
                        comuna: finalComuna,
                        office: clientForm.office
                    })
                    .eq('id', isEditing);

                if (error) throw error;
                alert('¡Cliente actualizado exitosamente!');

            } else {
                // VERIFICACIÓN DE SEGURIDAD (RUT ÚNICO GLOBAL)
                const { data: rutCheck, error: rpcError } = await supabase
                    .rpc('check_rut_exists', { queried_rut: normalizedRut });

                if (rpcError) throw rpcError;

                // El RPC retorna un objeto JSON: { exists: boolean, owner_name: string, ... }
                const result = rutCheck as any;

                if (result && result.exists) {
                    alert(`⚠️ DETENIDO: Este cliente ya existe en el sistema.\n\nEstá asignado al vendedor: ${result.owner_name || 'Desconocido'}\n\nPor políticas de la empresa, no puedes duplicar clientes de otros vendedores.`);
                    setSubmitting(false);
                    return;
                }

                const { error: insertError } = await supabase
                    .from('clients')
                    .insert({
                        id: crypto.randomUUID(),
                        name: clientForm.name,
                        rut: normalizedRut,
                        phone: clientForm.phone,
                        email: clientForm.email,
                        address: finalAddress,
                        lat: finalLat,
                        lng: finalLng,
                        notes: clientForm.notes,
                        created_by: profile?.id,
                        status: 'active',
                        zone: 'Santiago',
                        giro: clientForm.giro,
                        comuna: finalComuna,
                        office: clientForm.office
                    });

                if (insertError) throw insertError;
                alert('¡Cliente creado exitosamente!');
            }

            setIsModalOpen(false);
            fetchClients();

        } catch (error: any) {
            console.error('Error saving client:', error);
            alert(`Error: ${error.message} `);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`¿Estás seguro de eliminar a ${name}?\n\nEsta acción es irreversible y borrará todo su historial.`)) return;
        try {
            const { error } = await supabase.from('clients').delete().eq('id', id);
            if (error) throw error;
            fetchClients();
        } catch (error: any) {
            alert(`Error al eliminar: ${error.message} `);
        }
    };

    const handleReassignLead = async (clientId: string, clientName: string) => {
        if (!canReassignPoolLead) return;
        if (!poolAssigneeId) {
            alert('Selecciona primero el vendedor destino para reasignar.');
            return;
        }
        const targetName = ownersById[poolAssigneeId] || 'vendedor seleccionado';
        const confirmed = window.confirm(`Estás a punto de re-asignar este lead libre a la cartera de ${targetName}. ¿Confirmas?`);
        if (!confirmed) return;

        try {
            const { error } = await supabase
                .from('clients')
                .update({ created_by: poolAssigneeId, last_visit_date: null })
                .eq('id', clientId);
            if (error) throw error;
            alert(`Lead ${clientName} reasignado correctamente a ${targetName}.`);
            fetchClients();
        } catch (error: any) {
            alert(`Error al reasignar lead: ${error.message}`);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImporting(true);
        const reader = new FileReader();

        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const rows = XLSX.utils.sheet_to_json(ws) as any[];

                let successCount = 0;
                let errorCount = 0;
                let errors: string[] = [];

                if (rows.length === 0) {
                    alert('El archivo está vacío.');
                    setImporting(false);
                    return;
                }

                if (!hasPermission('IMPORT_CLIENTS')) {
                    alert("Acceso denegado: No tienes permisos para importar clientes masivos.");
                    setImporting(false);
                    return;
                }

                const clientsToInsert: any[] = [];

                for (const row of rows) {
                    const name = row['Nombre']?.toString().trim();
                    const rut = row['Rut'] ? normalizeRut(row['Rut'].toString()) : null;
                    const giro = row['Giro']?.toString().trim();
                    const address = row['Dirección']?.toString().trim();
                    const office = row['Oficina']?.toString().trim() || row['Depto']?.toString().trim();
                    const comuna = row['Comuna']?.toString().trim() || row['Ciudad']?.toString().trim();
                    const phone = row['Teléfono']?.toString().trim();
                    const email = row['Email']?.toString().trim();
                    const purchase_contact = row['Contacto']?.toString().trim();
                    const sellerEmail = row['Vendedor']?.toString().trim();

                    if (!name) {
                        errorCount++;
                        errors.push(`Fila sin nombre: ${JSON.stringify(row)}`);
                        continue;
                    }

                    let assignedSellerId = profile?.id;
                    if (sellerEmail) {
                        const foundProfile = profiles.find(p => p.email?.toLowerCase() === sellerEmail.toLowerCase());
                        if (foundProfile) {
                            assignedSellerId = foundProfile.id;
                        } else {
                            const foundProfileByUsername = profiles.find(p => p.email?.split('@')[0].toLowerCase() === sellerEmail.toLowerCase());
                            if (foundProfileByUsername) {
                                assignedSellerId = foundProfileByUsername.id;
                            } else {
                                errors.push(`Vendedor no encontrado: ${sellerEmail} (Asignando a ti por defecto)`);
                            }
                        }
                    }

                    clientsToInsert.push({
                        id: crypto.randomUUID(),
                        name: name,
                        rut: rut,
                        giro: giro,
                        address: address || 'Dirección por actualizar',
                        comuna: comuna,
                        phone: phone,
                        email: email,
                        purchase_contact: purchase_contact,
                        created_by: assignedSellerId,
                        status: 'active',
                        zone: 'Santiago',
                        lat: SANTIAGO_CENTER.lat,
                        lng: SANTIAGO_CENTER.lng,
                        office: office,
                        notes: 'Importado vía Excel'
                    });
                }

                if (clientsToInsert.length > 0) {
                    for (const client of clientsToInsert) {
                        try {
                            if (client.rut) {
                                const { data: dup } = await supabase.from('clients').select('id').eq('rut', client.rut).maybeSingle();
                                if (dup) {
                                    errorCount++;
                                    errors.push(`RUT duplicado: ${client.rut} (${client.name})`);
                                    continue;
                                }
                            }

                            const { error } = await supabase.from('clients').insert(client);
                            if (error) throw error;
                            successCount++;
                        } catch (err: any) {
                            errorCount++;
                            errors.push(`Error al insertar ${client.name}: ${err.message}`);
                        }
                    }
                }

                alert(`Importación Finalizada.\n\n✅ Exitosos: ${successCount}\n❌ Errores: ${errorCount}\n\n${errorCount > 0 ? 'Revisa la consola para detalles de errores.' : ''}`);
                if (errors.length > 0) console.error("Excel Import Errors:", errors);

                setImporting(false);
                if (csvInputRef.current) csvInputRef.current.value = '';
                fetchClients();

            } catch (err) {
                console.error("Excel Parse Error:", err);
                alert("Error al leer el archivo Excel. Asegúrate de que sea un archivo .xlsx válido.");
                setImporting(false);
            }
        };

        reader.readAsBinaryString(file);
    };

    const downloadTemplate = () => {
        const headers = ['Nombre', 'Rut', 'Giro', 'Dirección', 'Oficina', 'Comuna', 'Teléfono', 'Email', 'Contacto', 'Vendedor'];
        const data = [
            ['Exemplo Dental Ltda', '76.123.456-7', 'Clinica Dental', 'Av Providencia 1234, Providencia', 'Oficina 402', 'Providencia', '+56912345678', 'contacto@clinica.cl', 'Juan Perez', profile?.email || 'vendedor@empresa.cl']
        ];

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
        XLSX.writeFile(wb, 'plantilla_clientes_crm.xlsx');
    };

    const ownersById = useMemo(() => {
        const map: Record<string, string> = {};
        profiles.forEach((p) => {
            if (!p?.id) return;
            map[p.id] = p.full_name || p.email || 'Sin asignar';
        });
        return map;
    }, [profiles]);

    const sellerOptions = useMemo(
        () => profiles.filter((p) => (p.role || '').toLowerCase() === 'seller'),
        [profiles]
    );

    const filteredClients = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase();
        return clients.filter(c => {
            const matchesSearch = !normalizedSearch ||
                c.name.toLowerCase().includes(normalizedSearch) ||
                c.rut?.toLowerCase().includes(normalizedSearch) ||
                (c.address?.toLowerCase().includes(normalizedSearch) ?? false);

            const isOwner = c.created_by === profile?.id;
            const isNeglected = (neglectedData[c.id] || 0) >= 15;
            const passesNeglect = neglectFilter === 'all' || isNeglected;
            const isProspect = isProspectStatus(c.status);
            const passesTypeFilter = clientTypeFilter === 'all'
                || (clientTypeFilter === 'active' && !isProspect)
                || (clientTypeFilter === 'prospect' && isProspect);

            if (portfolioTab === 'pool') {
                return matchesSearch && passesNeglect && passesTypeFilter;
            }

            if (canViewAll) {
                return (viewMode === 'all' || isOwner) && matchesSearch && passesNeglect && passesTypeFilter;
            }
            return isOwner && matchesSearch && passesNeglect && passesTypeFilter;
        });
    }, [search, clients, profile?.id, neglectedData, neglectFilter, canViewAll, viewMode, clientTypeFilter, portfolioTab]);

    const clientStats = useMemo(() => {
        const inRisk = filteredClients.filter((client) => (neglectedData[client.id] || 0) >= 15).length;
        const withCoordinates = filteredClients.filter((client) => !!client.lat && !!client.lng).length;
        const mine = filteredClients.filter((client) => client.created_by === profile?.id).length;
        return {
            total: filteredClients.length,
            inRisk,
            withCoordinates,
            mine
        };
    }, [filteredClients, neglectedData, profile?.id]);

    return (
        <div className="space-y-8 w-full mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 leading-tight">Gestión de Clientes</h2>
                    <p className="text-gray-500 font-medium mt-1">
                        {portfolioTab === 'pool'
                            ? 'Pool de Leads Libres (sin gestión por más de 30 días)'
                            : (canViewAll ? 'Administración total de la cartera' : 'Tu cartera de clientes asignada')}
                    </p>
                    {lastRefreshAt && (
                        <p className="text-xs text-gray-400 mt-2">Última actualización: {new Date(lastRefreshAt).toLocaleString()}</p>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {canViewAll && (
                        <div className="flex bg-gray-100 p-1 rounded-xl">
                            <button
                                onClick={() => setViewMode('all')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Todos
                            </button>
                            <button
                                onClick={() => setViewMode('mine')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'mine' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Mis Clientes
                            </button>
                        </div>
                    )}

                    {hasPermission('IMPORT_CLIENTS') && (
                        <>
                            <input
                                type="file"
                                accept=".xlsx, .xls"
                                ref={csvInputRef}
                                onChange={handleFileUpload}
                                className="hidden"
                            />
                            <button
                                onClick={downloadTemplate}
                                className="bg-green-50 text-green-700 px-4 py-4 rounded-2xl font-bold flex items-center hover:bg-green-100 transition-all text-sm"
                                title="Descargar Plantilla Excel"
                            >
                                <FileText size={18} className="mr-2" />
                                Plantilla
                            </button>
                            <button
                                onClick={() => csvInputRef.current?.click()}
                                disabled={importing}
                                className="bg-green-600 text-white px-4 py-4 rounded-2xl font-bold flex items-center hover:bg-green-700 shadow-lg shadow-green-100 transition-all text-sm disabled:opacity-50"
                                title="Importar Excel"
                            >
                                {importing ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent animate-spin rounded-full mr-2"></div>
                                ) : (
                                    <Upload size={18} className="mr-2" />
                                )}
                                {importing ? '...' : 'Importar Excel'}
                            </button>
                        </>
                    )}

                    <div className="flex bg-gray-100/50 p-1 rounded-2xl border border-gray-100 self-center md:self-auto">
                        <button
                            onClick={() => setNeglectFilter('all')}
                            className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${neglectFilter === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Todos
                        </button>
                        <button
                            onClick={() => setNeglectFilter('neglected')}
                            className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center ${neglectFilter === 'neglected' ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'text-gray-400 hover:text-red-500'}`}
                        >
                            <AlertCircle size={12} className="mr-1.5" />
                            En Riesgo
                        </button>
                    </div>

                    <button
                        onClick={() => handleOpenModal()}
                        className="bg-gray-900 text-white px-6 py-4 rounded-2xl font-bold flex items-center shadow-lg hover:bg-black active:scale-95 transition-all text-sm"
                    >
                        <Plus size={18} className="mr-2" />
                        Nuevo Cliente
                    </button>
                    <button
                        onClick={fetchClients}
                        className="bg-white text-gray-700 px-4 py-4 rounded-2xl font-bold flex items-center border border-gray-200 hover:bg-gray-50 transition-all text-sm"
                        title="Actualizar cartera"
                    >
                        <RefreshCw size={16} className="mr-2" />
                        Actualizar
                    </button>
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setPortfolioTab('portfolio')}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${portfolioTab === 'portfolio' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}
                    >
                        Mis Clientes
                    </button>
                    <button
                        onClick={() => setPortfolioTab('pool')}
                        className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider ${portfolioTab === 'pool' ? 'bg-amber-500 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}
                    >
                        Pool de Leads Libres
                    </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest text-gray-400 font-black">Ver:</span>
                    <button
                        onClick={() => setClientTypeFilter('all')}
                        className={`px-4 py-2 rounded-xl text-xs font-black ${clientTypeFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}
                    >
                        Todos
                    </button>
                    <button
                        onClick={() => setClientTypeFilter('active')}
                        className={`px-4 py-2 rounded-xl text-xs font-black ${clientTypeFilter === 'active' ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}
                    >
                        Solo Clientes Activos
                    </button>
                    <button
                        onClick={() => setClientTypeFilter('prospect')}
                        className={`px-4 py-2 rounded-xl text-xs font-black ${clientTypeFilter === 'prospect' ? 'bg-amber-500 text-white' : 'bg-white border border-gray-100 text-gray-500'}`}
                    >
                        Solo Prospectos
                    </button>
                </div>
                {portfolioTab === 'pool' && canReassignPoolLead && (
                    <div className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-100 rounded-2xl p-3">
                        <span className="text-[10px] uppercase tracking-widest text-amber-700 font-black">Reasignar a:</span>
                        <select
                            value={poolAssigneeId}
                            onChange={(e) => setPoolAssigneeId(e.target.value)}
                            className="px-3 py-2 rounded-xl bg-white border border-amber-200 text-sm font-bold text-gray-700"
                        >
                            <option value="">Selecciona vendedor</option>
                            {sellerOptions.map((seller) => (
                                <option key={seller.id} value={seller.id}>
                                    {seller.full_name || seller.email}
                                </option>
                            ))}
                        </select>
                        <span className="text-xs text-amber-700 font-medium">Solo admin/jefe pueden ejecutar reasignación.</span>
                    </div>
                )}
            </div>

            {errorMessage && (
                <div className="p-4 rounded-2xl border border-red-100 bg-red-50 text-red-700 text-sm font-medium">
                    {errorMessage}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 font-black">Clientes visibles</p>
                    <p className="text-2xl font-black text-gray-900 mt-1">{clientStats.total}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 font-black">En riesgo</p>
                    <p className="text-2xl font-black text-amber-600 mt-1">{clientStats.inRisk}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 font-black">Con GPS</p>
                    <p className="text-2xl font-black text-emerald-600 mt-1">{clientStats.withCoordinates}</p>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 font-black">Asignados a mí</p>
                    <p className="text-2xl font-black text-indigo-600 mt-1">{clientStats.mine}</p>
                </div>
            </div>

            <div className="relative max-w-3xl">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Buscar por nombre, RUT o dirección..."
                    className="w-full pl-14 pr-6 py-4 bg-white border-none rounded-[2rem] shadow-sm ring-1 ring-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-700 font-medium placeholder:text-gray-400"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-white h-64 rounded-[2.5rem] animate-pulse"></div>
                    ))}
                </div>
            ) : filteredClients.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-20 bg-gray-50 rounded-[3rem] border-2 border-dashed border-gray-200">
                    <div className="bg-white p-6 rounded-full shadow-sm mb-4">
                        <Users size={48} className="text-gray-300" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">No se encontraron clientes</h3>
                    <p className="text-gray-500 mt-2 text-center max-w-sm">
                        {search ? `No hay resultados para "${search}"` : 'Parece que aún no tienes clientes registrados o no tienes permisos para verlos.'}
                    </p>
                    {clients.length > 0 && filteredClients.length === 0 && (
                        <p className="text-indigo-600 font-bold mt-4 text-sm bg-indigo-50 px-4 py-2 rounded-full">
                            Hay {clients.length} clientes totales, pero ninguno coincide con tus filtros.
                        </p>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredClients.map((client) => {
                        const isOwner = client.created_by === profile?.id;

                        return (
                            <div key={client.id} className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group flex flex-col justify-between min-h-[340px]">
                                <div className="space-y-6 cursor-pointer" onClick={() => setSelectedClient(client)}>
                                    <div className="flex justify-between items-start">
                                        <div className="relative">
                                            <div className="w-16 h-16 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-inner">
                                                <Building2 size={28} />
                                            </div>
                                            {neglectedData[client.id] >= 15 && (
                                                <div className={`absolute -top-2 -right-2 px-2 py-1 rounded-lg text-[8px] font-black text-white shadow-lg animate-pulse ${neglectedData[client.id] >= 30 ? 'bg-red-600' : 'bg-amber-500'}`}>
                                                    {neglectedData[client.id] >= 30 ? 'CRÍTICO' : 'RIESGO'}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                            {(hasPermission('MANAGE_CLIENTS') || isOwner) && (
                                                <>
                                                    <button
                                                        onClick={() => handleOpenModal(client)}
                                                        className="p-3 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                                        title="Editar Cliente"
                                                    >
                                                        <Pencil size={18} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(client.id, client.name)}
                                                        className="p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                                                        title="Eliminar Cliente"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <h3 className="text-xl font-black text-gray-900 leading-tight mb-2 line-clamp-2">{client.name}</h3>
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{normalizeRut(client.rut || '') || 'SIN RUT'}</p>
                                        </div>
                                        {canViewAll && (
                                            <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-gray-500 bg-gray-50 px-2 py-1 rounded-lg">
                                                <UserCircle2 size={12} />
                                                {ownersById[client.created_by || ''] || 'Sin asignar'}
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-3">
                                        {(client.address || client.comuna) && (
                                            <div className="flex items-start text-xs text-gray-500 font-medium bg-gray-50 p-3 rounded-xl">
                                                <MapPin size={14} className="mr-2 mt-0.5 text-indigo-500 shrink-0" />
                                                <span className="line-clamp-2">{[client.address, client.office ? `Of: ${client.office}` : null, client.comuna].filter(Boolean).join(', ')}</span>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
                                            {client.phone && (
                                                <button
                                                    onClick={async () => {
                                                        if (profile?.id) {
                                                            try {
                                                                const { error } = await supabase.from('call_logs').insert({
                                                                    user_id: profile.id,
                                                                    client_id: client.id,
                                                                    status: 'contestada',
                                                                    interaction_type: 'Llamada',
                                                                    notes: 'Llamada iniciada desde ficha de cliente'
                                                                });
                                                                if (error) console.error("Error logging call:", error);
                                                            } catch (err) {
                                                                console.error("Critical error logging call:", err);
                                                            }
                                                        }
                                                        window.location.href = `tel:${client.phone}`;
                                                    }}
                                                    className="flex items-center text-[10px] text-gray-500 font-bold bg-gray-50 px-3 py-2 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 transition-colors cursor-pointer w-full text-left"
                                                >
                                                    <Phone size={12} className="mr-2 text-emerald-500" />
                                                    {client.phone}
                                                </button>
                                            )}
                                            {client.email && (
                                                <button
                                                    onClick={() => handleOpenEmailModal(client)}
                                                    className="flex items-center text-[10px] text-gray-500 font-bold bg-gray-50 px-3 py-2 rounded-lg tooltip hover:bg-blue-50 hover:text-blue-600 transition-colors cursor-pointer w-full text-left"
                                                    title={`Enviar correo a ${client.email} `}
                                                >
                                                    <Mail size={12} className="mr-2 text-blue-500 shrink-0" />
                                                    <span className="truncate">{client.email}</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 mt-4 border-t border-gray-50 flex gap-3" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${client.lat},${client.lng}`, '_blank')}
                                        className="p-4 bg-gray-50 text-gray-400 rounded-2xl hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                        title="Ver en Mapa"
                                    >
                                        <MapPin size={20} />
                                    </button >
                                    <button
                                        onClick={(e) => {
                                            e.preventDefault();
                                            checkGPSConnection({ showAlert: true, timeoutMs: 10000, retries: 1, minAccuracyMeters: 500 })
                                                .then((position) => {
                                                    const userLat = position.coords.latitude;
                                                    const userLng = position.coords.longitude;
                                                    const dist = getDistanceFromLatLonInKm(userLat, userLng, client.lat || 0, client.lng || 0);

                                                    // User Request: Warn if > 2km, but allow if confirmed.
                                                    if (dist > 2.0) {
                                                        const proceed = confirm(`⚠️ Estás fuera del rango permitido.\n\nDistancia: ${dist.toFixed(2)} km\nLímite: 2.0 km\n\n¿Deseas registrar la visita de todos modos?`);
                                                        if (proceed) {
                                                            navigate(`/visit/${client.id}`);
                                                        }
                                                    } else {
                                                        // Within 2km: Allowed seamlessly
                                                        navigate(`/visit/${client.id}`);
                                                    }
                                                })
                                                .catch((error) => {
                                                    console.error(error);
                                                });
                                        }}
                                        className="flex-1 bg-gray-900 text-white py-4 rounded-2xl text-xs font-bold flex items-center justify-center shadow-lg active:scale-95 transition-all group-hover:bg-indigo-600"
                                    >
                                        Registrar Visita
                                        <ChevronRight size={16} className="ml-2 opacity-50" />
                                    </button>
                                    <button
                                        onClick={() => navigate('/quotations', { state: { client: client } })}
                                        className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-100 transition-colors"
                                        title="Crear Cotización"
                                    >
                                        <FileText size={20} />
                                    </button>
                                    {portfolioTab === 'pool' && canReassignPoolLead && (
                                        <button
                                            onClick={() => handleReassignLead(client.id, client.name)}
                                            className="p-4 bg-amber-50 text-amber-700 rounded-2xl hover:bg-amber-100 transition-colors"
                                            title="Reasignar lead"
                                        >
                                            <Users size={20} />
                                        </button>
                                    )}
                                </div >
                            </div>
                        )
                    })}
                </div >
            )
            }

            {/* Client Detail View Modal */}
            {
                selectedClient && (
                    <ClientDetailModal
                        client={selectedClient}
                        onClose={() => setSelectedClient(null)}
                        onEdit={() => {
                            setSelectedClient(null);
                            handleOpenModal(selectedClient);
                        }}
                        onEmail={() => {
                            const clientToEmail = selectedClient;
                            setSelectedClient(null);
                            handleOpenEmailModal(clientToEmail);
                        }}
                    />
                )
            }

            {/* Email Modal */}
            {
                isEmailModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
                            <div className="p-8 md:p-10">
                                <div className="flex justify-between items-center mb-8">
                                    <div>
                                        <h3 className="text-2xl font-black text-gray-900">Redactar Correo</h3>
                                        <p className="text-gray-400 font-bold text-sm">Enviando como {(profile as any)?.full_name}</p>
                                    </div>
                                    <button onClick={() => setIsEmailModalOpen(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors">
                                        <X size={20} className="text-gray-400" />
                                    </button>
                                </div>

                                <form onSubmit={handleSendGmail} className="space-y-5">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Para</label>
                                        <input
                                            type="email"
                                            disabled
                                            className="w-full p-4 bg-gray-100 text-gray-500 rounded-2xl font-medium outline-none cursor-not-allowed"
                                            value={emailData.to}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">CC / BCC (Opcional)</label>
                                        <input
                                            type="text"
                                            placeholder="correo@ejemplo.com, jefe@dental.cl"
                                            className="w-full p-4 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                            value={emailData.cc}
                                            onChange={e => setEmailData({ ...emailData, cc: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Asunto</label>
                                        <input
                                            required
                                            type="text"
                                            className="w-full p-4 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-900 outline-none"
                                            value={emailData.subject}
                                            onChange={e => setEmailData({ ...emailData, subject: e.target.value })}
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Mensaje</label>
                                        <textarea
                                            required
                                            rows={8}
                                            className="w-full p-4 bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none resize-none"
                                            value={emailData.message}
                                            onChange={e => setEmailData({ ...emailData, message: e.target.value })}
                                        />
                                    </div>

                                    <div className="flex items-center justify-between pt-4 gap-4">
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            className="hidden"
                                            accept=".pdf,.doc,.docx,.jpg,.png"
                                            onChange={handleFileChange}
                                        />
                                        <button
                                            type="button"
                                            className={`flex items-center space-x-2 transition-colors px-4 py-2 rounded-xl border ${attachment ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Paperclip size={18} />
                                            <span className="text-xs font-bold truncate max-w-[150px]">
                                                {attachment ? attachment.name : 'Adjuntar Archivo'}
                                            </span>
                                            {attachment && (
                                                <X
                                                    size={14}
                                                    className="ml-2 cursor-pointer hover:text-red-500"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setAttachment(null);
                                                        if (fileInputRef.current) fileInputRef.current.value = '';
                                                    }}
                                                />
                                            )}
                                        </button>

                                        <button
                                            type="submit"
                                            disabled={sendingEmail}
                                            className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center min-w-[160px]"
                                        >
                                            {sendingEmail ? (
                                                <span className="animate-pulse">Enviando...</span>
                                            ) : (
                                                <>
                                                    <Send size={18} className="mr-2" />
                                                    Enviar Correo
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Create/Edit Client Modal */}
            {
                isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-4xl rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto">
                            <div className="flex flex-col md:flex-row h-full">
                                <div className="hidden md:block w-1/3 bg-gray-100 relative min-h-[400px]">
                                    <Map
                                        defaultCenter={manualLocation || SANTIAGO_CENTER}
                                        defaultZoom={11}
                                        mapId="DEMO_MAP_ID"
                                        className="w-full h-full absolute inset-0"
                                        onClick={(ev) => {
                                            if (ev.detail.latLng) {
                                                setManualLocation({ lat: ev.detail.latLng.lat, lng: ev.detail.latLng.lng });
                                            }
                                        }}
                                    >
                                        {manualLocation && (
                                            <AdvancedMarker position={manualLocation}>
                                                <Pin background={'#4f46e5'} borderColor={'#312e81'} glyphColor={'#fff'} />
                                            </AdvancedMarker>
                                        )}
                                        <MapHandler place={manualLocation} />
                                    </Map>
                                    <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur p-4 rounded-2xl shadow-lg border border-white/50">
                                        <p className="text-[10px] font-black uppercase text-indigo-600 mb-1">Geolocalización</p>
                                        <p className="text-xs text-gray-600 font-medium">Pincha en el mapa para ajustar la ubicación exacta.</p>
                                    </div>
                                </div>
                                <div className="flex-1 p-8 md:p-12">
                                    <div className="flex justify-between items-center mb-8">
                                        <div>
                                            <h3 className="text-2xl font-black text-gray-900">{isEditing ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
                                            <p className="text-gray-400 font-bold text-sm">
                                                {isEditing ? 'Actualiza los datos del cliente' : 'Ingresa los datos fiscales y de contacto'}
                                            </p>
                                        </div>
                                        <button onClick={() => setIsModalOpen(false)} className="p-2 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors">
                                            <X size={20} className="text-gray-400" />
                                        </button>
                                    </div>
                                    <form onSubmit={handleSaveClient} className="space-y-5">
                                        <div className="grid grid-cols-2 gap-5">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">RUT Empresa <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="text"
                                                    placeholder="76.xxx.xxx-k"
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                                    value={clientForm.rut}
                                                    onChange={e => {
                                                        const val = e.target.value;
                                                        setClientForm({ ...clientForm, rut: val })
                                                    }}
                                                    onBlur={() => {
                                                        setClientForm(prev => ({ ...prev, rut: normalizeRut(prev.rut) }))
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Razón Social <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="text"
                                                    placeholder="Nombre de la clínica..."
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-bold text-gray-700 outline-none"
                                                    value={clientForm.name}
                                                    onChange={e => setClientForm({ ...clientForm, name: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-5">
                                            <div className="col-span-2 space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Dirección Comercial <span className="text-red-500">*</span></label>
                                                <div className="relative">
                                                    <input
                                                        ref={inputRef}
                                                        required
                                                        type="text"
                                                        placeholder="Escribe una dirección y selecciónala desde Google Maps"
                                                        className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                        value={clientForm.address}
                                                        onChange={e => setClientForm({ ...clientForm, address: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Oficina / Depto</label>
                                                <input
                                                    type="text"
                                                    placeholder="Ej: Of 402"
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.office}
                                                    onChange={e => setClientForm({ ...clientForm, office: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-5">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Teléfono <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="tel"
                                                    placeholder="+56 9..."
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.phone}
                                                    onChange={e => setClientForm({ ...clientForm, phone: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Email Contacto <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="email"
                                                    placeholder="contacto@clinica.cl"
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.email}
                                                    onChange={e => setClientForm({ ...clientForm, email: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-5">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Giro <span className="text-red-500">*</span></label>
                                                <input
                                                    required
                                                    type="text"
                                                    placeholder="Ej: Clínica Dental, Insumos..."
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.giro}
                                                    onChange={e => setClientForm({ ...clientForm, giro: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Comuna</label>
                                                <input
                                                    type="text"
                                                    placeholder="Ej: San Miguel"
                                                    className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none"
                                                    value={clientForm.comuna}
                                                    onChange={e => setClientForm({ ...clientForm, comuna: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Notas Internas <span className="text-gray-300 font-normal lowercase tracking-normal">(opcional)</span></label>
                                            <textarea
                                                rows={3}
                                                placeholder="Horarios, contacto de adquisiciones, preferencias..."
                                                className="w-full p-4 bg-gray-50 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-2xl transition-all font-medium text-gray-700 outline-none resize-none"
                                                value={clientForm.notes}
                                                onChange={e => setClientForm({ ...clientForm, notes: e.target.value })}
                                            />
                                        </div>
                                        <div className="pt-6 flex gap-4">
                                            <button
                                                type="button"
                                                onClick={() => setIsModalOpen(false)}
                                                className="flex-1 py-4 font-bold text-gray-400 hover:text-gray-600 transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={submitting}
                                                className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
                                            >
                                                {submitting ? (
                                                    <span className="animate-pulse">Guardando...</span>
                                                ) : (
                                                    <>
                                                        <CheckCircle2 size={20} className="mr-2" />
                                                        {isEditing ? 'Actualizar Cliente' : 'Registrar Cliente'}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};


const Clients = () => {
    return (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} libraries={['places']}>
            <ClientsContent />
        </APIProvider>
    );
};

export default Clients;
