import { ChangeEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { read, utils, writeFile } from 'xlsx';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock3, DollarSign, ShieldCheck, Wrench, Upload, Download } from 'lucide-react';
import { formatPaymentTermsFromCreditDays, getClientCreditDays } from '../utils/credit';
import { getApprovalReason, getApprovalRequestedItems, readDiscountApprovalPayload } from '../utils/discountApproval';
import { buildQuotationPreviewData } from '../utils/quotationPreview';

type TabKey = 'health' | 'automations' | 'sla' | 'approvals' | 'postsale';

type CollectionUploadRow = {
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

type CollectionUploadRejected = {
    row_number: number;
    reason: string;
    seller_email: string;
    seller_name: string;
    client_name: string;
    document_number: string;
    due_date: string;
    amount: string;
    outstanding_amount: string;
    status: string;
};

type AutomationTemplate = {
    key: string;
    title: string;
    description: string;
    name: string;
    module: string;
    trigger_type: string;
};

type SlaTemplate = {
    key: string;
    title: string;
    description: string;
    name: string;
    module: string;
    metric: string;
    threshold_minutes: number;
};

const MODULE_OPTIONS = [
    { value: 'sales', label: 'Ventas' },
    { value: 'routes', label: 'Rutas' },
    { value: 'dispatch', label: 'Despacho' },
    { value: 'collections', label: 'Cobranzas' },
    { value: 'postsale', label: 'Postventa' }
];

const TRIGGER_OPTIONS = [
    { value: 'stale_activity', label: 'Sin actividad' },
    { value: 'missing_gps', label: 'Evento sin GPS' },
    { value: 'pending_approval', label: 'Aprobacion pendiente' },
    { value: 'overdue_task', label: 'Tarea vencida' },
    { value: 'manual_control', label: 'Control manual' }
];

const METRIC_OPTIONS = [
    { value: 'lead_response', label: 'Respuesta a lead' },
    { value: 'quotation_followup', label: 'Seguimiento de cotizacion' },
    { value: 'route_start', label: 'Inicio de ruta' },
    { value: 'ticket_resolution', label: 'Resolucion de ticket' },
    { value: 'collection_followup', label: 'Seguimiento de cobranza' }
];

const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
    {
        key: 'visit_stale_24h',
        title: 'Visita estancada 24h',
        description: 'Alerta cuando una visita no tiene movimiento durante 24 horas.',
        name: 'Alerta visita estancada 24h',
        module: 'sales',
        trigger_type: 'stale_activity'
    },
    {
        key: 'quotation_without_gps',
        title: 'Cotizacion sin GPS',
        description: 'Marca cotizaciones creadas sin ubicacion para control del equipo.',
        name: 'Control de cotizacion sin GPS',
        module: 'sales',
        trigger_type: 'missing_gps'
    },
    {
        key: 'approval_pending',
        title: 'Aprobacion pendiente',
        description: 'Notifica cuando una solicitud de aprobacion sigue pendiente.',
        name: 'Seguimiento de aprobaciones pendientes',
        module: 'postsale',
        trigger_type: 'pending_approval'
    }
];

const SLA_TEMPLATES: SlaTemplate[] = [
    {
        key: 'lead_120',
        title: 'Lead en 120 min',
        description: 'Tiempo maximo para primer contacto comercial.',
        name: 'Respuesta inicial de lead',
        module: 'sales',
        metric: 'lead_response',
        threshold_minutes: 120
    },
    {
        key: 'quotation_240',
        title: 'Seguimiento cotizacion 240 min',
        description: 'Control de seguimiento de cotizaciones abiertas.',
        name: 'Seguimiento de cotizacion',
        module: 'sales',
        metric: 'quotation_followup',
        threshold_minutes: 240
    },
    {
        key: 'collection_1440',
        title: 'Cobranza diaria',
        description: 'Requiere gestion diaria de documentos pendientes.',
        name: 'Seguimiento diario de cobranza',
        module: 'collections',
        metric: 'collection_followup',
        threshold_minutes: 1440
    }
];

const getLabel = (options: { value: string; label: string }[], value: string) => {
    return options.find((o) => o.value === value)?.label || 'Configuracion personalizada';
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

const QuotationTemplate = lazy(() => import('../components/QuotationTemplate'));

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

const formatApprovalDate = (value: string | null | undefined) => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toLocaleDateString('es-CL')
        : 'Sin fecha';
};

const formatApprovalTime = (value: string | null | undefined) => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime())
        ? parsed.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        : '--:--';
};

const resolveProfileName = (profile: any) => {
    if (!profile) return 'Vendedor no identificado';
    return profile.full_name || profile.email?.split('@')[0]?.toUpperCase() || profile.email || 'Vendedor no identificado';
};

