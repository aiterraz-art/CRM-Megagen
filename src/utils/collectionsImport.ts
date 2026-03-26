import { read, utils } from 'xlsx';

export type CollectionUploadRow = {
    seller_email: string | null;
    seller_name: string | null;
    client_name: string;
    client_rut: string | null;
    document_number: string;
    document_type: string;
    issue_date: string | null;
    due_date: string;
    amount: number;
    outstanding_amount: number;
    status: 'pending' | 'partial' | 'paid' | 'overdue' | 'disputed';
    notes: string | null;
};

export type CollectionUploadRejected = {
    row_number: number;
    reason: string;
    client_name: string;
    client_rut: string;
    document_number: string;
    due_date: string;
    amount: string;
    seller_email: string;
    seller_name: string;
    document_type: string;
    outstanding_amount: string;
    status: string;
};

export type CollectionsRpcRow = Array<string | number | null>;

export const normalizeHeader = (input: string) => {
    return (input || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_');
};

const toIsoDate = (d: Date) => {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const excelSerialToDate = (value: number) => {
    const utcDays = Math.floor(value - 25569);
    const utcValue = utcDays * 86400;
    const dateInfo = new Date(utcValue * 1000);
    return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate());
};

const parseYear = (value: string) => {
    const year = Number(value);
    if (value.length === 2) return 2000 + year;
    return year;
};

const buildDate = (year: number, month: number, day: number) => {
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return toIsoDate(date);
};

const parseDate = (value: unknown): string | null => {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return toIsoDate(value);

    if (typeof value === 'number' && Number.isFinite(value)) {
        const converted = excelSerialToDate(value);
        if (!Number.isNaN(converted.getTime())) return toIsoDate(converted);
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const slashDate = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (slashDate) {
        const first = Number(slashDate[1]);
        const second = Number(slashDate[2]);
        const year = parseYear(slashDate[3]);

        if (first > 12) {
            return buildDate(year, second, first);
        }
        if (second > 12) {
            return buildDate(year, first, second);
        }
        return buildDate(year, second, first);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return toIsoDate(parsed);

    return null;
};

const parseNumber = (value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value ?? '')
        .replace(/\$/g, '')
        .replace(/\s/g, '')
        .replace(/\./g, '')
        .replace(/,/g, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
};

const getValueByAliases = (row: Record<string, unknown>, aliases: string[]) => {
    const aliasSet = new Set(aliases.map(normalizeHeader));
    for (const [key, val] of Object.entries(row)) {
        if (aliasSet.has(normalizeHeader(key))) return val;
    }
    return null;
};

const ERP_HEADER_ALIASES = {
    client_rut: ['codigo_cliente', 'c_o_cliente', 'rut_cliente', 'rut'],
    client_name: ['nombre', 'razon_social', 'cliente'],
    document_type: ['docto', 'tipo_documento', 'document_type', 'tipo'],
    document_number: ['nmero', 'numero', 'numero_documento', 'n_documento'],
    due_date: ['vencimiento', 'fecha_vencimiento', 'fecha_vence', 'due_date'],
    bucket_gt_90: ['_90_', 'mayor_90'],
    bucket_61_90: ['_61_90_', '61_90'],
    bucket_31_60: ['_31_60_', '31_60'],
    bucket_0_30: ['_0_30_', '0_30'],
};

const findFirstColumn = (headerMap: Map<string, number>, aliases: string[]) => {
    for (const alias of aliases.map(normalizeHeader)) {
        if (headerMap.has(alias)) return headerMap.get(alias)!;
    }
    return -1;
};

const detectErpHeaderRowIndex = (rows: unknown[][]) => {
    return rows.findIndex((row) => {
        const normalized = row.map((cell) => normalizeHeader(String(cell ?? ''))).filter(Boolean);
        const set = new Set(normalized);
        const hasClient = ERP_HEADER_ALIASES.client_rut.some((alias) => set.has(normalizeHeader(alias)));
        const hasName = ERP_HEADER_ALIASES.client_name.some((alias) => set.has(normalizeHeader(alias)));
        const hasDocNumber = ERP_HEADER_ALIASES.document_number.some((alias) => set.has(normalizeHeader(alias)));
        const hasDueDate = ERP_HEADER_ALIASES.due_date.some((alias) => set.has(normalizeHeader(alias)));
        return hasClient && hasName && hasDocNumber && hasDueDate;
    });
};

const parseErpRows = (rows: unknown[][]) => {
    const valid: CollectionUploadRow[] = [];
    const rejected: CollectionUploadRejected[] = [];

    const headerRowIndex = detectErpHeaderRowIndex(rows);
    if (headerRowIndex < 0) return { valid, rejected, matched: false };

    const headers = rows[headerRowIndex].map((cell) => normalizeHeader(String(cell ?? '')));
    const headerMap = new Map<string, number>();
    headers.forEach((header, index) => {
        if (header && !headerMap.has(header)) headerMap.set(header, index);
    });

    const clientRutIndex = findFirstColumn(headerMap, ERP_HEADER_ALIASES.client_rut);
    const clientNameIndex = findFirstColumn(headerMap, ERP_HEADER_ALIASES.client_name);
    const documentTypeIndex = findFirstColumn(headerMap, ERP_HEADER_ALIASES.document_type);
    const documentNumberIndex = findFirstColumn(headerMap, ERP_HEADER_ALIASES.document_number);
    const dueDateIndex = findFirstColumn(headerMap, ERP_HEADER_ALIASES.due_date);
    const gt90Index = findFirstColumn(headerMap, ERP_HEADER_ALIASES.bucket_gt_90);
    const b6190Index = findFirstColumn(headerMap, ERP_HEADER_ALIASES.bucket_61_90);
    const b3160Index = findFirstColumn(headerMap, ERP_HEADER_ALIASES.bucket_31_60);
    const b030Index = findFirstColumn(headerMap, ERP_HEADER_ALIASES.bucket_0_30);

    for (let offset = headerRowIndex + 1; offset < rows.length; offset += 1) {
        const row = rows[offset];
        const excelRowNumber = offset + 1;
        const firstCell = String(row[0] ?? '').trim();
        const normalizedFirstCell = normalizeHeader(firstCell);

        if (!row.some((cell) => String(cell ?? '').trim() !== '')) continue;
        if (
            normalizedFirstCell === 'saldo_cliente'
            || normalizedFirstCell === 'saldo'
            || firstCell.toLowerCase().includes('saldo cliente')
        ) continue;

        const clientRutRaw = clientRutIndex >= 0 ? row[clientRutIndex] : '';
        const clientNameRaw = clientNameIndex >= 0 ? row[clientNameIndex] : '';
        const documentTypeRaw = documentTypeIndex >= 0 ? row[documentTypeIndex] : '';
        const documentNumberRaw = documentNumberIndex >= 0 ? row[documentNumberIndex] : '';
        const dueDateRaw = dueDateIndex >= 0 ? row[dueDateIndex] : '';

        const amount =
            parseNumber(gt90Index >= 0 ? row[gt90Index] : 0) +
            parseNumber(b6190Index >= 0 ? row[b6190Index] : 0) +
            parseNumber(b3160Index >= 0 ? row[b3160Index] : 0) +
            parseNumber(b030Index >= 0 ? row[b030Index] : 0);

        const clientName = String(clientNameRaw ?? '').trim();
        const documentNumber = String(documentNumberRaw ?? '').trim();
        const dueDate = parseDate(dueDateRaw);
        const reasons: string[] = [];

        if (!clientName) reasons.push('nombre vacío');
        if (!documentNumber) reasons.push('numero_documento vacío');
        if (!dueDate) reasons.push('fecha_vencimiento inválida');
        if (amount <= 0) reasons.push('monto inválido');

        if (reasons.length > 0) {
            rejected.push({
                row_number: excelRowNumber,
                reason: reasons.join('; '),
                client_name: String(clientNameRaw ?? ''),
                client_rut: String(clientRutRaw ?? ''),
                document_number: String(documentNumberRaw ?? ''),
                due_date: String(dueDateRaw ?? ''),
                amount: String(amount || ''),
                seller_email: '',
                seller_name: '',
                document_type: String(documentTypeRaw ?? ''),
                outstanding_amount: String(amount || ''),
                status: 'pending',
            });
            continue;
        }

        valid.push({
            seller_email: null,
            seller_name: null,
            client_name: clientName,
            client_rut: clientRutRaw ? String(clientRutRaw).trim() : null,
            document_number: documentNumber,
            document_type: documentTypeRaw ? String(documentTypeRaw).trim() : 'invoice',
            issue_date: null,
            due_date: dueDate as string,
            amount,
            outstanding_amount: amount,
            status: 'pending',
            notes: null,
        });
    }

    return { valid, rejected, matched: true };
};

const parseLegacyRows = (rawRows: Record<string, unknown>[]) => {
    const valid: CollectionUploadRow[] = [];
    const rejected: CollectionUploadRejected[] = [];

    rawRows.forEach((row, index) => {
        const sellerEmailRaw = getValueByAliases(row, ['seller_email', 'email_vendedor', 'vendedor_email', 'email']);
        const sellerNameRaw = getValueByAliases(row, ['seller_name', 'vendedor', 'seller']);
        const clientNameRaw = getValueByAliases(row, ['client_name', 'cliente', 'razon_social', 'nombre_cliente']);
        const clientRutRaw = getValueByAliases(row, ['client_rut', 'rut_cliente', 'rut']);
        const docNumberRaw = getValueByAliases(row, ['document_number', 'documento', 'folio', 'factura', 'numero_documento', 'nro_documento']);
        const docTypeRaw = getValueByAliases(row, ['document_type', 'tipo_documento', 'tipo', 'docto']);
        const issueDateRaw = getValueByAliases(row, ['issue_date', 'fecha_emision', 'emision']);
        const dueDateRaw = getValueByAliases(row, ['due_date', 'fecha_vencimiento', 'vencimiento', 'fecha_vence']);
        const amountRaw = getValueByAliases(row, ['amount', 'monto_total', 'monto', 'total', 'monto_con_iva']);
        const outstandingRaw = getValueByAliases(row, ['outstanding_amount', 'saldo_pendiente', 'saldo', 'pendiente']);
        const statusRaw = getValueByAliases(row, ['status', 'estado']);
        const notesRaw = getValueByAliases(row, ['notes', 'nota', 'observacion', 'observaciones']);

        const clientName = String(clientNameRaw ?? '').trim();
        const documentNumber = String(docNumberRaw ?? '').trim();
        const dueDate = parseDate(dueDateRaw);
        const amount = parseNumber(amountRaw);
        const outstanding = parseNumber(outstandingRaw);
        const statusNormalized = normalizeHeader(String(statusRaw ?? 'pending'));
        const statusValid = ['pending', 'partial', 'paid', 'overdue', 'disputed'].includes(statusNormalized);

        const reasons: string[] = [];
        if (!clientName) reasons.push('client_name vacío');
        if (!documentNumber) reasons.push('document_number vacío');
        if (!dueDate) reasons.push('due_date inválida');
        if (amount <= 0) reasons.push('amount inválido');
        if (outstanding < 0) reasons.push('outstanding_amount negativo');
        if (statusRaw != null && String(statusRaw).trim() !== '' && !statusValid) reasons.push('status inválido');

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
                seller_name: String(sellerNameRaw ?? ''),
                document_type: String(docTypeRaw ?? ''),
                outstanding_amount: String(outstandingRaw ?? ''),
                status: String(statusRaw ?? ''),
            });
            return;
        }

        const status: CollectionUploadRow['status'] =
            statusNormalized === 'partial' ? 'partial'
                : statusNormalized === 'paid' ? 'paid'
                    : statusNormalized === 'overdue' ? 'overdue'
                        : statusNormalized === 'disputed' ? 'disputed'
                            : 'pending';

        valid.push({
            seller_email: sellerEmailRaw ? String(sellerEmailRaw).trim().toLowerCase() : null,
            seller_name: sellerNameRaw ? String(sellerNameRaw).trim() : null,
            client_name: clientName,
            client_rut: clientRutRaw ? String(clientRutRaw).trim() : null,
            document_number: documentNumber,
            document_type: docTypeRaw ? String(docTypeRaw).trim() : 'invoice',
            issue_date: parseDate(issueDateRaw),
            due_date: dueDate as string,
            amount,
            outstanding_amount: outstanding > 0 ? outstanding : amount,
            status,
            notes: notesRaw ? String(notesRaw).trim() : null,
        });
    });

    return { valid, rejected };
};

