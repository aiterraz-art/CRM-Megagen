import { supabase } from '../services/supabase';

export type CollectionInvoiceSummary = {
    id: string;
    client_name: string;
    client_rut: string;
    document_number: string;
    due_date: string | null;
    issue_date: string | null;
    amount: number;
    outstanding_amount: number;
    status: string | null;
    aging_days: number;
    seller_id: string | null;
    seller_name: string | null;
    seller_email: string | null;
    seller_comment: string | null;
    payment_proof_path: string | null;
};

export type CollectionsDebtSnapshot = {
    normalized_rut: string;
    documents: number;
    outstanding_total: number;
    overdue_documents: number;
    overdue_total: number;
    max_aging_days: number;
    latest_due_date: string | null;
    oldest_overdue_due_date: string | null;
    oldest_overdue_document_number: string | null;
    invoices: CollectionInvoiceSummary[];
};

export type CollectionsCrmOrderSummary = {
    id: string;
    folio: number | null;
    status: string | null;
    delivery_status: string | null;
    total_amount: number;
    created_at: string | null;
    seller_name: string | null;
};

export type CollectionsCrmQuotationSummary = {
    id: string;
    folio: number | null;
    status: string | null;
    total_amount: number;
    created_at: string | null;
    seller_name: string | null;
    has_order: boolean;
};

export type CollectionsCrmCommercialSnapshot = {
    crm_client: {
        id: string;
        name: string;
        rut: string | null;
        email: string | null;
        phone: string | null;
        address: string | null;
        comuna: string | null;
    } | null;
    orders: CollectionsCrmOrderSummary[];
    quotations: CollectionsCrmQuotationSummary[];
    last_visit_at: string | null;
    last_order_at: string | null;
    last_quotation_at: string | null;
    total_orders: number;
    total_quotations: number;
};

export const normalizeCollectionsRut = (value: string | null | undefined) =>
    String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^0-9kK]/g, '')
        .toUpperCase();

export const buildCollectionsRutVariants = (rut: string | null | undefined) => {
    const normalized = normalizeCollectionsRut(rut);
    if (!normalized) return [];

    const dv = normalized.slice(-1);
    const body = normalized.slice(0, -1);
    const withHyphen = body ? `${body}-${dv}` : normalized;

    return Array.from(new Set([
        normalized,
        withHyphen,
        withHyphen.replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
    ].filter(Boolean)));
};

