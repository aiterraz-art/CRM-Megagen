import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, MapPin, ChevronRight, Filter, Phone, Mail, CheckCircle2, Trash2, Building2, Pencil, Send, Paperclip, X, FileText, Upload, AlertCircle, Users } from 'lucide-react';
import Papa from 'papaparse';
import { Database } from '../types/supabase';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';
import { APIProvider, Map, AdvancedMarker, Pin, useMapsLibrary, useMap } from '@vis.gl/react-google-maps';
import ClientDetailModal from '../components/modals/ClientDetailModal';

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
    const { profile, hasPermission, isSupervisor } = useUser();
    const navigate = useNavigate();
    const searchParams = new URLSearchParams(window.location.search);
    const initialFilter = searchParams.get('filter') || 'all';

    const [clients, setClients] = useState<Client[]>([]);
    const [neglectFilter, setNeglectFilter] = useState<'all' | 'neglected'>(initialFilter as any);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [profiles, setProfiles] = useState<any[]>([]);

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
        comuna: ''
    });

    // Maps State for Modal
    const [manualLocation, setManualLocation] = useState<{ lat: number; lng: number } | null>(null);

    // Places Autocomplete Setup
    const placesLib = useMapsLibrary('places');
    const inputRef = useRef<HTMLInputElement>(null);

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

        // Create the PlaceAutocompleteElement using the New Places API
        // @ts-ignore - TS might not know about this element yet
        const autocompleteElement = new placesLib.PlaceAutocompleteElement({
            componentRestrictions: { country: 'cl' }
        });

        // Append it to our container
        inputRef.current.appendChild(autocompleteElement);

        // INITIALIZE VALUE FROM STATE (Crucial for Editing)
        if (clientForm.address) {
            // @ts-ignore
            autocompleteElement.value = clientForm.address;
        }

        // Add event listener for MANUAL input changes to sync state
        // @ts-ignore
        autocompleteElement.addEventListener('change', (e: any) => {
            // Always sync, even if empty, to allow clearing address
            setClientForm(prev => ({ ...prev, address: e.target.value || '' }));
        });

        // Add event listener for selection
        const listener = autocompleteElement.addEventListener('gmp-places-select', async (event: any) => {
            const place = event.place;

            // We need to fetch details because the event might not have all fields populated by default
            // depending on the API version, but 'place.fetchFields' is the way now.
            await place.fetchFields({
                fields: ['location', 'formattedAddress', 'addressComponents']
            });

            if (place.location && place.formattedAddress) {
                const lat = place.location.lat();
                const lng = place.location.lng();

                let comuna = '';

                // Strategy: Prioritize Address Components for cleaner data
                // In Google Maps (Chile), 'administrative_area_level_3' corresponds exactly to "Comuna"
                const components = place.addressComponents;
                if (components) {
                    const comunaComponent = components.find((c: any) => c.types.includes('administrative_area_level_3'))
                        || components.find((c: any) => c.types.includes('locality')); // Fallback

                    comuna = comunaComponent?.longText || comunaComponent?.shortText || '';
                }

                // Fallback Strategy: Extract from formattedAddress if components failed
                if (!comuna && place.formattedAddress) {
                    const parts = place.formattedAddress.split(',');
                    // Usually: "Street Number, Comuna, Region"
                    if (parts.length >= 2) {
                        // Takes the element before the last one (Region/Country) or second to last
                        // Users perception: "Name before city"
                        // Trying to capture the middle part which is usually the Comuna in "Av Providencia 123, Providencia, Santiago"
                        comuna = parts[parts.length - 2].trim();

                        // Clean up if it contains numbers (Zip Code)
                        comuna = comuna.replace(/\d+/g, '').trim();
                    }
                }

                setClientForm(prev => ({
                    ...prev,
                    address: place.formattedAddress || prev.address,
                    lat,
                    lng,
                    comuna
                }));
                // Also update the map and manual pin to this location
                setManualLocation({ lat, lng });
            }
        });

        return () => {
            // Clean up: remove the listener and the element
            // @ts-ignore
            if (autocompleteElement) {
                // @ts-ignore
                autocompleteElement.removeEventListener('gmp-places-select', listener);
                if (inputRef.current) {
                    inputRef.current.innerHTML = ''; // Remove the element from DOM
                }
            }
        };
    }, [placesLib, isModalOpen]);

    // Initial Fetch
    const fetchClients = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('clients')
                .select('*')
                .order('name');

            const canViewAll = hasPermission('VIEW_ALL_CLIENTS') || isSupervisor || profile?.email === 'aterraza@imegagen.cl';

            if (!canViewAll && profile?.id) {
                query = query.eq('created_by', profile.id);
            }

            const { data, error } = await query;

            if (error) {
                console.error("Error fetching clients:", error);
                throw error;
            }

            if (data) {
                setClients(data);

                // OPTIMIZATION: Use 'last_visit_date' directly from client record
                // This avoids fetching ALL visits separately, which was causing massive slowness (O(N) vs O(1))
                const neglectMap: Record<string, number> = {};
                const now = new Date();

                data.forEach(client => {
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
        } finally {
            setLoading(false);
        }
    };

    const fetchProfiles = async () => {
        const { data } = await supabase.from('profiles').select('id, email, full_name');
        if (data) setProfiles(data);
    };

    useEffect(() => {
        if (profile?.id) {
            fetchClients();
            fetchProfiles();
        }
    }, [profile?.id]);

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
                comuna: clientToEdit.comuna || ''
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
                comuna: ''
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
            const { data: { session } } = await supabase.auth.getSession();
            const providerToken = session?.provider_token;

            if (!providerToken) {
                alert('⚠️ No se detectó una sesión de Google activa con permisos de envío. Por favor, cierra sesión y vuelve a ingresar con Google.');
                setSendingEmail(false);
                return;
            }

            // MIME boundary
            const boundary = "foo_bar_baz";

            // Build the MIME message parts
            let messageParts = [
                `From: ${session.user.email}`,
                `To: ${emailData.to}`,
                emailData.cc ? `Cc: ${emailData.cc}` : null,
                `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(emailData.subject)))}?=`,
                'MIME-Version: 1.0',
                `Content-Type: multipart/mixed; boundary="${boundary}"`,
                '',
                `--${boundary}`,
                'Content-Type: text/plain; charset="UTF-8"',
                'Content-Transfer-Encoding: 7bit',
                '',
                emailData.message,
                ''
            ];

            // Add attachment if present
            if (attachment) {
                const reader = new FileReader();
                await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(attachment);
                });

                const base64Data = (reader.result as string).split(',')[1];

                messageParts.push(
                    `--${boundary}`,
                    `Content-Type: ${attachment.type}; name="${attachment.name}"`,
                    `Content-Disposition: attachment; filename="${attachment.name}"`,
                    'Content-Transfer-Encoding: base64',
                    '',
                    base64Data,
                    ''
                );
            }

            // Close boundary
            messageParts.push(`--${boundary}--`);

            // Join with CRLF for RFC compliance
            const rawMimeMessage = messageParts
                .filter(part => part != null)
                .join('\r\n');

            // Encode to Web-Safe Base64
            const encodedMessage = btoa(unescape(encodeURIComponent(rawMimeMessage)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            // Send via Standard Gmail API
            const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${providerToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    raw: encodedMessage
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error?.message || 'Error al enviar correo. Verifica tus permisos de Google.');
            }

            // LOG THE EMAIL
            await supabase.from('email_logs').insert({
                client_id: emailData.clientId,
                user_id: profile?.id,
                subject: emailData.subject,
                snippet: emailData.message.substring(0, 100) + '...'
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

        // FORCE READ ADDRESS FROM DOM (Fix for PlaceAutocompleteElement state verify)
        let finalAddress = clientForm.address;

        // Always try to read from the live DOM element to catch latest typing
        if (inputRef.current) {
            const domElement = inputRef.current.querySelector('gmp-place-autocomplete') as any;
            if (domElement && domElement.value) {
                console.log('📍 Reading Address directly from properties:', domElement.value);
                finalAddress = domElement.value;
            }
        }

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

        if ((!finalLat || !finalLng || isDefaultLocation) && hasAddress) {
            try {
                // console.log("⚠️ Coordenadas por defecto detectadas. Geocodificando dirección:", finalAddress);
                const geocoder = new google.maps.Geocoder();
                const { results } = await geocoder.geocode({ address: finalAddress + ', Chile' });

                if (results && results[0]) {
                    finalLat = results[0].geometry.location.lat();
                    finalLng = results[0].geometry.location.lng();

                    // Intentamos completar la Comuna si falta
                    if (!clientForm.comuna) {
                        const place = results[0];
                        const components = place.address_components;
                        if (components) {
                            const comunaComponent = components.find((c: any) => c.types.includes('administrative_area_level_3'))
                                || components.find((c: any) => c.types.includes('locality'));
                            if (comunaComponent) {
                                clientForm.comuna = comunaComponent.long_name;
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
                        comuna: clientForm.comuna
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
                        comuna: clientForm.comuna
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

    const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setImporting(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const rows = results.data as any[];
                let successCount = 0;
                let errorCount = 0;
                let errors: string[] = [];

                if (rows.length === 0) {
                    alert('El archivo CSV está vacío.');
                    setImporting(false);
                    return;
                }

                if (!hasPermission('IMPORT_CLIENTS')) {
                    alert("Acceso denegado: No tienes permisos para importar clientes masivos.");
                    setImporting(false);
                    return;
                }

                // Prepare data for bulk insert
                const clientsToInsert: any[] = [];

                for (const row of rows) {
                    // Map CSV headers to DB columns
                    const name = row['Nombre']?.trim();
                    const rut = row['Rut'] ? normalizeRut(row['Rut']) : null;
                    const giro = row['Giro']?.trim();
                    const address = row['Dirección']?.trim();
                    const comuna = row['Comuna']?.trim() || row['Ciudad']?.trim();
                    const phone = row['Teléfono']?.trim();
                    const email = row['Email']?.trim();
                    const purchase_contact = row['Contacto']?.trim();
                    const sellerEmail = row['Vendedor']?.trim();

                    if (!name) {
                        errorCount++;
                        errors.push(`Fila sin nombre: ${JSON.stringify(row)}`);
                        continue;
                    }

                    // Resolve Seller
                    let assignedSellerId = profile?.id; // Default to current user
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
                        notes: 'Importado vía CSV'
                    });
                }

                if (clientsToInsert.length > 0) {
                    // Bulk insert with check
                    for (const client of clientsToInsert) {
                        try {
                            if (client.rut) {
                                const { data: dup } = await supabase.from('clients').select('id').eq('rut', client.rut).single();
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
                if (errors.length > 0) console.error("CSV Import Errors:", errors);

                setImporting(false);
                if (csvInputRef.current) csvInputRef.current.value = '';
                fetchClients();
            },
            error: (err) => {
                console.error("CSV Parse Error:", err);
                alert("Error al leer el archivo CSV.");
                setImporting(false);
            }
        });
    };

    const canViewAll = hasPermission('VIEW_ALL_CLIENTS') || isSupervisor || profile?.email === 'aterraza@imegagen.cl';

    const filteredClients = clients.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.rut?.toLowerCase().includes(search.toLowerCase()) ||
            (c.address?.toLowerCase().includes(search.toLowerCase()) ?? false);

        const isOwner = c.created_by === profile?.id;

        const isNeglected = (neglectedData[c.id] || 0) >= 15;
        const passesNeglect = neglectFilter === 'all' || isNeglected;

        if (canViewAll) {
            return (viewMode === 'all' || isOwner) && matchesSearch && passesNeglect;
        }
        return isOwner && matchesSearch && passesNeglect;
    });

    return (
        <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 leading-tight">Gestión de Clientes</h2>
                    <p className="text-gray-500 font-medium mt-1">
                        {canViewAll ? 'Administración total de la cartera' : 'Tu cartera de clientes asignada'}
                    </p>
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
                                accept=".csv"
                                ref={csvInputRef}
                                onChange={handleCSVUpload}
                                className="hidden"
                            />
                            <button
                                onClick={() => csvInputRef.current?.click()}
                                disabled={importing}
                                className="bg-indigo-50 text-indigo-600 px-4 py-4 rounded-2xl font-bold flex items-center hover:bg-indigo-100 transition-all text-sm disabled:opacity-50"
                                title="Importar CSV"
                            >
                                {importing ? (
                                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent animate-spin rounded-full mr-2"></div>
                                ) : (
                                    <Upload size={18} className="mr-2" />
                                )}
                                {importing ? '...' : 'Importar'}
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
                </div>
            </div>

            <div className="relative max-w-2xl">
                <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                <input
                    type="text"
                    placeholder="Buscar por nombre, RUT o dirección..."
                    className="w-full pl-14 pr-6 py-5 bg-white border-none rounded-[2rem] shadow-sm ring-1 ring-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-gray-700 font-medium placeholder:text-gray-400"
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
                    {profile?.email === 'aterraza@imegagen.cl' && clients.length === 0 && (
                        <div className="mt-8 p-6 bg-red-50 rounded-2xl border border-red-100 text-red-700 text-xs font-mono">
                            <p className="font-bold mb-2">DEBUG ADMIN INFO:</p>
                            <p>User ID: {profile?.id}</p>
                            <p>Global Clients Count: {clients.length}</p>
                            <p>Check your RLS policies in Supabase Dashboard.</p>
                        </div>
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
                                    </div>

                                    <div className="space-y-3">
                                        {(client.address || client.comuna) && (
                                            <div className="flex items-start text-xs text-gray-500 font-medium bg-gray-50 p-3 rounded-xl">
                                                <MapPin size={14} className="mr-2 mt-0.5 text-indigo-500 shrink-0" />
                                                <span className="line-clamp-2">{[client.address, client.comuna].filter(Boolean).join(', ')}</span>
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
                                                                    status: 'completada', // Default to completed as we don't track duration
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
                                            if (!navigator.geolocation) {
                                                alert("Tu navegador no soporta geolocalización.");
                                                return;
                                            }
                                            navigator.geolocation.getCurrentPosition(
                                                (position) => {
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
                                                },
                                                (error) => {
                                                    console.error(error);
                                                    alert("No pudimos obtener tu ubicación. Asegúrate de tener el GPS activado.");
                                                },
                                                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                                            );
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
                                            <Trash2 size={20} className="text-gray-400" />
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
                                        <div className="space-y-2">
                                            <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">Dirección Comercial <span className="text-red-500">*</span></label>
                                            <div className="relative">
                                                {/* <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 z-10" size={18} /> */}
                                                <div
                                                    ref={inputRef as any} // Cast to any because we attach a web component here div
                                                    className="w-full"
                                                >
                                                    {/* The Google Places Autocomplete Element will be injected here */}
                                                </div>
                                                {/* Hidden input to keep form state valid if needed, or just rely on state */}
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
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <ClientsContent />
        </APIProvider>
    );
};

export default Clients;
