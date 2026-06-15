import { supabase } from '../services/supabase';
import { buildDiscountApprovalRequestedItems } from './discountApproval';

export const SELLER_MAX_DISCOUNT_PCT = 5;

const toNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const getQuotationMaxDiscountPct = (items: any[]) => {
    return (Array.isArray(items) ? items : []).reduce((max, item) => {
        const explicitDiscount = toNumber(item?.discount ?? item?.discountPct);
        const listPrice = toNumber(item?.price);
        const netPrice = toNumber(item?.net_price ?? item?.netPrice ?? item?.price);
        const derivedDiscount = listPrice > 0 ? ((listPrice - netPrice) / listPrice) * 100 : 0;
        return Math.max(max, Number(Math.max(explicitDiscount, derivedDiscount).toFixed(2)));
    }, 0);
};

export const fetchLatestDiscountApproval = async (quotationId: string) => {
    const { data, error } = await supabase
        .from('approval_requests')
        .select('id, entity_id, status, approval_type, requested_at, payload')
        .eq('module', 'sales')
        .eq('approval_type', 'extra_discount')
        .eq('entity_id', quotationId)
        .order('requested_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data || null;
};

type ApprovalReasonContext = {
    quotation: any;
    status: 'new_request' | 'rejected';
    maxDiscountPct: number;
    limitPct: number;
};

type EnsureDiscountApprovalParams = {
    quotation: any;
    requesterId: string;
    sellerName: string | null | undefined;
    sellerEmail: string | null | undefined;
    requestReasonProvider: (context: ApprovalReasonContext) => Promise<string | null>;
    onApprovalCreated?: (approvalId: string) => void;
    latestApproval?: any;
    limitPct?: number;
};

type EnsureDiscountApprovalResult = {
    allowed: boolean;
    action: 'not_required' | 'approved' | 'pending' | 'requested' | 'cancelled';
    message?: string;
    approval?: any;
};

export const ensureDiscountApprovalBeforeOrderConversion = async ({
    quotation,
    requesterId,
    sellerName,
    sellerEmail,
    requestReasonProvider,
    onApprovalCreated,
    latestApproval,
    limitPct = SELLER_MAX_DISCOUNT_PCT,
}: EnsureDiscountApprovalParams): Promise<EnsureDiscountApprovalResult> => {
    const maxDiscountPct = getQuotationMaxDiscountPct(quotation?.items || []);
    if (maxDiscountPct <= limitPct) {
        return { allowed: true, action: 'not_required' };
    }

    const currentApproval = latestApproval === undefined
        ? await fetchLatestDiscountApproval(quotation.id)
        : latestApproval;

    if (currentApproval?.status === 'approved') {
        return { allowed: true, action: 'approved', approval: currentApproval };
    }

    if (currentApproval?.status === 'pending') {
        return {
            allowed: false,
            action: 'pending',
            approval: currentApproval,
            message: 'Esta cotización ya tiene una aprobación de descuento pendiente. Debes esperar la resolución antes de generar el pedido.',
        };
    }

    const requestReason = await requestReasonProvider({
        quotation,
        status: currentApproval?.status === 'rejected' ? 'rejected' : 'new_request',
        maxDiscountPct,
        limitPct,
    });

    if (!requestReason) {
        return {
            allowed: false,
            action: 'cancelled',
        };
    }

    const requestedItems = buildDiscountApprovalRequestedItems(quotation?.items || [], limitPct);
    const { data: approvalRow, error: approvalError } = await supabase
        .from('approval_requests')
        .insert({
            module: 'sales',
            entity_id: quotation.id,
            requester_id: requesterId,
            approval_type: 'extra_discount',
            payload: {
                quotation_id: quotation.id,
                folio: quotation?.folio || null,
                client_name: quotation?.client_name || quotation?.client?.name || null,
                max_discount_pct: Number(maxDiscountPct.toFixed(2)),
                limit_pct: limitPct,
                total_amount: Number(quotation?.total_amount || 0),
                request_reason: requestReason,
                seller_name: sellerName || quotation?.seller_name || null,
                seller_email: sellerEmail || quotation?.seller_email || null,
                requested_items: requestedItems,
            },
            status: 'pending',
        } as any)
        .select('id, entity_id, status, approval_type, requested_at, payload')
        .single();

    if (approvalError) throw approvalError;
    if (approvalRow?.id && onApprovalCreated) {
        onApprovalCreated(approvalRow.id);
    }

    return {
        allowed: false,
        action: 'requested',
        approval: approvalRow,
        message: currentApproval?.status === 'rejected'
            ? 'Se envió una nueva solicitud de autorización de descuento. Cuando sea aprobada podrás generar el pedido.'
            : 'Se envió la solicitud de autorización de descuento. Cuando sea aprobada podrás generar el pedido.',
    };
};