export const parseCollectionsImportFile = (buffer: ArrayBuffer) => {
    const workbook = read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('No se encontró hoja válida en el archivo.');

    const worksheet = workbook.Sheets[sheetName];
    const matrix = utils.sheet_to_json<(string | number | Date)[]>(worksheet, { header: 1, raw: true, defval: '', blankrows: false });
    const erpResult = parseErpRows(matrix as unknown[][]);
    if (erpResult.matched) {
        return { ...erpResult, detectedFormat: 'erp' as const };
    }

    const rawRows = utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
    if (rawRows.length === 0) throw new Error('El archivo no contiene datos.');

    const legacyResult = parseLegacyRows(rawRows);
    return { ...legacyResult, detectedFormat: 'legacy' as const };
};

export const buildCollectionsRpcRows = (
    rows: CollectionUploadRow[],
    format: 'erp' | 'full' = 'full'
): CollectionsRpcRow[] => {
    if (format === 'erp') {
        return rows.map((row) => [
            row.client_name,
            row.client_rut,
            row.document_number,
            row.document_type,
            row.due_date,
            row.amount
        ]);
    }

    return rows.map((row) => [
        row.seller_email,
        row.seller_name,
        row.client_name,
        row.client_rut,
        row.document_number,
        row.document_type,
        row.issue_date,
        row.due_date,
        row.amount,
        row.outstanding_amount,
        row.status,
        row.notes
    ]);
};

export const uploadCollectionsSnapshot = async (
    supabase: any,
    params: {
        fileName: string;
        uploadedBy: string | null;
        rows: CollectionUploadRow[];
        format: 'erp' | 'full';
        chunkSize?: number;
    }
) => {
    const sessionId = crypto.randomUUID();
    const chunkSize = params.chunkSize ?? 100;
    const rpcRows = buildCollectionsRpcRows(params.rows, params.format);

    try {
        for (let i = 0; i < rpcRows.length; i += chunkSize) {
            const chunk = rpcRows.slice(i, i + chunkSize);
            const { error } = await supabase.rpc('stage_collections_pending_rows', {
                p_session_id: sessionId,
                p_rows: chunk
            } as any);
            if (error) throw error;
        }

        const { data, error } = await supabase.rpc('finalize_collections_pending_upload', {
            p_session_id: sessionId,
            p_file_name: params.fileName,
            p_uploaded_by: params.uploadedBy
        } as any);
        if (error) throw error;

        return data as string;
    } catch (error) {
        await supabase.rpc('discard_collections_pending_upload', {
            p_session_id: sessionId
        } as any).catch(() => undefined);
        throw error;
    }
};