const summarizeApprovalProducts = (items: any[]) => {
    if (!Array.isArray(items) || items.length === 0) return 'Sin detalle de productos';
    const labels = items
        .map((item) => String(item?.detail || item?.code || '').trim())
        .filter(Boolean);

    if (labels.length === 0) return 'Sin detalle de productos';
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} más`;
};

const OperationsCenter = () => {
    const { hasPermission, profile, effectiveRole } = useUser();
    const [activeTab, setActiveTab] = useState<TabKey>('health');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [health, setHealth] = useState<any>(null);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [timeline, setTimeline] = useState<any[]>([]);

    const [rules, setRules] = useState<any[]>([]);
    const [ruleDraft, setRuleDraft] = useState({ name: '', module: 'sales', trigger_type: 'stale_activity' });
    const [automationTemplateKey, setAutomationTemplateKey] = useState(AUTOMATION_TEMPLATES[0].key);

    const [slaPolicies, setSlaPolicies] = useState<any[]>([]);
    const [slaEvents, setSlaEvents] = useState<any[]>([]);
    const [slaDraft, setSlaDraft] = useState({ name: '', module: 'sales', metric: 'lead_response', threshold_minutes: 120 });
    const [slaTemplateKey, setSlaTemplateKey] = useState(SLA_TEMPLATES[0].key);

    const [approvals, setApprovals] = useState<any[]>([]);
    const [selectedApprovalPreview, setSelectedApprovalPreview] = useState<any | null>(null);
    const [tickets, setTickets] = useState<any[]>([]);
    const [commitments, setCommitments] = useState<any[]>([]);

    const [collectionsRows, setCollectionsRows] = useState<any[]>([]);
    const [collectionsSummary, setCollectionsSummary] = useState<any[]>([]);
    const [activeCollectionBatch, setActiveCollectionBatch] = useState<any>(null);
    const [collectionsRejectedRows, setCollectionsRejectedRows] = useState<CollectionUploadRejected[]>([]);
    const [uploadingCollections, setUploadingCollections] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [
                healthRes,
                alertsRes,
                timelineRes,
                rulesRes,
                slaRes,
                slaEventsRes,
                approvalsRes,
                ticketsRes,
                commitmentsRes,
                collectionsRes,
                collectionsSummaryRes,
                collectionsBatchRes
            ] = await Promise.all([
                supabase.from('vw_ops_health').select('*').limit(1).maybeSingle(),
                supabase.from('ops_alerts').select('*').order('created_at', { ascending: false }).limit(50),
                supabase.from('vw_crm_activity_timeline').select('*').order('happened_at', { ascending: false }).limit(50),
                supabase.from('automation_rules').select('*').order('created_at', { ascending: false }).limit(100),
                supabase.from('sla_policies').select('*').order('created_at', { ascending: false }).limit(100),
                supabase.from('sla_events').select('*').order('opened_at', { ascending: false }).limit(100),
                supabase.from('approval_requests').select('*').order('requested_at', { ascending: false }).limit(100),
                supabase.from('service_tickets').select('*').order('created_at', { ascending: false }).limit(100),
                supabase.from('payment_commitments').select('*').order('created_at', { ascending: false }).limit(100),
                supabase.from('vw_collections_pending_current').select('*').order('due_date', { ascending: true }).limit(500),
                supabase.from('vw_collections_seller_summary_current').select('*').limit(200),
                supabase.from('collections_import_batches').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
            ]);

            const firstError =
                healthRes.error || alertsRes.error || timelineRes.error || rulesRes.error || slaRes.error ||
                slaEventsRes.error || approvalsRes.error || ticketsRes.error || commitmentsRes.error ||
                collectionsRes.error || collectionsSummaryRes.error || collectionsBatchRes.error;

            if (firstError) throw firstError;

            const rawApprovals = approvalsRes.data || [];
            const quotationIds = Array.from(new Set(rawApprovals
                .filter((approval: any) => approval?.approval_type === 'extra_discount' && approval?.entity_id)
                .map((approval: any) => approval.entity_id)));

            const { data: quotationsData, error: quotationsError } = quotationIds.length > 0
                ? await supabase
                    .from('quotations')
                    .select(`
                        id,
                        folio,
                        seller_id,
                        total_amount,
                        payment_terms,
                        comments,
                        created_at,
                        items,
                        clients (id, name, rut, address, zone, purchase_contact, phone, email, giro, comuna, office, credit_days)
                    `)
                    .in('id', quotationIds)
                : { data: [], error: null };

            if (quotationsError) throw quotationsError;

            const requesterIds = rawApprovals.map((approval: any) => approval?.requester_id).filter(Boolean);
            const quotationSellerIds = (quotationsData || []).map((quotation: any) => quotation?.seller_id).filter(Boolean);
            const profileIds = Array.from(new Set([...requesterIds, ...quotationSellerIds]));

            const { data: profilesData, error: profilesError } = profileIds.length > 0
                ? await supabase
                    .from('profiles')
                    .select('id, email, full_name')
                    .in('id', profileIds)
                : { data: [], error: null };

            if (profilesError) throw profilesError;

            const profilesMap = Object.fromEntries((profilesData || []).map((profileRow: any) => [profileRow.id, profileRow]));
            const quotationsMap = Object.fromEntries((quotationsData || []).map((quotationRow: any) => [quotationRow.id, {
                ...quotationRow,
                client: Array.isArray(quotationRow.clients) ? quotationRow.clients[0] : quotationRow.clients,
                seller: profilesMap[quotationRow.seller_id] || null
            }]));

            const approvalsWithContext = rawApprovals.map((approval: any) => {
                const payload = readDiscountApprovalPayload(approval.payload);
                const quotation = quotationsMap[approval.entity_id] || null;
                const requesterProfile = profilesMap[approval.requester_id] || null;
                const requestedItems = getApprovalRequestedItems(approval, quotation);
                const sellerName = String(
                    payload.seller_name
                    || requesterProfile?.full_name
                    || requesterProfile?.email?.split('@')[0]?.toUpperCase()
                    || quotation?.seller?.full_name
                    || quotation?.seller?.email?.split('@')[0]?.toUpperCase()
                    || 'Vendedor no identificado'
                );

                return {
                    ...approval,
                    payloadData: payload,
                    quotation,
                    requesterProfile,
                    requestedItems,
                    requestReason: getApprovalReason(approval),
                    sellerName,
                    sellerEmail: String(payload.seller_email || requesterProfile?.email || quotation?.seller?.email || '').trim()
                };
            });

            setHealth(healthRes.data || null);
            setAlerts(alertsRes.data || []);
            setTimeline(timelineRes.data || []);
            setRules(rulesRes.data || []);
            setSlaPolicies(slaRes.data || []);
            setSlaEvents(slaEventsRes.data || []);
            setApprovals(approvalsWithContext);
            setTickets(ticketsRes.data || []);
            setCommitments(commitmentsRes.data || []);
            setCollectionsRows(collectionsRes.data || []);
            setCollectionsSummary(collectionsSummaryRes.data || []);
            setActiveCollectionBatch(collectionsBatchRes.data || null);
        } catch (e: any) {
            setError(e?.message || 'Error cargando Operaciones');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const createRule = async () => {
        if (!hasPermission('MANAGE_AUTOMATIONS')) return alert('Sin permisos para automatizaciones.');
        const template = AUTOMATION_TEMPLATES.find((item) => item.key === automationTemplateKey);
        if (!template) return alert('Selecciona una plantilla valida.');
        const name = ruleDraft.name.trim() || template.name;
        const { error } = await supabase.from('automation_rules').insert({
            name,
            module: template.module,
            trigger_type: template.trigger_type,
            condition_json: {},
            action_json: {}
        } as any);
        if (error) return alert(error.message);
        setRuleDraft({ ...ruleDraft, name: '' });
        fetchData();
    };

    const createSla = async () => {
        if (!hasPermission('MANAGE_SLA')) return alert('Sin permisos para objetivos de tiempo.');
        const template = SLA_TEMPLATES.find((item) => item.key === slaTemplateKey);
        if (!template) return alert('Selecciona una plantilla valida.');
        const name = slaDraft.name.trim() || template.name;
        const { error } = await supabase.from('sla_policies').insert({
            name,
            module: template.module,
            metric: template.metric,
            threshold_minutes: Number(slaDraft.threshold_minutes),
            severity: 'warning'
        } as any);
        if (error) return alert(error.message);
        setSlaDraft({ ...slaDraft, name: '', threshold_minutes: template.threshold_minutes });
        fetchData();
    };

    const resolveAlert = async (id: string) => {
        const { error } = await supabase.from('ops_alerts').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
        if (error) return alert(error.message);
        fetchData();
    };

    const toggleRuleStatus = async (id: string, isActive: boolean) => {
        if (!hasPermission('MANAGE_AUTOMATIONS')) return alert('Sin permisos para automatizaciones.');
        const { error } = await supabase.from('automation_rules').update({ is_active: !isActive }).eq('id', id);
        if (error) return alert(error.message);
        fetchData();
    };

    const applyAutomationTemplate = () => {
        const template = AUTOMATION_TEMPLATES.find((item) => item.key === automationTemplateKey);
        if (!template) return;
        setRuleDraft({
            name: template.name,
            module: template.module,
            trigger_type: template.trigger_type
        });
    };

    const applySlaTemplate = () => {
        const template = SLA_TEMPLATES.find((item) => item.key === slaTemplateKey);
        if (!template) return;
        setSlaDraft({
            name: template.name,
            module: template.module,
            metric: template.metric,
            threshold_minutes: template.threshold_minutes
        });
    };

    const resolveSlaEvent = async (id: string) => {
        const { error } = await supabase.from('sla_events').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
        if (error) return alert(error.message);
        fetchData();
    };

    const approveRequest = async (id: string, approve: boolean) => {
        if (!(effectiveRole === 'admin' || effectiveRole === 'jefe' || hasPermission('MANAGE_APPROVALS'))) return alert('Sin permisos para aprobaciones.');
        const request = approvals.find((a) => a.id === id);
        const payload = approve
            ? { status: 'approved', decided_at: new Date().toISOString(), approver_id: profile?.id || null, decision_note: 'Aprobado desde Centro de Operaciones' }
            : { status: 'rejected', decided_at: new Date().toISOString(), approver_id: profile?.id || null, decision_note: 'Rechazado desde Centro de Operaciones' };
        const { error } = await supabase.from('approval_requests').update(payload).eq('id', id);
        if (error) return alert(error.message);

        if (request?.approval_type === 'extra_discount' && request?.entity_id) {
            const { data: quotation } = await supabase.from('quotations').select('comments').eq('id', request.entity_id).maybeSingle();
            const stamp = new Date().toLocaleString();
            const note = approve
                ? `[Aprobado descuento adicional - ${stamp}]`
                : `[Rechazado descuento adicional - ${stamp}]`;
            const current = quotation?.comments ? `${quotation.comments}\n${note}` : note;
            await supabase.from('quotations').update({ comments: current }).eq('id', request.entity_id);
        }

        fetchData();
    };

    const openApprovalPreview = (approval: any) => {
        if (approval?.approval_type !== 'extra_discount') return;
        setSelectedApprovalPreview(approval);
    };

    const closeTicket = async (id: string) => {
        const { error } = await supabase.from('service_tickets').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id);
        if (error) return alert(error.message);
        fetchData();
    };

    const markCommitmentPaid = async (id: string) => {
        const today = new Date().toISOString().slice(0, 10);
        const { error } = await supabase.from('payment_commitments').update({ status: 'paid', paid_date: today }).eq('id', id);
        if (error) return alert(error.message);
        fetchData();
    };

    const downloadCollectionsTemplate = () => {
        const headers = [
            'seller_email', 'seller_name', 'client_name', 'client_rut', 'document_number', 'document_type',
            'issue_date', 'due_date', 'amount', 'outstanding_amount', 'status', 'notes'
        ];
        const sample = {
            seller_email: 'vendedor@empresa.cl',
            seller_name: 'Juan Perez',
            client_name: 'Clinica Norte',
            client_rut: '76.123.456-7',
            document_number: 'FAC-100234',
            document_type: 'invoice',
            issue_date: '2026-02-01',
            due_date: '2026-03-01',
            amount: 1500000,
            outstanding_amount: 450000,
            status: 'pending',
            notes: 'Compromiso de pago semana 1'
        };

        const ws = utils.json_to_sheet([sample], { header: headers });
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'cobranzas');
        writeFile(wb, 'plantilla_cobranzas.xlsx');
    };

    const downloadCurrentCollections = () => {
        const exportRows = collectionsRows.map((row) => ({
            seller_email: row.seller_email || '',
            seller_name: row.seller_name || '',
            client_name: row.client_name || '',
            client_rut: row.client_rut || '',
            document_number: row.document_number || '',
            document_type: row.document_type || '',
            issue_date: row.issue_date || '',
            due_date: row.due_date || '',
            amount: Number(row.amount || 0),
            outstanding_amount: Number(row.outstanding_amount || 0),
            status: row.status || '',
            notes: row.notes || '',
            aging_days: Number(row.aging_days || 0)
        }));
        const ws = utils.json_to_sheet(exportRows);
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'cobranzas_activas');
        writeFile(wb, 'cobranzas_activas.xlsx');
    };

    const downloadRejectedRows = () => {
        if (collectionsRejectedRows.length === 0) return;
        const ws = utils.json_to_sheet(collectionsRejectedRows);
        const wb = utils.book_new();
        utils.book_append_sheet(wb, ws, 'filas_rechazadas');
        writeFile(wb, 'cobranzas_filas_rechazadas.xlsx');
    };

    const parseCollectionsRows = (rows: Record<string, any>[]): { valid: CollectionUploadRow[]; rejected: CollectionUploadRejected[] } => {
        const valid: CollectionUploadRow[] = [];
        const rejected: CollectionUploadRejected[] = [];

        rows.forEach((row, index) => {
            const sellerEmailRaw = getValueByAliases(row, ['seller_email', 'email_vendedor', 'vendedor_email', 'email']);
            const sellerNameRaw = getValueByAliases(row, ['seller_name', 'vendedor', 'seller']);
            const clientNameRaw = getValueByAliases(row, ['client_name', 'cliente', 'razon_social', 'nombre_cliente']);
            const clientRutRaw = getValueByAliases(row, ['client_rut', 'rut_cliente', 'rut']);
            const docNumberRaw = getValueByAliases(row, ['document_number', 'documento', 'folio', 'factura', 'numero_documento', 'nro_documento']);
            const docTypeRaw = getValueByAliases(row, ['document_type', 'tipo_documento', 'tipo']);
            const issueDateRaw = getValueByAliases(row, ['issue_date', 'fecha_emision', 'emision']);
            const dueDateRaw = getValueByAliases(row, ['due_date', 'fecha_vencimiento', 'vencimiento', 'fecha_vence']);
            const amountRaw = getValueByAliases(row, ['amount', 'monto_total', 'monto', 'total']);
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
            if (amount < 0) reasons.push('amount negativo');
            if (outstanding < 0) reasons.push('outstanding_amount negativo');
            if (!statusValid) reasons.push('status inválido');

            if (reasons.length > 0) {
                rejected.push({
                    row_number: index + 2,
                    reason: reasons.join('; '),
                    seller_email: String(sellerEmailRaw ?? ''),
                    seller_name: String(sellerNameRaw ?? ''),
                    client_name: String(clientNameRaw ?? ''),
                    document_number: String(docNumberRaw ?? ''),
                    due_date: String(dueDateRaw ?? ''),
                    amount: String(amountRaw ?? ''),
                    outstanding_amount: String(outstandingRaw ?? ''),
                    status: String(statusRaw ?? '')
                });
                return;
            }

            const status: CollectionUploadRow['status'] =
                statusNormalized === 'partial' ? 'partial' :
                    statusNormalized === 'paid' ? 'paid' :
                        statusNormalized === 'overdue' ? 'overdue' : statusNormalized === 'disputed' ? 'disputed' : 'pending';

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
                notes: notesRaw ? String(notesRaw).trim() : null
            });
        });

        return { valid, rejected };
    };

    const uploadCollectionsFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!hasPermission('MANAGE_COLLECTIONS')) {
            alert('No tienes permiso para cargar cobranzas.');
            e.target.value = '';
            return;
        }

        setUploadingCollections(true);
        setCollectionsRejectedRows([]);
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
            const rows = utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
            if (rows.length === 0) throw new Error('El archivo no contiene datos.');

            const parsed = parseCollectionsRows(rows);
            if (parsed.valid.length === 0) {
                throw new Error('No se encontraron filas válidas. Verifica que el archivo tenga client_name, document_number y due_date.');
            }
            setCollectionsRejectedRows(parsed.rejected);

            const { data, error } = await supabase.rpc('replace_collections_pending', {
                p_file_name: file.name,
                p_uploaded_by: profile?.id || null,
                p_rows: parsed.valid
            } as any);

            if (error) throw error;

            const rejectedNotice = parsed.rejected.length > 0 ? ` Filas rechazadas: ${parsed.rejected.length}.` : '';
            alert(`Carga completada. Dataset reemplazado con ${parsed.valid.length} filas.${rejectedNotice} Batch: ${String(data).slice(0, 8)}`);
            fetchData();
        } catch (err: any) {
            alert(`Error cargando cobranzas: ${err?.message || 'desconocido'}`);
        } finally {
            setUploadingCollections(false);
            e.target.value = '';
        }
    };

    const collectionsTotals = useMemo(() => {
        const docs = collectionsRows.length;
        const outstanding = collectionsRows.reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        const overdue = collectionsRows.filter(row => Number(row.aging_days || 0) > 0).reduce((acc, row) => acc + Number(row.outstanding_amount || 0), 0);
        return { docs, outstanding, overdue };
    }, [collectionsRows]);

    const pendingApprovals = useMemo(
        () => approvals.filter((approval) => approval.status === 'pending'),
        [approvals]
    );

    const approvedQuotationApprovals = useMemo(
        () => approvals
            .filter((approval) => approval.approval_type === 'extra_discount' && approval.status === 'approved')
            .sort((a, b) => new Date(b.decided_at || b.requested_at || 0).getTime() - new Date(a.decided_at || a.requested_at || 0).getTime()),
        [approvals]
    );

    const otherApprovalHistory = useMemo(
        () => approvals
            .filter((approval) => approval.status !== 'pending' && !(approval.approval_type === 'extra_discount' && approval.status === 'approved'))
            .sort((a, b) => new Date(b.decided_at || b.requested_at || 0).getTime() - new Date(a.decided_at || a.requested_at || 0).getTime()),
        [approvals]
    );

    const renderApprovalCard = (approval: any, options?: { archived?: boolean }) => {
        const archived = Boolean(options?.archived);
        const isDiscountApproval = approval.approval_type === 'extra_discount';

        return (
            <div
                key={approval.id}
                onClick={() => openApprovalPreview(approval)}
                className={`p-4 rounded-xl border transition-all ${isDiscountApproval ? 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/40' : ''} ${archived ? 'bg-emerald-50/40 border-emerald-100' : 'bg-white'}`}
            >
                <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-sm">{approval.approval_type}</p>
                            <span className={`text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-wider ${approval.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : approval.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {approval.status}
                            </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{approval.module} · {formatApprovalDate(approval.requested_at)} · {formatApprovalTime(approval.requested_at)}</p>
                        {archived && (
                            <p className="mt-1 text-[11px] font-medium text-emerald-700">
                                Archivada el {formatApprovalDate(approval.decided_at)} a las {formatApprovalTime(approval.decided_at)}
                            </p>
                        )}
                        {isDiscountApproval && (
                            <div className="mt-3 text-xs text-gray-600 space-y-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <p><span className="font-bold">Vendedor:</span> {approval.sellerName}</p>
                                    <p><span className="font-bold">Cliente:</span> {approval.payloadData?.client_name || approval.quotation?.client?.name || 'N/A'}</p>
                                    <p><span className="font-bold">Folio:</span> {approval.payloadData?.folio || approval.quotation?.folio || 'N/A'}</p>
                                    <p><span className="font-bold">Monto:</span> {formatMoney(Number(approval.payloadData?.total_amount ?? approval.quotation?.total_amount ?? 0))}</p>
                                    <p className="md:col-span-2"><span className="font-bold">Descuento solicitado:</span> {Number(approval.payloadData?.max_discount_pct || 0).toFixed(2)}% (límite {Number(approval.payloadData?.limit_pct || 5).toFixed(2)}%)</p>
                                </div>
                                <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Motivo</p>
                                    <p className="mt-1 text-sm font-medium text-gray-700">{approval.requestReason || 'Sin razón registrada'}</p>
                                </div>
                                <div className="rounded-xl border border-gray-100 bg-white px-3 py-2">
                                    <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Productos afectados</p>
                                    <p className="mt-1 text-sm font-medium text-gray-700">{summarizeApprovalProducts(approval.requestedItems)}</p>
                                </div>
                                <p className="text-[11px] font-medium text-indigo-600">Pincha la tarjeta para ver la cotización en modo lectura.</p>
                            </div>
                        )}
                    </div>
                    {!archived && approval.status === 'pending' && (
                        <div className="flex gap-2">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    approveRequest(approval.id, true);
                                }}
                                className="text-xs px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700"
                            >
                                Aprobar
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    approveRequest(approval.id, false);
                                }}
                                className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700"
                            >
                                Rechazar
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    if (!(effectiveRole === 'admin' || effectiveRole === 'jefe')) {
        return <div className="p-10 text-center font-bold">Acceso denegado</div>;
    }

    return (
        <div className="space-y-6 pb-20">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-4xl font-black text-gray-900">Centro de Operaciones</h2>
                    <p className="text-gray-500 font-medium">Alertas automáticas, objetivos de tiempo, aprobaciones, postventa y salud operativa.</p>
                </div>
                <button onClick={fetchData} className="px-4 py-2 rounded-xl bg-slate-900 text-white font-bold">Actualizar</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white p-4 rounded-2xl border"><p className="text-xs text-gray-400">Visitas estancadas</p><p className="text-2xl font-black">{health?.stale_visits ?? 0}</p></div>
                <div className="bg-white p-4 rounded-2xl border"><p className="text-xs text-gray-400">Cotiz. sin GPS</p><p className="text-2xl font-black">{health?.quotations_without_location ?? 0}</p></div>
                <div className="bg-white p-4 rounded-2xl border"><p className="text-xs text-gray-400">Rutas sin pendientes</p><p className="text-2xl font-black">{health?.routes_without_pending ?? 0}</p></div>
                <div className="bg-white p-4 rounded-2xl border"><p className="text-xs text-gray-400">Tareas vencidas</p><p className="text-2xl font-black">{health?.overdue_tasks ?? 0}</p></div>
            </div>

            <div className="flex flex-wrap gap-2">
                <button onClick={() => setActiveTab('health')} className={`px-4 py-2 rounded-xl font-bold ${activeTab === 'health' ? 'bg-slate-900 text-white' : 'bg-white border'}`}><Activity size={14} className="inline mr-2" />Salud</button>
                <button onClick={() => setActiveTab('automations')} className={`px-4 py-2 rounded-xl font-bold ${activeTab === 'automations' ? 'bg-slate-900 text-white' : 'bg-white border'}`}><Bot size={14} className="inline mr-2" />Alertas automáticas</button>
                <button onClick={() => setActiveTab('sla')} className={`px-4 py-2 rounded-xl font-bold ${activeTab === 'sla' ? 'bg-slate-900 text-white' : 'bg-white border'}`}><Clock3 size={14} className="inline mr-2" />Objetivos de tiempo</button>
                <button onClick={() => setActiveTab('approvals')} className={`px-4 py-2 rounded-xl font-bold ${activeTab === 'approvals' ? 'bg-slate-900 text-white' : 'bg-white border'}`}><ShieldCheck size={14} className="inline mr-2" />Aprobaciones</button>
                <button onClick={() => setActiveTab('postsale')} className={`px-4 py-2 rounded-xl font-bold ${activeTab === 'postsale' ? 'bg-slate-900 text-white' : 'bg-white border'}`}><Wrench size={14} className="inline mr-2" />Postventa/Cobranza</button>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">{error}</div>}
            {loading && <div className="p-4 bg-gray-50 rounded-xl border">Cargando...</div>}

            {activeTab === 'health' && (
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-white border rounded-2xl p-4">
                        <h3 className="font-black mb-3">Alertas abiertas</h3>
                        <div className="space-y-2">
                            {alerts.filter(a => a.status === 'open').slice(0, 20).map(alert => (
                                <div key={alert.id} className="p-3 rounded-xl border bg-amber-50/40">
                                    <div className="flex justify-between gap-2">
                                        <div>
                                            <p className="text-sm font-black">{alert.title}</p>
                                            <p className="text-xs text-gray-600">{alert.message}</p>
                                        </div>
                                        <button onClick={() => resolveAlert(alert.id)} className="text-xs px-2 py-1 bg-white border rounded-lg">Resolver</button>
                                    </div>
                                </div>
                            ))}
                            {alerts.filter(a => a.status === 'open').length === 0 && <p className="text-sm text-gray-500">Sin alertas abiertas.</p>}
                        </div>
                    </div>
                    <div className="bg-white border rounded-2xl p-4">
                        <h3 className="font-black mb-3">Timeline unificado</h3>
                        <div className="space-y-2 max-h-[540px] overflow-auto">
                            {timeline.map(item => (
                                <div key={`${item.activity_type}-${item.activity_id}`} className="p-3 rounded-xl border">
                                    <div className="flex justify-between">
                                        <p className="text-xs font-black uppercase">{item.activity_type}</p>
                                        <p className="text-xs text-gray-500">{item.status}</p>
                                    </div>
                                    <p className="text-sm text-gray-700 line-clamp-2">{item.summary || '-'}</p>
                                    <p className="text-[11px] text-gray-400 mt-1">{new Date(item.happened_at).toLocaleString()}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'automations' && (
                <div className="space-y-4">
                    <div className="bg-white border rounded-2xl p-4">
                        <h3 className="font-black mb-3">Alertas automáticas sin configuración técnica</h3>
                        <div className="p-3 rounded-xl border bg-slate-50 mb-3">
                            <p className="text-xs text-gray-600 mb-2">1) Elige una plantilla</p>
                            <div className="grid md:grid-cols-3 gap-2">
                                <select
                                    value={automationTemplateKey}
                                    onChange={(e) => setAutomationTemplateKey(e.target.value)}
                                    className="px-3 py-2 rounded-xl border"
                                >
                                    {AUTOMATION_TEMPLATES.map((template) => (
                                        <option key={template.key} value={template.key}>
                                            {template.title}
                                        </option>
                                    ))}
                                </select>
                                <button onClick={applyAutomationTemplate} className="px-3 py-2 rounded-xl border font-bold">
                                    Usar plantilla
                                </button>
                                <div className="text-xs text-gray-500 flex items-center">
                                    {AUTOMATION_TEMPLATES.find((item) => item.key === automationTemplateKey)?.description}
                                </div>
                            </div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-2">
                            <input value={ruleDraft.name} onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })} placeholder="Nombre visible (opcional)" className="px-3 py-2 rounded-xl border" />
                            <button onClick={createRule} className="px-3 py-2 rounded-xl bg-slate-900 text-white font-bold">Guardar alerta automática</button>
                        </div>
                        <p className="text-xs text-gray-500 mt-3">
                            Resultado: se activa una alerta automática basada en la plantilla seleccionada.
                        </p>
                    </div>
                    <div className="bg-white border rounded-2xl p-4">
                        <h3 className="font-black mb-3">Alertas automáticas activas</h3>
                        <div className="space-y-2">
                            {rules.map(rule => (
                                <div key={rule.id} className="p-3 rounded-xl border flex items-center justify-between">
                                    <div>
                                        <p className="font-bold">{rule.name}</p>
                                        <p className="text-xs text-gray-500">{getLabel(MODULE_OPTIONS, rule.module)} · {getLabel(TRIGGER_OPTIONS, rule.trigger_type)}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs px-2 py-1 rounded-lg ${rule.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                            {rule.is_active ? 'Activa' : 'Inactiva'}
                                        </span>
                                        <button onClick={() => toggleRuleStatus(rule.id, !!rule.is_active)} className="text-xs px-2 py-1 rounded-lg border">
                                            {rule.is_active ? 'Desactivar' : 'Activar'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'sla' && (
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-white border rounded-2xl p-4 space-y-3">
                        <h3 className="font-black">Objetivos de tiempo sin configuración técnica</h3>
                        <div className="p-3 rounded-xl border bg-slate-50">
                            <p className="text-xs text-gray-600 mb-2">1) Elige una plantilla recomendada</p>
                            <div className="grid md:grid-cols-3 gap-2">
                                <select value={slaTemplateKey} onChange={(e) => setSlaTemplateKey(e.target.value)} className="px-3 py-2 rounded-xl border">
                                    {SLA_TEMPLATES.map((template) => (
                                        <option key={template.key} value={template.key}>{template.title}</option>
                                    ))}
                                </select>
                                <button onClick={applySlaTemplate} className="px-3 py-2 rounded-xl border font-bold">
                                    Usar plantilla
                                </button>
                                <div className="text-xs text-gray-500 flex items-center">
                                    {SLA_TEMPLATES.find((item) => item.key === slaTemplateKey)?.description}
                                </div>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <input value={slaDraft.name} onChange={(e) => setSlaDraft({ ...slaDraft, name: e.target.value })} placeholder="Nombre visible del objetivo (opcional)" className="px-3 py-2 rounded-xl border" />
                            <input type="number" value={slaDraft.threshold_minutes} onChange={(e) => setSlaDraft({ ...slaDraft, threshold_minutes: Number(e.target.value) })} placeholder="Minutos" className="px-3 py-2 rounded-xl border" />
                            <div className="flex gap-2 flex-wrap">
                                {[60, 120, 240, 480, 1440].map((minutes) => (
                                    <button key={minutes} onClick={() => setSlaDraft({ ...slaDraft, threshold_minutes: minutes })} className="text-xs px-2 py-1 rounded-lg border bg-white">
                                        {minutes} min
                                    </button>
                                ))}
                            </div>
                            <button onClick={createSla} className="px-3 py-2 rounded-xl bg-slate-900 text-white font-bold">Guardar objetivo de tiempo</button>
                        </div>
                        <p className="text-xs text-gray-500">
                            Resultado: se aplica el tiempo objetivo configurado a la plantilla seleccionada.
                        </p>
                        <div className="space-y-2">
                            {slaPolicies.map(p => (
                                <div key={p.id} className="p-3 rounded-xl border">
                                    <p className="font-bold">{p.name}</p>
                                    <p className="text-xs text-gray-500">{getLabel(MODULE_OPTIONS, p.module)} · {getLabel(METRIC_OPTIONS, p.metric)} · {p.threshold_minutes} min</p>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="bg-white border rounded-2xl p-4">
                        <h3 className="font-black mb-3">Alertas por tiempo fuera de objetivo</h3>
                        <div className="space-y-2 max-h-[560px] overflow-auto">
                            {slaEvents.map(e => (
                                <div key={e.id} className="p-3 rounded-xl border">
                                    <div className="flex justify-between">
                                        <p className="font-bold text-sm">{getLabel(MODULE_OPTIONS, e.module)}</p>
                                        <span className={`text-xs px-2 py-1 rounded-lg ${e.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{e.status}</span>
                                    </div>
                                    <p className="text-xs text-gray-600">{e.message}</p>
                                    {e.status !== 'resolved' && <button onClick={() => resolveSlaEvent(e.id)} className="mt-2 text-xs px-2 py-1 bg-white border rounded-lg">Resolver</button>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'approvals' && (
                <div className="space-y-4">
                    <div className="bg-white border rounded-2xl p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <h3 className="font-black">Solicitudes pendientes</h3>
                                <p className="text-xs text-gray-500">Requieren acción inmediata del equipo.</p>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-black uppercase tracking-wider">
                                {pendingApprovals.length}
                            </span>
                        </div>
                        <div className="space-y-2">
                            {pendingApprovals.map((approval) => renderApprovalCard(approval))}
                            {pendingApprovals.length === 0 && <p className="text-sm text-gray-500">No hay solicitudes pendientes.</p>}
                        </div>
                    </div>

                    <div className="bg-white border rounded-2xl p-4">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <h3 className="font-black">Cotizaciones aprobadas</h3>
                                <p className="text-xs text-gray-500">Archivo de descuentos aprobados con acceso a la cotización en solo lectura.</p>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-black uppercase tracking-wider">
                                {approvedQuotationApprovals.length}
                            </span>
                        </div>
                        <div className="space-y-2">
                            {approvedQuotationApprovals.map((approval) => renderApprovalCard(approval, { archived: true }))}
                            {approvedQuotationApprovals.length === 0 && <p className="text-sm text-gray-500">Aún no hay cotizaciones aprobadas archivadas.</p>}
                        </div>
                    </div>

                    {otherApprovalHistory.length > 0 && (
                        <div className="bg-white border rounded-2xl p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div>
                                    <h3 className="font-black">Historial resuelto</h3>
                                    <p className="text-xs text-gray-500">Solicitudes rechazadas u otras resoluciones del módulo.</p>
                                </div>
                                <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-black uppercase tracking-wider">
                                    {otherApprovalHistory.length}
                                </span>
                            </div>
                            <div className="space-y-2">
                                {otherApprovalHistory.map((approval) => renderApprovalCard(approval))}
                            </div>
                        </div>
                    )}
                    {approvals.length === 0 && (
                        <div className="bg-white border rounded-2xl p-4">
                            <p className="text-sm text-gray-500">No hay solicitudes.</p>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'postsale' && (
                <div className="space-y-4">
                    <div className="bg-white border rounded-2xl p-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <h3 className="font-black text-lg">Cobranzas Pendientes (carga masiva)</h3>
                                <p className="text-xs text-gray-500">Sube CSV/XLSX. Cada carga reemplaza el dataset anterior. Solo se considera el Excel cargado; pedidos del CRM no suman cobranza.</p>
                                {activeCollectionBatch && (
                                    <p className="text-xs text-gray-400 mt-1">
                                        Batch activo: {activeCollectionBatch.file_name} · {activeCollectionBatch.row_count} filas · {new Date(activeCollectionBatch.created_at).toLocaleString()}
                                    </p>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={downloadCollectionsTemplate} className="px-3 py-2 rounded-xl border font-bold text-sm inline-flex items-center gap-2">
                                    <Download size={14} /> Descargar formato
                                </button>
                                <button onClick={downloadCurrentCollections} className="px-3 py-2 rounded-xl border font-bold text-sm inline-flex items-center gap-2">
                                    <Download size={14} /> Exportar dataset activo
                                </button>
                                {collectionsRejectedRows.length > 0 && (
                                    <button onClick={downloadRejectedRows} className="px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 font-bold text-sm inline-flex items-center gap-2 text-amber-800">
                                        <Download size={14} /> Exportar rechazadas ({collectionsRejectedRows.length})
                                    </button>
                                )}
                                <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={uploadCollectionsFile} />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploadingCollections || !hasPermission('MANAGE_COLLECTIONS')}
                                    className={`px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2 ${uploadingCollections || !hasPermission('MANAGE_COLLECTIONS') ? 'bg-gray-200 text-gray-500' : 'bg-slate-900 text-white'}`}
                                >
                                    <Upload size={14} /> {uploadingCollections ? 'Cargando...' : 'Subir archivo'}
                                </button>
                            </div>
                        </div>
                        {collectionsRejectedRows.length > 0 && (
                            <div className="mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs">
                                {collectionsRejectedRows.length} fila(s) fueron rechazadas por validación estricta. Puedes descargar el detalle en &quot;Exportar rechazadas&quot;.
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                            <div className="p-3 rounded-xl bg-gray-50 border"><p className="text-xs text-gray-500">Documentos</p><p className="text-xl font-black">{collectionsTotals.docs}</p></div>
                            <div className="p-3 rounded-xl bg-gray-50 border"><p className="text-xs text-gray-500">Saldo total</p><p className="text-xl font-black">${collectionsTotals.outstanding.toLocaleString('es-CL')}</p></div>
                            <div className="p-3 rounded-xl bg-gray-50 border"><p className="text-xs text-gray-500">Saldo vencido</p><p className="text-xl font-black text-red-600">${collectionsTotals.overdue.toLocaleString('es-CL')}</p></div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-4 mt-4">
                            <div className="border rounded-xl p-3">
                                <h4 className="font-black text-sm mb-2">Resumen por vendedor</h4>
                                <div className="max-h-64 overflow-auto space-y-2">
                                    {collectionsSummary.map((s) => (
                                        <div key={s.seller_key} className="p-2 rounded-lg border">
                                            <p className="text-xs font-bold">{s.seller_name || s.seller_email || 'Sin vendedor'}</p>
                                            <p className="text-[11px] text-gray-500">Docs: {s.documents} · Saldo: ${Number(s.outstanding_total || 0).toLocaleString('es-CL')} · Vencido: ${Number(s.overdue_total || 0).toLocaleString('es-CL')}</p>
                                        </div>
                                    ))}
                                    {collectionsSummary.length === 0 && <p className="text-xs text-gray-500">Sin datos cargados.</p>}
                                </div>
                            </div>
                            <div className="border rounded-xl p-3">
                                <h4 className="font-black text-sm mb-2">Documentos (máx 500)</h4>
                                <div className="max-h-64 overflow-auto space-y-2">
                                    {collectionsRows.map((r) => (
                                        <div key={r.id} className="p-2 rounded-lg border">
                                            <div className="flex justify-between gap-2">
                                                <p className="text-xs font-bold">{r.document_number} · {r.client_name}</p>
                                                <span className={`text-[10px] px-2 py-0.5 rounded ${Number(r.aging_days || 0) > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{Number(r.aging_days || 0) > 0 ? `${r.aging_days}d vencido` : 'al día'}</span>
                                            </div>
                                            <p className="text-[11px] text-gray-500">Vendedor: {r.seller_name || r.seller_email || '-'} · Vence: {r.due_date} · Saldo: ${Number(r.outstanding_amount || 0).toLocaleString('es-CL')}</p>
                                        </div>
                                    ))}
                                    {collectionsRows.length === 0 && <p className="text-xs text-gray-500">Sin documentos en dataset activo.</p>}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-white border rounded-2xl p-4">
                            <h3 className="font-black mb-3 flex items-center gap-2"><AlertTriangle size={16} /> Tickets postventa</h3>
                            <div className="space-y-2">
                                {tickets.map(t => (
                                    <div key={t.id} className="p-3 rounded-xl border">
                                        <div className="flex justify-between">
                                            <p className="font-bold text-sm">{t.title}</p>
                                            <span className="text-xs text-gray-500">{t.status}</span>
                                        </div>
                                        <p className="text-xs text-gray-500">{t.priority}</p>
                                        {t.status !== 'resolved' && t.status !== 'closed' && (
                                            <button onClick={() => closeTicket(t.id)} className="mt-2 text-xs px-2 py-1 rounded-lg border">Marcar resuelto</button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-white border rounded-2xl p-4">
                            <h3 className="font-black mb-3 flex items-center gap-2"><DollarSign size={16} /> Compromisos de pago</h3>
                            <div className="space-y-2">
                                {commitments.map(c => (
                                    <div key={c.id} className="p-3 rounded-xl border">
                                        <div className="flex justify-between">
                                            <p className="font-bold text-sm">${Number(c.amount || 0).toLocaleString('es-CL')}</p>
                                            <span className={`text-xs ${c.status === 'paid' ? 'text-emerald-600' : c.status === 'overdue' ? 'text-red-600' : 'text-amber-600'}`}>{c.status}</span>
                                        </div>
                                        <p className="text-xs text-gray-500">Compromiso: {c.commitment_date}</p>
                                        {c.status !== 'paid' && <button onClick={() => markCommitmentPaid(c.id)} className="mt-2 text-xs px-2 py-1 rounded-lg border">Marcar pagado</button>}
                                    </div>
                                ))}
                                {commitments.length === 0 && <p className="text-sm text-gray-500">No hay compromisos.</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {selectedApprovalPreview && (
                <Suspense fallback={<div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm" />}>
                    {selectedApprovalPreview.quotation ? (
                        <QuotationTemplate
                            data={buildQuotationPreviewData(
                                selectedApprovalPreview.quotation,
                                formatPaymentTermsFromCreditDays(getClientCreditDays(selectedApprovalPreview.quotation.client))
                            )}
                            readOnly
                            onClose={() => setSelectedApprovalPreview(null)}
                        />
                    ) : (
                        <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                            <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden">
                                <div className="px-6 py-5 bg-gradient-to-br from-slate-800 to-slate-900 text-white">
                                    <h3 className="text-lg font-black">Detalle de aprobación</h3>
                                    <p className="text-white/70 text-sm">No se pudo cargar la cotización asociada.</p>
                                </div>
                                <div className="p-6 space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                                        <p><span className="font-bold">Fecha:</span> {formatApprovalDate(selectedApprovalPreview.requested_at)}</p>
                                        <p><span className="font-bold">Hora:</span> {formatApprovalTime(selectedApprovalPreview.requested_at)}</p>
                                        <p><span className="font-bold">Vendedor:</span> {selectedApprovalPreview.sellerName}</p>
                                        <p><span className="font-bold">Cliente:</span> {selectedApprovalPreview.payloadData?.client_name || 'N/A'}</p>
                                        <p><span className="font-bold">Folio:</span> {selectedApprovalPreview.payloadData?.folio || 'N/A'}</p>
                                        <p><span className="font-bold">Monto:</span> {formatMoney(Number(selectedApprovalPreview.payloadData?.total_amount || 0))}</p>
                                    </div>
                                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                                        <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Motivo del sobre descuento</p>
                                        <p className="mt-2 text-sm font-medium text-gray-700">{selectedApprovalPreview.requestReason || 'Sin razón registrada'}</p>
                                    </div>
                                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                                        <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Productos afectados</p>
                                        <div className="mt-2 space-y-2">
                                            {selectedApprovalPreview.requestedItems.length > 0 ? selectedApprovalPreview.requestedItems.map((item: any, index: number) => (
                                                <div key={`${item.code}-${index}`} className="rounded-xl bg-white border border-gray-100 px-3 py-2">
                                                    <p className="text-sm font-bold text-gray-800">{item.detail || item.code || 'Producto'}</p>
                                                    <p className="text-xs text-gray-500">
                                                        SKU: {item.code || '-'} · Cantidad: {item.qty} · Desc: {Number(item.discount_pct || 0).toFixed(2)}%
                                                    </p>
                                                </div>
                                            )) : (
                                                <p className="text-sm text-gray-500">Sin detalle de productos.</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex justify-end">
                                        <button
                                            onClick={() => setSelectedApprovalPreview(null)}
                                            className="px-5 py-3 rounded-2xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all"
                                        >
                                            Cerrar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </Suspense>
            )}

            <div className="flex items-center gap-2 text-xs text-gray-500">
                <CheckCircle2 size={14} /> Operaciones conectado con módulo transversal enterprise.
            </div>
        </div>
    );
};

export default OperationsCenter;