const toComparableTime = (value: string | null | undefined) => {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

export const buildCollectionsDebtSnapshotFromRows = (rows: any[]): CollectionsDebtSnapshot => {
    const invoices: CollectionInvoiceSummary[] = [...(rows || [])]
        .filter(Boolean)
        .map((row: any) => ({
            id: row.id,
            client_name: row.client_name || 'Sin cliente',
            client_rut: row.client_rut || '',
            document_number: row.document_number || '',
            due_date: row.due_date || null,
            issue_date: row.issue_date || null,
            amount: Number(row.amount || 0),
            outstanding_amount: Number(row.outstanding_amount || row.amount || 0),
            status: row.status || null,
            aging_days: Number(row.aging_days || 0),
            seller_id: row.seller_id || null,
            seller_name: row.seller_name || null,
            seller_email: row.seller_email || null,
            seller_comment: row.seller_comment || null,
            payment_proof_path: row.payment_proof_path || null,
        }))
        .sort((left, right) => toComparableTime(left.due_date) - toComparableTime(right.due_date));

    const overdueInvoices = invoices.filter((invoice) => invoice.aging_days > 0);

    return {
        normalized_rut: normalizeCollectionsRut(invoices[0]?.client_rut || rows?.[0]?.client_rut || ''),
        documents: invoices.length,
        outstanding_total: invoices.reduce((total, invoice) => total + invoice.outstanding_amount, 0),
        overdue_documents: overdueInvoices.length,
        overdue_total: overdueInvoices.reduce((total, invoice) => total + invoice.outstanding_amount, 0),
        max_aging_days: overdueInvoices.reduce((max, invoice) => Math.max(max, invoice.aging_days), 0),
        latest_due_date: invoices.reduce<string | null>((latest, invoice) => (
            toComparableTime(invoice.due_date) > toComparableTime(latest) ? invoice.due_date : latest
        ), null),
        oldest_overdue_due_date: overdueInvoices[0]?.due_date || null,
        oldest_overdue_document_number: overdueInvoices[0]?.document_number || null,
        invoices,
    };
};

export const fetchCollectionsDebtSnapshotByRut = async (rut: string | null | undefined) => {
    const variants = buildCollectionsRutVariants(rut);
    const normalizedRut = normalizeCollectionsRut(rut);

    if (!variants.length || !normalizedRut) {
        return buildCollectionsDebtSnapshotFromRows([]);
    }

    const { data, error } = await supabase
        .from('vw_collections_pending_current')
        .select('*')
        .in('client_rut', variants)
        .order('due_date', { ascending: true });

    if (error) throw error;

    const matchedRows = (data || []).filter((row: any) =>
        normalizeCollectionsRut(row.client_rut) === normalizedRut
    );

    return buildCollectionsDebtSnapshotFromRows(matchedRows);
};

export const fetchCollectionsCrmCommercialSnapshotByRut = async (rut: string | null | undefined): Promise<CollectionsCrmCommercialSnapshot> => {
    const variants = buildCollectionsRutVariants(rut);
    const normalizedRut = normalizeCollectionsRut(rut);

    if (!variants.length || !normalizedRut) {
        return {
            crm_client: null,
            orders: [],
            quotations: [],
            last_visit_at: null,
            last_order_at: null,
            last_quotation_at: null,
            total_orders: 0,
            total_quotations: 0,
        };
    }

    const { data: clientRows, error: clientError } = await supabase
        .from('clients')
        .select('id, name, rut, email, phone, address, comuna')
        .in('rut', variants);

    if (clientError) throw clientError;

    const crmClient = (clientRows || []).find((client: any) => normalizeCollectionsRut(client.rut) === normalizedRut) || null;

    if (!crmClient) {
        return {
            crm_client: null,
            orders: [],
            quotations: [],
            last_visit_at: null,
            last_order_at: null,
            last_quotation_at: null,
            total_orders: 0,
            total_quotations: 0,
        };
    }

    const [orderRows, quotationRows, visitRow, ordersCountResponse, quotationsCountResponse] = await Promise.all([
        supabase
            .from('orders')
            .select('id, folio, status, delivery_status, total_amount, created_at, user_id')
            .eq('client_id', crmClient.id)
            .order('created_at', { ascending: false })
            .limit(10),
        supabase
            .from('quotations')
            .select('id, folio, status, total_amount, created_at, seller_id')
            .eq('client_id', crmClient.id)
            .order('created_at', { ascending: false })
            .limit(10),
        supabase
            .from('visits')
            .select('check_in_time')
            .eq('client_id', crmClient.id)
            .eq('status', 'completed')
            .order('check_in_time', { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('client_id', crmClient.id),
        supabase.from('quotations').select('id', { count: 'exact', head: true }).eq('client_id', crmClient.id),
    ]);

    if (orderRows.error) throw orderRows.error;
    if (quotationRows.error) throw quotationRows.error;
    if (visitRow.error) throw visitRow.error;
    if (ordersCountResponse.error) throw ordersCountResponse.error;
    if (quotationsCountResponse.error) throw quotationsCountResponse.error;

    const ordersData = orderRows.data || [];
    const quotationsData = quotationRows.data || [];
    const sellerIds = Array.from(new Set([
        ...ordersData.map((order: any) => order.user_id).filter(Boolean),
        ...quotationsData.map((quotation: any) => quotation.seller_id).filter(Boolean),
    ]));

    const profilesMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (sellerIds.length > 0) {
        const { data: profileRows, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', sellerIds);
        if (profileError) throw profileError;
        (profileRows || []).forEach((profile: any) => {
            profilesMap.set(profile.id, {
                full_name: profile.full_name || null,
                email: profile.email || null,
            });
        });
    }

    const quotationIds = quotationsData.map((quotation: any) => quotation.id).filter(Boolean);
    const convertedQuotationIds = new Set<string>();
    if (quotationIds.length > 0) {
        const { data: linkedOrders, error: linkedOrdersError } = await supabase
            .from('orders')
            .select('quotation_id')
            .in('quotation_id', quotationIds);
        if (linkedOrdersError) throw linkedOrdersError;
        (linkedOrders || []).forEach((row: any) => {
            if (row.quotation_id) convertedQuotationIds.add(row.quotation_id);
        });
    }

    return {
        crm_client: crmClient,
        orders: ordersData.map((order: any) => ({
            id: order.id,
            folio: order.folio ?? null,
            status: order.status ?? null,
            delivery_status: order.delivery_status ?? null,
            total_amount: Number(order.total_amount || 0),
            created_at: order.created_at ?? null,
            seller_name: profilesMap.get(order.user_id || '')?.full_name || profilesMap.get(order.user_id || '')?.email || null,
        })),
        quotations: quotationsData.map((quotation: any) => ({
            id: quotation.id,
            folio: quotation.folio ?? null,
            status: quotation.status ?? null,
            total_amount: Number(quotation.total_amount || 0),
            created_at: quotation.created_at ?? null,
            seller_name: profilesMap.get(quotation.seller_id || '')?.full_name || profilesMap.get(quotation.seller_id || '')?.email || null,
            has_order: convertedQuotationIds.has(quotation.id) || quotation.status === 'approved',
        })),
        last_visit_at: visitRow.data?.check_in_time || null,
        last_order_at: ordersData[0]?.created_at || null,
        last_quotation_at: quotationsData[0]?.created_at || null,
        total_orders: ordersCountResponse.count || 0,
        total_quotations: quotationsCountResponse.count || 0,
    };
};
