import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { utils, writeFile } from 'xlsx';
import { Upload, Download, DollarSign } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { CollectionUploadRejected, parseCollectionsImportFile } from '../utils/collectionsImport';

const Collections = () => {
    const { profile, effectiveRole, hasPermission } = useUser();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    const [allRows, setAllRows] = useState<any[]>([]);
    const [allPaidRows, setAllPaidRows] = useState<any[]>([]);
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

            const { error } = await supabase.rpc('replace_collections_pending', {
                p_file_name: file.name,
                p_uploaded_by: profile?.id || null,
                p_rows: parsed.valid
            } as any);

            if (error) throw error;

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
        const docs = rows.length;
        const outstanding = rows.reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        const overdue = rows.filter(row => Number(row.aging_days || 0) > 0).reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        return { docs, outstanding, overdue };
    }, [rows]);

    const paidTotals = useMemo(() => {
        const docs = paidRows.length;
        const amount = paidRows.reduce((acc, row) => acc + Number(row.amount || 0), 0);
        return { docs, amount };
    }, [paidRows]);

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

                <div className="overflow-auto max-h-[420px]">
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
                            {paidRows.map((r) => (
                                <tr key={r.id} className="border-b last:border-0 align-top">
                                    <td className="py-2 pr-2">{r.client_name}</td>
                                    <td className="py-2 pr-2">{r.client_rut || '-'}</td>
                                    <td className="py-2 pr-2">{r.document_number}</td>
                                    <td className="py-2 pr-2">{r.due_date}</td>
                                    <td className="py-2 pr-2 font-bold">${Number(r.amount || 0).toLocaleString('es-CL')}</td>
                                    <td className="py-2 pr-2 text-xs text-gray-600">{r.seller_name || r.seller_email || '-'}</td>
                                    <td className="py-2 pr-2 text-xs text-gray-600">{r.paid_detected_at ? new Date(r.paid_detected_at).toLocaleString('es-CL') : '-'}</td>
                                    <td className="py-2 pr-2 text-xs text-gray-600 min-w-[240px]">{r.seller_comment || '-'}</td>
                                </tr>
                            ))}
                            {paidRows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-500">Sin historial pagado todavía.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Collections;
