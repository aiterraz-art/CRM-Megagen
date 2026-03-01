import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { read, utils, writeFile } from 'xlsx';
import { Upload, Download, DollarSign } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

type CollectionUploadRow = {
    client_name: string;
    client_rut: string | null;
    document_number: string;
    due_date: string;
    amount: number;
    seller_email: string | null;
    seller_name: string | null;
};

type CollectionUploadRejected = {
    row_number: number;
    reason: string;
    client_name: string;
    client_rut: string;
    document_number: string;
    due_date: string;
    amount: string;
    seller_email: string;
    seller_name: string;
};

const normalizeHeader = (input: string) => {
    return (input || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_');
};

const toIsoDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const excelSerialToDate = (value: number) => {
    const utcDays = Math.floor(value - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate());
};

const parseDate = (value: any): string | null => {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate(value);

    if (typeof value === 'number' && Number.isFinite(value)) {
        const converted = excelSerialToDate(value);
        if (!Number.isNaN(converted.getTime())) return toIsoDate(converted);
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
        const dd = Number(dmy[1]);
        const mm = Number(dmy[2]);
        const yyyy = Number(dmy[3]);
        const date = new Date(yyyy, mm - 1, dd);
        if (!Number.isNaN(date.getTime())) return toIsoDate(date);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return toIsoDate(parsed);

    return null;
};

const parseNumber = (value: any): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value ?? '')
        .replace(/\$/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(/,/g, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
};

const getValueByAliases = (row: Record<string, any>, aliases: string[]) => {
    const aliasSet = new Set(aliases.map(normalizeHeader));
    for (const [key, val] of Object.entries(row)) {
        if (aliasSet.has(normalizeHeader(key))) return val;
    }
    return null;
};

const Collections = () => {
    const { profile, effectiveRole, hasPermission } = useUser();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    const [allRows, setAllRows] = useState<any[]>([]);
    const [allSummary, setAllSummary] = useState<any[]>([]);
    const [activeBatch, setActiveBatch] = useState<any>(null);
    const [rejectedRows, setRejectedRows] = useState<CollectionUploadRejected[]>([]);

    const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
    const [savingCommentId, setSavingCommentId] = useState<string | null>(null);

    const isSeller = effectiveRole === 'seller';
    const canManageCollections = hasPermission('MANAGE_COLLECTIONS');
    const canUpload = canManageCollections;
    const canDownloadTemplate = canManageCollections;
    const canEditComment = effectiveRole === 'seller' || canManageCollections;

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

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [rowsRes, summaryRes, batchRes] = await Promise.all([
                supabase.from('vw_collections_pending_current').select('*').order('due_date', { ascending: true }).limit(5000),
                supabase.from('vw_collections_seller_summary_current').select('*').limit(500),
                supabase.from('collections_import_batches').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
            ]);

            const firstError = rowsRes.error || summaryRes.error || batchRes.error;
            if (firstError) throw firstError;

            const loadedRows = rowsRes.data || [];
            setAllRows(loadedRows);
            setAllSummary(summaryRes.data || []);
            setActiveBatch(batchRes.data || null);

            const initialDrafts: Record<string, string> = {};
            loadedRows.forEach((row: any) => {
                initialDrafts[row.id] = row.seller_comment || '';
            });
            setCommentDrafts(initialDrafts);
        } catch (e: any) {
            setError(e?.message || 'Error cargando cobranzas');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const downloadTemplate = () => {
        if (!canDownloadTemplate) {
            alert('Solo jefes y administradores pueden descargar la plantilla.');
            return;
        }
        const headers = [
            'razon_social', 'rut', 'numero_documento', 'fecha_vencimiento', 'monto_con_iva',
            'seller_email', 'seller_name'
        ];
        const sample = {
            razon_social: 'Clinica Norte',
            rut: '76.123.456-7',
            numero_documento: 'FAC-100234',
            fecha_vencimiento: '2026-03-01',
            monto_con_iva: 1500000,
            seller_email: 'vendedor@empresa.cl',
            seller_name: 'Juan Perez'
        };

        const ws = utils.json_to_sheet([sample], { header: headers });
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'cobranzas');
        writeFile(wb, 'plantilla_cobranzas.xlsx');
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

    const parseRows = (rawRows: Record<string, any>[]): { valid: CollectionUploadRow[]; rejected: CollectionUploadRejected[] } => {
        const valid: CollectionUploadRow[] = [];
        const rejected: CollectionUploadRejected[] = [];

        rawRows.forEach((row, index) => {
            const sellerEmailRaw = getValueByAliases(row, ['seller_email', 'email_vendedor', 'vendedor_email', 'email']);
            const sellerNameRaw = getValueByAliases(row, ['seller_name', 'vendedor', 'seller']);
            const clientNameRaw = getValueByAliases(row, ['client_name', 'cliente', 'razon_social', 'nombre_cliente']);
            const clientRutRaw = getValueByAliases(row, ['client_rut', 'rut_cliente', 'rut']);
            const docNumberRaw = getValueByAliases(row, ['document_number', 'documento', 'folio', 'factura', 'numero_documento', 'nro_documento']);
            const dueDateRaw = getValueByAliases(row, ['due_date', 'fecha_vencimiento', 'vencimiento', 'fecha_vence']);
            const amountRaw = getValueByAliases(row, ['amount', 'monto_total', 'monto', 'total', 'monto_con_iva']);

            const clientName = String(clientNameRaw ?? '').trim();
            const documentNumber = String(docNumberRaw ?? '').trim();
            const dueDate = parseDate(dueDateRaw);
            const amount = parseNumber(amountRaw);

            const reasons: string[] = [];
            if (!clientName) reasons.push('razon_social vacío');
            if (!documentNumber) reasons.push('numero_documento vacío');
            if (!dueDate) reasons.push('fecha_vencimiento inválida');
            if (amount <= 0) reasons.push('monto_con_iva inválido');

            if (reasons.length > 0) {
                rejected.push({
                    row_number: index + 2,
                    reason: reasons.join('; '),
                    client_name: String(clientNameRaw ?? ''),
                    client_rut: String(clientRutRaw ?? ''),
                    document_number: String(docNumberRaw ?? ''),
                    due_date: String(dueDateRaw ?? ''),
                    amount: String(amountRaw ?? ''),
                    seller_email: String(sellerEmailRaw ?? ''),
                    seller_name: String(sellerNameRaw ?? '')
                });
                return;
            }

            valid.push({
                client_name: clientName,
                client_rut: clientRutRaw ? String(clientRutRaw).trim() : null,
                document_number: documentNumber,
                due_date: dueDate as string,
                amount,
                seller_email: sellerEmailRaw ? String(sellerEmailRaw).trim().toLowerCase() : null,
                seller_name: sellerNameRaw ? String(sellerNameRaw).trim() : null
            });
        });

        return { valid, rejected };
    };

    const uploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!canUpload) {
            alert('Solo jefes y administradores pueden cargar cobranzas.');
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
            const wb = read(buffer, { type: 'array', cellDates: true });
            const sheetName = wb.SheetNames[0];
            if (!sheetName) throw new Error('No se encontró hoja válida en el archivo.');

            const ws = wb.Sheets[sheetName];
            const importedRows = utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
            if (importedRows.length === 0) throw new Error('El archivo no contiene datos.');

            const parsed = parseRows(importedRows);
            if (parsed.valid.length === 0) {
                throw new Error('No se encontraron filas válidas. Verifica columnas obligatorias: razon_social, rut, numero_documento, fecha_vencimiento, monto_con_iva.');
            }
            setRejectedRows(parsed.rejected);

            const { data, error } = await supabase.rpc('replace_collections_pending', {
                p_file_name: file.name,
                p_uploaded_by: profile?.id || null,
                p_rows: parsed.valid
            } as any);

            if (error) throw error;

            const rejectedNotice = parsed.rejected.length > 0 ? ` Filas rechazadas: ${parsed.rejected.length}.` : '';
            alert(`Carga incremental completada. Se procesaron ${parsed.valid.length} filas.${rejectedNotice} Batch: ${String(data).slice(0, 8)}`);
            fetchData();
        } catch (err: any) {
            alert(`Error cargando cobranzas: ${err?.message || 'desconocido'}`);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const totals = useMemo(() => {
        const docs = rows.length;
        const outstanding = rows.reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        const overdue = rows.filter(row => Number(row.aging_days || 0) > 0).reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        return { docs, outstanding, overdue };
    }, [rows]);

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

    if (effectiveRole === 'driver') {
        return <div className="p-10 text-center font-bold">Acceso denegado</div>;
    }

    return (
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
                            Importación incremental por número de documento: no duplica folios existentes y preserva descargos.
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
                        Solo jefes y administradores pueden subir archivos. Tú puedes visualizar tus cobranzas asignadas y registrar descargos.
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

            <div className="grid lg:grid-cols-3 gap-4">
                <div className="bg-white border rounded-2xl p-4 lg:col-span-1">
                    <h3 className="font-black mb-3">Resumen por vendedor</h3>
                    <div className="space-y-2 max-h-[420px] overflow-auto">
                        {summary.map((s) => (
                            <div key={s.seller_key} className="p-3 rounded-xl border">
                                <p className="text-sm font-bold">{s.seller_name || s.seller_email || 'Sin vendedor'}</p>
                                <p className="text-xs text-gray-500">Docs: {Number(s.documents || 0)}</p>
                                <p className="text-xs text-gray-500">Pendiente: ${Number(s.outstanding_total || 0).toLocaleString('es-CL')}</p>
                                <p className="text-xs text-red-600">Vencido: ${Number(s.overdue_total || 0).toLocaleString('es-CL')}</p>
                            </div>
                        ))}
                        {summary.length === 0 && <p className="text-xs text-gray-500">Sin datos cargados.</p>}
                    </div>
                </div>

                <div className="bg-white border rounded-2xl p-4 lg:col-span-2">
                    <h3 className="font-black mb-3 inline-flex items-center gap-2"><DollarSign size={16} />Documentos</h3>
                    <div className="overflow-auto max-h-[520px]">
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
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-b last:border-0 align-top">
                                        <td className="py-2 pr-2">{r.client_name}</td>
                                        <td className="py-2 pr-2">{r.client_rut || '-'}</td>
                                        <td className="py-2 pr-2">{r.document_number}</td>
                                        <td className="py-2 pr-2">{r.due_date}</td>
                                        <td className="py-2 pr-2">{r.status}</td>
                                        <td className="py-2 pr-2 font-bold">${Number(r.amount || 0).toLocaleString('es-CL')}</td>
                                        <td className="py-2 pr-2 text-xs text-gray-600">{r.seller_name || r.seller_email || '-'}</td>
                                        <td className="py-2 pr-2 min-w-[260px]">
                                            {canEditComment ? (
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
                                            ) : (
                                                <span className="text-xs text-gray-600">{r.seller_comment || '-'}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-500">Sin documentos en dataset activo.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Collections;
