import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { utils, writeFile } from 'xlsx';
import { Upload, Download, DollarSign, Paperclip, Eye } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { CollectionUploadRejected, parseCollectionsImportFile, uploadCollectionsSnapshot } from '../utils/collectionsImport';
import ClientFormModal from '../components/modals/ClientFormModal';
import { Database } from '../types/supabase';

type Client = Database['public']['Tables']['clients']['Row'];
const PAYMENT_PROOFS_BUCKET = 'payment-proofs';
const MAX_COLLECTION_PROOF_BYTES = 20 * 1024 * 1024;
const ALLOWED_COLLECTION_PROOF_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg',
    'image/heic',
    'image/heif'
]);

const normalizeRut = (value: string | null | undefined) =>
    (value || '').toString().replace(/[^0-9kK]/g, '').toUpperCase();

const formatShortDate = (value: string | null | undefined) => {
    if (!value) return '-';
    const raw = String(value).trim();
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
    const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return `${match[3]}/${match[2]}/${match[1]}`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const day = `${parsed.getDate()}`.padStart(2, '0');
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
};

const sanitizeFileName = (value: string) =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_');

const Collections = () => {
    const { profile, effectiveRole, hasPermission } = useUser();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const proofInputRef = useRef<HTMLInputElement | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    const [allRows, setAllRows] = useState<any[]>([]);
    const [allPaidRows, setAllPaidRows] = useState<any[]>([]);
    const [allSummary, setAllSummary] = useState<any[]>([]);
    const [activeBatch, setActiveBatch] = useState<any>(null);
    const [rejectedRows, setRejectedRows] = useState<CollectionUploadRejected[]>([]);
    const [sellerOptions, setSellerOptions] = useState<any[]>([]);

    const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
    const [sellerAssignments, setSellerAssignments] = useState<Record<string, string>>({});
    const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
    const [assigningSellerId, setAssigningSellerId] = useState<string | null>(null);
    const [proofUploadingId, setProofUploadingId] = useState<string | null>(null);
    const [proofOpeningId, setProofOpeningId] = useState<string | null>(null);
    const [sellerFilter, setSellerFilter] = useState<string>('all');
    const [amountSort, setAmountSort] = useState<'highest' | 'lowest'>('highest');
    const [existingClientRutSet, setExistingClientRutSet] = useState<Set<string>>(new Set());
    const [clientCreationContext, setClientCreationContext] = useState<{ row: any; sellerId: string } | null>(null);
    const [proofTargetRow, setProofTargetRow] = useState<any | null>(null);

    const isSeller = effectiveRole === 'seller';
    const isChief = effectiveRole === 'jefe';
    const canManageCollections = hasPermission('MANAGE_COLLECTIONS');
    const canManageClientOwnership = hasPermission('MANAGE_CLIENTS') || effectiveRole === 'jefe';
    const canUpload = canManageCollections;
    const canDownloadTemplate = canManageCollections;
    const canEditComment = effectiveRole === 'seller' || canManageCollections;
    const canAssignSeller = canManageCollections && canManageClientOwnership;
    const canFilterBySeller = canManageCollections || isChief;

    const normalizeEmail = (value: string | null | undefined) => (value || '').trim().toLowerCase();

    const rows = useMemo(() => {
        if (!isSeller) return allRows;
        const myEmail = normalizeEmail(profile?.email);
        const myId = profile?.id;
        return allRows.filter((row) => {
            const sellerId = row.seller_id || null;
            const sellerEmail = normalizeEmail(row.seller_email);
            return (myId && sellerId === myId) || (myEmail && sellerEmail === myEmail);
        });
    }, [allRows, isSeller, profile?.email, profile?.id]);

    const summary = useMemo(() => {
        if (!isSeller) return allSummary;
        const myEmail = normalizeEmail(profile?.email);
        const myId = profile?.id;
        return allSummary.filter((item) => {
            const sellerId = item.seller_id || null;
            const sellerEmail = normalizeEmail(item.seller_email);
            return (myId && sellerId === myId) || (myEmail && sellerEmail === myEmail);
        });
    }, [allSummary, isSeller, profile?.email, profile?.id]);

    const paidRows = useMemo(() => {
        if (!isSeller) return allPaidRows;
        const myEmail = normalizeEmail(profile?.email);
        const myId = profile?.id;
        return allPaidRows.filter((row) => {
            const sellerId = row.seller_id || null;
            const sellerEmail = normalizeEmail(row.seller_email);
            return (myId && sellerId === myId) || (myEmail && sellerEmail === myEmail);
        });
    }, [allPaidRows, isSeller, profile?.email, profile?.id]);

    const filteredRows = useMemo(() => {
        const base = !canFilterBySeller || sellerFilter === 'all'
            ? rows
            : sellerFilter === '__unassigned__'
                ? rows.filter((row) => !row.seller_id && !normalizeEmail(row.seller_email))
                : rows.filter((row) => row.seller_id === sellerFilter);

        return [...base].sort((a, b) => {
            const aAmount = Number(a.outstanding_amount || a.amount || 0);
            const bAmount = Number(b.outstanding_amount || b.amount || 0);
            return amountSort === 'highest' ? bAmount - aAmount : aAmount - bAmount;
        });
    }, [rows, canFilterBySeller, sellerFilter, amountSort]);

    const filteredPaidRows = useMemo(() => {
        const base = !canFilterBySeller || sellerFilter === 'all'
            ? paidRows
            : sellerFilter === '__unassigned__'
                ? paidRows.filter((row) => !row.seller_id && !normalizeEmail(row.seller_email))
                : paidRows.filter((row) => row.seller_id === sellerFilter);

        return [...base].sort((a, b) => {
            const aAmount = Number(a.amount || 0);
            const bAmount = Number(b.amount || 0);
            return amountSort === 'highest' ? bAmount - aAmount : aAmount - bAmount;
        });
    }, [paidRows, canFilterBySeller, sellerFilter, amountSort]);

    const filteredSummary = useMemo(() => {
        const base = !canFilterBySeller || sellerFilter === 'all'
            ? summary
            : sellerFilter === '__unassigned__'
                ? summary.filter((item) => !item.seller_id && !normalizeEmail(item.seller_email))
                : summary.filter((item) => item.seller_id === sellerFilter);

        return [...base].sort((a, b) => Number(b.outstanding_total || 0) - Number(a.outstanding_total || 0));
    }, [summary, canFilterBySeller, sellerFilter]);

    const sellerFilterOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ value: string; label: string }> = [];

        sellerOptions.forEach((seller) => {
            if (!seller?.id || seen.has(seller.id)) return;
            seen.add(seller.id);
            options.push({ value: seller.id, label: seller.full_name || seller.email || 'Sin nombre' });
        });

        rows.forEach((row) => {
            if (!row.seller_id || seen.has(row.seller_id)) return;
            seen.add(row.seller_id);
            options.push({ value: row.seller_id, label: row.seller_name || row.seller_email || 'Sin nombre' });
        });

        return options.sort((a, b) => a.label.localeCompare(b.label, 'es'));
    }, [sellerOptions, rows]);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [rowsRes, paidRowsRes, summaryRes, batchRes] = await Promise.all([
                supabase.from('vw_collections_pending_current').select('*').order('due_date', { ascending: true }).limit(5000),
                supabase.from('vw_collections_paid_history').select('*').order('paid_detected_at', { ascending: false }).limit(5000),
                supabase.from('vw_collections_seller_summary_current').select('*').limit(500),
                supabase.from('collections_import_batches').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
            ]);

            const firstError = rowsRes.error || paidRowsRes.error || summaryRes.error || batchRes.error;
            if (firstError) throw firstError;

            const loadedRows = rowsRes.data || [];
            setAllRows(loadedRows);
            setAllPaidRows(paidRowsRes.data || []);
            setAllSummary(summaryRes.data || []);
            setActiveBatch(batchRes.data || null);

            const initialDrafts: Record<string, string> = {};
            loadedRows.forEach((row: any) => {
                initialDrafts[row.id] = row.seller_comment || '';
            });
            setCommentDrafts(initialDrafts);
            setSellerAssignments((prev) => {
                const next = { ...prev };
                loadedRows.forEach((row: any) => {
                    if (row.seller_id && !next[row.id]) {
                        next[row.id] = row.seller_id;
                    }
                });
                return next;
            });

            const uniqueRuts = Array.from(new Set(
                loadedRows
                    .map((row: any) => normalizeRut(row.client_rut))
                    .filter(Boolean)
            ));

            if (uniqueRuts.length > 0) {
                const matchingRuts = new Set<string>();
                const chunkSize = 200;
                for (let i = 0; i < uniqueRuts.length; i += chunkSize) {
                    const chunk = uniqueRuts.slice(i, i + chunkSize);
                    const { data: clientsData, error: clientsError } = await supabase
                        .from('clients')
                        .select('rut')
                        .in('rut', chunk.map((rut) => {
                            if (rut.length < 2) return rut;
                            return `${rut.slice(0, -1)}-${rut.slice(-1)}`;
                        }));

                    if (clientsError) throw clientsError;
                    (clientsData || []).forEach((client: any) => {
                        const normalized = normalizeRut(client.rut);
                        if (normalized) matchingRuts.add(normalized);
                    });
                }
                setExistingClientRutSet(matchingRuts);
            } else {
                setExistingClientRutSet(new Set());
            }
        } catch (e: any) {
            setError(e?.message || 'Error cargando cobranzas');
        } finally {
            setLoading(false);
        }
    };

    const fetchAssignableSellers = async () => {
        if (!canAssignSeller) return;

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, email, role, status')
                .eq('status', 'active')
                .order('full_name');

            if (error) throw error;

            const assignableRoles = new Set(['seller', 'jefe', 'manager', 'admin']);
            setSellerOptions((data || []).filter((row) => assignableRoles.has(String(row.role || '').toLowerCase())));
        } catch (e) {
            console.error('No se pudo cargar la lista de vendedores para cobranza', e);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    useEffect(() => {
        fetchAssignableSellers();
    }, [canAssignSeller]);

    const downloadTemplate = () => {
        if (!canDownloadTemplate) {
            alert('Solo usuarios con gestión de cobranzas pueden descargar la plantilla.');
            return;
        }
        const ws = utils.aoa_to_sheet([
            ['Codigo Cliente', 'Nombre', 'Docto', 'Serie', 'Numero', 'Vencimiento', '( > 90 ) $', '(61 - 90) $', '(31 - 60) $', '( 0 - 30) $', 'Saldo $'],
            ['76.123.456-7', 'Clinica Norte', 'FVAELECT', '', '100234', '2026-03-01', '0', '0', '0', '1500000', '1500000'],
            ['Saldo Cliente', '', '', '', '', '', '0', '0', '0', '1500000', '1500000']
        ]);
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'cobranzas');
        writeFile(wb, 'plantilla_cobranzas_erp.xlsx');
    };

    const downloadCurrent = () => {
        const exportRows = rows.map((row) => ({
            seller_email: row.seller_email || '',
            seller_name: row.seller_name || '',
            client_name: row.client_name || '',
            client_rut: row.client_rut || '',
            document_number: row.document_number || '',
            due_date: row.due_date || '',
            amount: Number(row.amount || 0),
            outstanding_amount: Number(row.outstanding_amount || 0),
            status: row.status || '',
            seller_comment: row.seller_comment || '',
            aging_days: Number(row.aging_days || 0)
        }));
        const ws = utils.json_to_sheet(exportRows);
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'cobranzas_activas');
        writeFile(wb, isSeller ? 'mis_cobranzas.xlsx' : 'cobranzas_activas.xlsx');
    };

    const downloadRejected = () => {
        if (rejectedRows.length === 0) return;
        const ws = utils.json_to_sheet(rejectedRows);
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'filas_rechazadas');
        writeFile(wb, 'cobranzas_filas_rechazadas.xlsx');
    };

    const uploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!canUpload) {
            alert('Solo usuarios con gestión de cobranzas pueden cargar cobranzas.');
            e.target.value = '';
            return;
        }

        setUploading(true);
        setRejectedRows([]);
        try {
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (!ext || !['xlsx', 'xls', 'csv'].includes(ext)) {
                throw new Error('Formato no soportado. Usa .xlsx, .xls o .csv');
            }

            const buffer = await file.arrayBuffer();
            const parsed = parseCollectionsImportFile(buffer);
            if (parsed.valid.length === 0) {
                throw new Error('No se encontraron filas válidas. Verifica que el archivo corresponda al formato del ERP o a la plantilla histórica.');
            }
            setRejectedRows(parsed.rejected);

            await uploadCollectionsSnapshot(supabase, {
                fileName: file.name,
                uploadedBy: profile?.id || null,
                rows: parsed.valid,
                format: parsed.detectedFormat === 'erp' ? 'erp' : 'full'
            });

            const rejectedNotice = parsed.rejected.length > 0 ? ` Filas rechazadas: ${parsed.rejected.length}.` : '';
            alert(`Sincronización completada. Documentos vigentes cargados: ${parsed.valid.length}.${rejectedNotice} Lo que no venía en este archivo quedó marcado como pagado.`);
            fetchData();
        } catch (err: any) {
            alert(`Error cargando cobranzas: ${err?.message || 'desconocido'}`);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const totals = useMemo(() => {
        const docs = filteredRows.length;
        const outstanding = filteredRows.reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        const overdue = filteredRows.filter(row => Number(row.aging_days || 0) > 0).reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        return { docs, outstanding, overdue };
    }, [filteredRows]);

    const paidTotals = useMemo(() => {
        const docs = filteredPaidRows.length;
        const amount = filteredPaidRows.reduce((acc, row) => acc + Number(row.amount || 0), 0);
        return { docs, amount };
    }, [filteredPaidRows]);

    const missingSellerCount = useMemo(
        () => rows.filter((row) => !row.seller_id && !normalizeEmail(row.seller_email)).length,
        [rows]
    );

    const saveSellerComment = async (row: any) => {
        if (!canEditComment) return;
        const draft = (commentDrafts[row.id] ?? '').trim();
        setSavingCommentId(row.id);
        try {
            const payload: any = {
                seller_comment: draft || null,
                seller_comment_updated_at: new Date().toISOString(),
                seller_comment_updated_by: profile?.id || null
            };
            const { error } = await supabase.from('collections_pending').update(payload).eq('id', row.id);
            if (error) throw error;
            setAllRows(prev => prev.map((r: any) => r.id === row.id ? { ...r, seller_comment: draft || null } : r));
        } catch (e: any) {
            alert(`No se pudo guardar descargo: ${e?.message || 'desconocido'}`);
        } finally {
            setSavingCommentId(null);
        }
    };

    const uploadCollectionProof = async (row: any, file: File) => {
        if (!profile?.id) throw new Error('No autenticado');
        if (!canEditComment) throw new Error('Sin permisos para subir comprobantes');

        const mimeType = file.type || 'application/octet-stream';
        if (!ALLOWED_COLLECTION_PROOF_TYPES.has(mimeType)) {
            throw new Error('Formato no permitido. Usa PDF, JPG, PNG, WEBP o HEIC.');
        }
        if (file.size > MAX_COLLECTION_PROOF_BYTES) {
            throw new Error('El archivo supera el máximo de 20MB.');
        }

        const fileName = sanitizeFileName(file.name || 'comprobante_pago');
        const path = `${profile.id}/collections/${row.id}/${Date.now()}_${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from(PAYMENT_PROOFS_BUCKET)
            .upload(path, file, { contentType: mimeType, upsert: false });
        if (uploadError) throw uploadError;

        const payload = {
            payment_proof_path: path,
            payment_proof_name: file.name || fileName,
            payment_proof_mime_type: mimeType,
            payment_proof_uploaded_at: new Date().toISOString(),
            payment_proof_uploaded_by: profile.id
        };

        const { error: updateError } = await supabase
            .from('collections_pending')
            .update(payload)
            .eq('id', row.id);
        if (updateError) throw updateError;

        setAllRows((prev) => prev.map((item: any) => item.id === row.id ? { ...item, ...payload } : item));
        setAllPaidRows((prev) => prev.map((item: any) => item.id === row.id ? { ...item, ...payload } : item));
    };

    const handleProofUploadClick = (row: any) => {
        if (!canEditComment) return;
        setProofTargetRow(row);
        proofInputRef.current?.click();
    };

    const handleProofFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        const targetRow = proofTargetRow;
        event.target.value = '';
        if (!file || !targetRow) return;

        setProofUploadingId(targetRow.id);
        try {
            await uploadCollectionProof(targetRow, file);
            alert('Comprobante de pago cargado correctamente.');
        } catch (uploadError: any) {
            alert(`No se pudo cargar el comprobante: ${uploadError?.message || 'desconocido'}`);
        } finally {
            setProofUploadingId(null);
            setProofTargetRow(null);
        }
    };

    const openCollectionProof = async (row: any) => {
        if (!row.payment_proof_path) return;
        setProofOpeningId(row.id);
        try {
            const { data, error: signedUrlError } = await supabase.storage
                .from(PAYMENT_PROOFS_BUCKET)
                .createSignedUrl(row.payment_proof_path, 60 * 60);
            if (signedUrlError) throw signedUrlError;
            window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
        } catch (openError: any) {
            alert(`No se pudo abrir el comprobante: ${openError?.message || 'desconocido'}`);
        } finally {
            setProofOpeningId(null);
        }
    };

    const assignSeller = async (row: any) => {
        if (!canAssignSeller) return;

        const sellerId = sellerAssignments[row.id];
        if (!sellerId) {
            alert('Selecciona un vendedor antes de guardar la asignación.');
            return;
        }

        const normalizedRut = normalizeRut(row.client_rut);
        if (normalizedRut && !existingClientRutSet.has(normalizedRut)) {
            setClientCreationContext({ row, sellerId });
            return;
        }

        setAssigningSellerId(row.id);
        try {
            const { data, error } = await supabase.rpc('assign_collection_seller', {
                p_collection_id: row.id,
                p_seller_id: sellerId
            } as any);
            if (error) throw error;

            const updatedDocuments = Number(data?.updated_documents || 0);
            const updatedClients = Number(data?.updated_clients || 0);
            alert(`Vendedor asignado correctamente. Documentos actualizados: ${updatedDocuments}. Clientes corregidos: ${updatedClients}.`);
            await fetchData();
        } catch (e: any) {
            alert(`No se pudo asignar vendedor: ${e?.message || 'desconocido'}`);
        } finally {
            setAssigningSellerId(null);
        }
    };

    const handleCreateClientFromCollection = async (formData: Partial<Client>) => {
        if (!clientCreationContext) return;

        const normalizedRut = normalizeRut(formData.rut || clientCreationContext.row.client_rut);
        if (!normalizedRut) {
            throw new Error('El cliente debe tener un RUT válido para crearse desde cobranza.');
        }

        const formattedRut = `${normalizedRut.slice(0, -1)}-${normalizedRut.slice(-1)}`;
        const finalAddress = String(formData.address || '').trim() || 'Dirección por actualizar';
        const finalComuna = String(formData.comuna || '').trim() || null;
        const finalLat = Number(formData.lat || 0);
        const finalLng = Number(formData.lng || 0);

        const clientPayload = {
            id: crypto.randomUUID(),
            name: String(formData.name || clientCreationContext.row.client_name || '').trim(),
            rut: formattedRut,
            phone: String(formData.phone || '').trim(),
            email: String(formData.email || '').trim(),
            address: finalAddress,
            office: String(formData.office || '').trim() || null,
            lat: Number.isFinite(finalLat) ? finalLat : 0,
            lng: Number.isFinite(finalLng) ? finalLng : 0,
            notes: String(formData.notes || 'Creado desde módulo de cobranzas').trim(),
            created_by: clientCreationContext.sellerId,
            pending_seller_email: null,
            status: 'active',
            zone: 'Santiago',
            giro: String(formData.giro || '').trim() || null,
            comuna: finalComuna,
            credit_days: 0,
            purchase_contact: String(formData.purchase_contact || '').trim() || null
        };

        const { error: insertError } = await supabase.from('clients').insert(clientPayload);
        if (insertError) throw insertError;

        setExistingClientRutSet((prev) => new Set([...prev, normalizedRut]));

        const targetRow = clientCreationContext.row;
        const targetSeller = clientCreationContext.sellerId;
        setClientCreationContext(null);
        setSellerAssignments((prev) => ({ ...prev, [targetRow.id]: targetSeller }));

        setAssigningSellerId(targetRow.id);
        try {
            const { data, error } = await supabase.rpc('assign_collection_seller', {
                p_collection_id: targetRow.id,
                p_seller_id: targetSeller
            } as any);
            if (error) throw error;

            const updatedDocuments = Number(data?.updated_documents || 0);
            const updatedClients = Number(data?.updated_clients || 0);
            alert(`Cliente creado y vendedor asignado correctamente. Documentos actualizados: ${updatedDocuments}. Clientes corregidos: ${updatedClients}.`);
            await fetchData();
        } finally {
            setAssigningSellerId(null);
        }
    };

    if (effectiveRole === 'driver') {
        return <div className="p-10 text-center font-bold">Acceso denegado</div>;
    }

    return (
        <>
        <div className="space-y-6 pb-20">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-4xl font-black text-gray-900">Cobranzas</h2>
                    <p className="text-gray-500 font-medium">Dataset oficial cargado por Excel/CSV. Los pedidos del CRM no suman cobranza.</p>
                </div>
                <button onClick={fetchData} className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold">Actualizar</button>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">{error}</div>}
            {loading && <div className="p-4 bg-gray-50 rounded-xl border">Cargando...</div>}

            <div className="bg-white border rounded-2xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h3 className="font-black text-lg">Carga masiva de cobranzas</h3>
                        <p className="text-sm text-gray-500">
                            Sincronización por snapshot del ERP. Los documentos que sigan viniendo conservan el descargo del vendedor; los que desaparecen se marcan como pagados.
                        </p>
                        {activeBatch && (
                            <p className="text-xs text-gray-500 mt-1">
                                Batch activo: <span className="font-bold">{String(activeBatch.id).slice(0, 8)}</span> • Archivo: {activeBatch.file_name} • Filas: {activeBatch.row_count}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {canDownloadTemplate && (
                            <button onClick={downloadTemplate} className="px-3 py-2 rounded-xl border font-bold text-sm inline-flex items-center gap-2">
                                <Download size={14} /> Descargar plantilla
                            </button>
                        )}
                        <button onClick={downloadCurrent} className="px-3 py-2 rounded-xl border font-bold text-sm inline-flex items-center gap-2">
                            <Download size={14} /> Descargar datos
                        </button>
                        {rejectedRows.length > 0 && (
                            <button onClick={downloadRejected} className="px-3 py-2 rounded-xl border font-bold text-sm inline-flex items-center gap-2 text-amber-700">
                                <Download size={14} /> Exportar rechazadas ({rejectedRows.length})
                            </button>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                            onChange={uploadFile}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading || !canUpload}
                            className={`px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2 ${uploading || !canUpload ? 'bg-gray-200 text-gray-500' : 'bg-slate-900 text-white'}`}
                        >
                            <Upload size={14} /> {uploading ? 'Cargando...' : 'Subir archivo'}
                        </button>
                    </div>
                </div>

                {!canUpload && (
                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-sm">
                        Solo usuarios con gestión de cobranzas pueden subir archivos. Tú puedes visualizar tus cobranzas asignadas y registrar descargos.
                    </div>
                )}

                {canAssignSeller && missingSellerCount > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-sm">
                        Hay {missingSellerCount} documento(s) sin vendedor resuelto. Puedes asignarlos manualmente y el sistema corregirá también el cliente para próximas cargas.
                    </div>
                )}

                {rejectedRows.length > 0 && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-sm">
                        {rejectedRows.length} fila(s) fueron rechazadas por validación estricta. Puedes descargar el detalle en "Exportar rechazadas".
                    </div>
                )}

                <div className="grid md:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-gray-50 border"><p className="text-xs text-gray-500">Documentos</p><p className="text-xl font-black">{totals.docs}</p></div>
                    <div className="p-3 rounded-xl bg-gray-50 border"><p className="text-xs text-gray-500">Saldo total</p><p className="text-xl font-black">${totals.outstanding.toLocaleString('es-CL')}</p></div>
                    <div className="p-3 rounded-xl bg-gray-50 border"><p className="text-xs text-gray-500">Saldo vencido</p><p className="text-xl font-black text-red-600">${totals.overdue.toLocaleString('es-CL')}</p></div>
                </div>

            </div>

            {canFilterBySeller && (
                <div className="bg-white border rounded-2xl p-4 space-y-3">
                    <div>
                        <h3 className="font-black text-lg">Filtros y orden</h3>
                        <p className="text-sm text-gray-500">Disponible para tesorería, facturación, admins y jefaturas comerciales.</p>
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-[0.2em] text-gray-500 mb-2">Filtrar por vendedor</label>
                            <select
                                value={sellerFilter}
                                onChange={(ev) => setSellerFilter(ev.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                            >
                                <option value="all">Todos los vendedores</option>
                                <option value="__unassigned__">Sin vendedor asignado</option>
                                {sellerFilterOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-[0.2em] text-gray-500 mb-2">Ordenar por cobranza</label>
                            <select
                                value={amountSort}
                                onChange={(ev) => setAmountSort(ev.target.value as 'highest' | 'lowest')}
                                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                            >
                                <option value="highest">Mayor saldo primero</option>
                                <option value="lowest">Menor saldo primero</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid lg:grid-cols-3 gap-4">
                <div className="bg-white border rounded-2xl p-4 lg:col-span-1">
                    <h3 className="font-black mb-3">Resumen por vendedor</h3>
                    <div className="space-y-2 max-h-[420px] overflow-auto">
                        {filteredSummary.map((s) => (
                            <div key={s.seller_key} className="p-3 rounded-xl border">
                                <p className="text-sm font-bold">{s.seller_name || s.seller_email || 'Sin vendedor'}</p>
                                <p className="text-xs text-gray-500">Docs: {Number(s.documents || 0)}</p>
                                <p className="text-xs text-gray-500">Pendiente: ${Number(s.outstanding_total || 0).toLocaleString('es-CL')}</p>
                                <p className="text-xs text-red-600">Vencido: ${Number(s.overdue_total || 0).toLocaleString('es-CL')}</p>
                            </div>
                        ))}
                        {filteredSummary.length === 0 && <p className="text-xs text-gray-500">Sin datos cargados.</p>}
                    </div>
                </div>

            <div className="bg-white border rounded-2xl p-4 lg:col-span-2">
                    <h3 className="font-black mb-3 inline-flex items-center gap-2"><DollarSign size={16} />Documentos</h3>
                    <div className="md:hidden space-y-3 max-h-[520px] overflow-y-auto">
                        {filteredRows.map((r) => (
                            <div key={r.id} className="border rounded-2xl p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-black text-gray-900">{r.client_name}</p>
                                        <p className="text-xs text-gray-500">{r.client_rut || '-'}</p>
                                        {canAssignSeller && normalizeRut(r.client_rut) && !existingClientRutSet.has(normalizeRut(r.client_rut)) && (
                                            <p className="mt-1 text-[11px] font-bold text-amber-700">Cliente no existe en CRM</p>
                                        )}
                                    </div>
                                    <span className="shrink-0 px-2 py-1 rounded-full bg-gray-100 text-[11px] font-bold text-gray-700">{r.status}</span>
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Documento</p>
                                        <p className="font-semibold text-gray-800">{r.document_number}</p>
                                    </div>
                                    <div>
                                        <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Vence</p>
                                        <p className="font-semibold text-gray-800">{formatShortDate(r.due_date)}</p>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Monto c/IVA</p>
                                        <p className="font-black text-lg text-gray-900">${Number(r.amount || 0).toLocaleString('es-CL')}</p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Vendedor</p>
                                    {r.seller_name || r.seller_email ? (
                                        <p className="text-sm text-gray-700">{r.seller_name || r.seller_email}</p>
                                    ) : canAssignSeller ? (
                                        <div className="space-y-2">
                                            <select
                                                value={sellerAssignments[r.id] || ''}
                                                onChange={(ev) => setSellerAssignments((prev) => ({ ...prev, [r.id]: ev.target.value }))}
                                                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm"
                                            >
                                                <option value="">Asignar vendedor...</option>
                                                {sellerOptions.map((seller) => (
                                                    <option key={seller.id} value={seller.id}>
                                                        {seller.full_name || seller.email}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => assignSeller(r)}
                                                disabled={assigningSellerId === r.id || !sellerAssignments[r.id]}
                                                className="w-full px-3 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold disabled:opacity-50"
                                            >
                                                {assigningSellerId === r.id ? 'Asignando...' : 'Asignar vendedor'}
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-gray-500">-</p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Descargo</p>
                                    {canEditComment ? (
                                        <div className="space-y-2">
                                            <textarea
                                                value={commentDrafts[r.id] ?? ''}
                                                onChange={(ev) => setCommentDrafts(prev => ({ ...prev, [r.id]: ev.target.value }))}
                                                placeholder="Cliente ya pagó / paga mañana / próxima semana..."
                                                rows={3}
                                                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none"
                                            />
                                            <button
                                                onClick={() => saveSellerComment(r)}
                                                disabled={savingCommentId === r.id}
                                                className="w-full px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-50"
                                            >
                                                {savingCommentId === r.id ? 'Guardando...' : 'Guardar descargo'}
                                            </button>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => handleProofUploadClick(r)}
                                                    disabled={proofUploadingId === r.id}
                                                    className="px-3 py-2 rounded-xl border border-indigo-200 text-indigo-700 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    <Paperclip size={14} />
                                                    {proofUploadingId === r.id ? 'Subiendo...' : 'Subir comprobante'}
                                                </button>
                                                <button
                                                    onClick={() => openCollectionProof(r)}
                                                    disabled={!r.payment_proof_path || proofOpeningId === r.id}
                                                    className="px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                                                >
                                                    <Eye size={14} />
                                                    {proofOpeningId === r.id ? 'Abriendo...' : (r.payment_proof_path ? 'Ver comprobante' : 'Sin comprobante')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-700">{r.seller_comment || '-'}</p>
                                            <button
                                                onClick={() => openCollectionProof(r)}
                                                disabled={!r.payment_proof_path || proofOpeningId === r.id}
                                                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                                            >
                                                <Eye size={14} />
                                                {proofOpeningId === r.id ? 'Abriendo...' : (r.payment_proof_path ? 'Ver comprobante' : 'Sin comprobante')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {filteredRows.length === 0 && <div className="py-6 text-center text-gray-500 text-sm">Sin documentos en dataset activo.</div>}
                    </div>

                    <div className="hidden md:block -mx-4 overflow-x-auto md:mx-0">
                        <div className="min-w-[1180px] px-4 md:px-0">
                        <div className="overflow-y-auto max-h-[520px]">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left border-b">
                                    <th className="py-2 pr-2">Razón social</th>
                                    <th className="py-2 pr-2">RUT</th>
                                    <th className="py-2 pr-2">N° documento</th>
                                    <th className="py-2 pr-2">Vence</th>
                                    <th className="py-2 pr-2">Estado</th>
                                    <th className="py-2 pr-2">Monto c/IVA</th>
                                    <th className="py-2 pr-2">Vendedor</th>
                                    <th className="py-2 pr-2">Descargo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRows.map((r) => (
                                    <tr key={r.id} className="border-b last:border-0 align-top">
                                        <td className="py-2 pr-2">{r.client_name}</td>
                                        <td className="py-2 pr-2">
                                            <div className="space-y-1">
                                                <span>{r.client_rut || '-'}</span>
                                                {canAssignSeller && normalizeRut(r.client_rut) && !existingClientRutSet.has(normalizeRut(r.client_rut)) && (
                                                    <span className="block text-[11px] font-bold text-amber-700">Cliente no existe en CRM</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-2 pr-2">{r.document_number}</td>
                                        <td className="py-2 pr-2 whitespace-nowrap">{formatShortDate(r.due_date)}</td>
                                        <td className="py-2 pr-2">{r.status}</td>
                                        <td className="py-2 pr-2 font-bold">${Number(r.amount || 0).toLocaleString('es-CL')}</td>
                                        <td className="py-2 pr-2 text-xs text-gray-600 min-w-[260px]">
                                            {r.seller_name || r.seller_email ? (
                                                <span>{r.seller_name || r.seller_email}</span>
                                            ) : canAssignSeller ? (
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={sellerAssignments[r.id] || ''}
                                                        onChange={(ev) => setSellerAssignments((prev) => ({ ...prev, [r.id]: ev.target.value }))}
                                                        className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                                                    >
                                                        <option value="">Asignar vendedor...</option>
                                                        {sellerOptions.map((seller) => (
                                                            <option key={seller.id} value={seller.id}>
                                                                {seller.full_name || seller.email}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={() => assignSeller(r)}
                                                        disabled={assigningSellerId === r.id || !sellerAssignments[r.id]}
                                                        className="px-2 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold disabled:opacity-50"
                                                    >
                                                        {assigningSellerId === r.id ? '...' : 'Asignar'}
                                                    </button>
                                                </div>
                                            ) : (
                                                <span>-</span>
                                            )}
                                        </td>
                                        <td className="py-2 pr-2 min-w-[260px]">
                                            {canEditComment ? (
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={commentDrafts[r.id] ?? ''}
                                                            onChange={(ev) => setCommentDrafts(prev => ({ ...prev, [r.id]: ev.target.value }))}
                                                            placeholder="Cliente ya pagó / paga mañana / próxima semana..."
                                                            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-xs"
                                                        />
                                                        <button
                                                            onClick={() => saveSellerComment(r)}
                                                            disabled={savingCommentId === r.id}
                                                            className="px-2 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
                                                        >
                                                            {savingCommentId === r.id ? '...' : 'Guardar'}
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleProofUploadClick(r)}
                                                            disabled={proofUploadingId === r.id}
                                                            className="px-2 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                                                        >
                                                            <Paperclip size={12} />
                                                            {proofUploadingId === r.id ? 'Subiendo...' : 'Subir comprobante'}
                                                        </button>
                                                        <button
                                                            onClick={() => openCollectionProof(r)}
                                                            disabled={!r.payment_proof_path || proofOpeningId === r.id}
                                                            className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                                                        >
                                                            <Eye size={12} />
                                                            {proofOpeningId === r.id ? 'Abriendo...' : (r.payment_proof_path ? 'Ver comprobante' : 'Sin comprobante')}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    <span className="text-xs text-gray-600 block">{r.seller_comment || '-'}</span>
                                                    <button
                                                        onClick={() => openCollectionProof(r)}
                                                        disabled={!r.payment_proof_path || proofOpeningId === r.id}
                                                        className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                                                    >
                                                        <Eye size={12} />
                                                        {proofOpeningId === r.id ? 'Abriendo...' : (r.payment_proof_path ? 'Ver comprobante' : 'Sin comprobante')}
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {filteredRows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-500">Sin documentos en dataset activo.</td></tr>}
                            </tbody>
                        </table>
                        </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white border rounded-2xl p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                    <div>
                        <h3 className="font-black text-lg">Historial pagado</h3>
                        <p className="text-sm text-gray-500">
                            Documentos que desaparecieron del snapshot del ERP y quedaron marcados como pagados.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:w-auto">
                        <div className="p-3 rounded-xl bg-gray-50 border min-w-[140px]">
                            <p className="text-xs text-gray-500">Documentos pagados</p>
                            <p className="text-xl font-black">{paidTotals.docs}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-gray-50 border min-w-[160px]">
                            <p className="text-xs text-gray-500">Monto histórico</p>
                            <p className="text-xl font-black text-emerald-700">${paidTotals.amount.toLocaleString('es-CL')}</p>
                        </div>
                    </div>
                </div>

                <div className="md:hidden space-y-3 max-h-[420px] overflow-y-auto">
                    {filteredPaidRows.map((r) => (
                        <div key={r.id} className="border rounded-2xl p-4 space-y-3">
                            <div>
                                <p className="text-sm font-black text-gray-900">{r.client_name}</p>
                                <p className="text-xs text-gray-500">{r.client_rut || '-'}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Documento</p>
                                    <p className="font-semibold text-gray-800">{r.document_number}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Vencía</p>
                                    <p className="font-semibold text-gray-800">{formatShortDate(r.due_date)}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Pagado detectado</p>
                                    <p className="font-semibold text-gray-800">{formatShortDate(r.paid_detected_at)}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Vendedor</p>
                                    <p className="font-semibold text-gray-800">{r.seller_name || r.seller_email || '-'}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Monto c/IVA</p>
                                    <p className="font-black text-lg text-emerald-700">${Number(r.amount || 0).toLocaleString('es-CL')}</p>
                                </div>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold">Descargo</p>
                                <p className="mt-1 text-sm text-gray-700">{r.seller_comment || '-'}</p>
                                <button
                                    onClick={() => openCollectionProof(r)}
                                    disabled={!r.payment_proof_path || proofOpeningId === r.id}
                                    className="mt-2 w-full px-3 py-2 rounded-xl border border-gray-200 text-gray-700 text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <Eye size={14} />
                                    {proofOpeningId === r.id ? 'Abriendo...' : (r.payment_proof_path ? 'Ver comprobante' : 'Sin comprobante')}
                                </button>
                            </div>
                        </div>
                    ))}
                    {filteredPaidRows.length === 0 && <div className="py-6 text-center text-gray-500 text-sm">Sin historial pagado todavía.</div>}
                </div>

                <div className="hidden md:block -mx-4 overflow-x-auto md:mx-0">
                    <div className="min-w-[1080px] px-4 md:px-0">
                    <div className="overflow-y-auto max-h-[420px]">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left border-b">
                                <th className="py-2 pr-2">Razón social</th>
                                <th className="py-2 pr-2">RUT</th>
                                <th className="py-2 pr-2">N° documento</th>
                                <th className="py-2 pr-2">Vencía</th>
                                <th className="py-2 pr-2">Monto c/IVA</th>
                                <th className="py-2 pr-2">Vendedor</th>
                                <th className="py-2 pr-2">Pagado detectado</th>
                                <th className="py-2 pr-2">Descargo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPaidRows.map((r) => (
                                <tr key={r.id} className="border-b last:border-0 align-top">
                                    <td className="py-2 pr-2">{r.client_name}</td>
                                    <td className="py-2 pr-2">{r.client_rut || '-'}</td>
                                    <td className="py-2 pr-2">{r.document_number}</td>
                                    <td className="py-2 pr-2 whitespace-nowrap">{formatShortDate(r.due_date)}</td>
                                    <td className="py-2 pr-2 font-bold">${Number(r.amount || 0).toLocaleString('es-CL')}</td>
                                    <td className="py-2 pr-2 text-xs text-gray-600">{r.seller_name || r.seller_email || '-'}</td>
                                    <td className="py-2 pr-2 text-xs text-gray-600 whitespace-nowrap">{formatShortDate(r.paid_detected_at)}</td>
                                    <td className="py-2 pr-2 text-xs text-gray-600 min-w-[240px]">
                                        <div className="space-y-2">
                                            <span className="block">{r.seller_comment || '-'}</span>
                                            <button
                                                onClick={() => openCollectionProof(r)}
                                                disabled={!r.payment_proof_path || proofOpeningId === r.id}
                                                className="px-2 py-1.5 rounded-lg border border-gray-200 text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                                            >
                                                <Eye size={12} />
                                                {proofOpeningId === r.id ? 'Abriendo...' : (r.payment_proof_path ? 'Ver comprobante' : 'Sin comprobante')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredPaidRows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-500">Sin historial pagado todavía.</td></tr>}
                        </tbody>
                    </table>
                    </div>
                    </div>
                </div>
            </div>
        </div>

        {clientCreationContext && (
            <ClientFormModal
                isOpen={Boolean(clientCreationContext)}
                onClose={() => setClientCreationContext(null)}
                title="Crear cliente desde cobranza"
                persistenceKey="collections-create-client"
                initialData={{
                    name: clientCreationContext.row.client_name || '',
                    rut: clientCreationContext.row.client_rut || '',
                    phone: '',
                    email: '',
                    address: '',
                    office: '',
                    comuna: '',
                    notes: 'Creado desde módulo de cobranzas'
                }}
                onSave={handleCreateClientFromCollection}
            />
        )}
        <input
            ref={proofInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
            className="hidden"
            onChange={handleProofFileChange}
        />
        </>
    );
};

export default Collections;
