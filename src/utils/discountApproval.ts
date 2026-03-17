export type DiscountApprovalRequestedItem = {
    product_id: string | null;
    code: string;
    detail: string;
    price: number;
    net_price: number;
    discount_pct: number;
    qty: number;
};

export type DiscountApprovalPayload = {
    quotation_id?: string | null;
    folio?: number | null;
    client_name?: string | null;
    max_discount_pct?: number | null;
    limit_pct?: number | null;
    total_amount?: number | null;
    request_reason?: string | null;
    seller_name?: string | null;
    seller_email?: string | null;
    requested_items?: DiscountApprovalRequestedItem[];
};

const toNumber = (value: any) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const buildDiscountApprovalRequestedItems = (items: any[], limitPct: number): DiscountApprovalRequestedItem[] => {
    return (items || [])
        .map((item: any) => ({
            product_id: item?.product_id || item?.productId || null,
            code: String(item?.code || '').trim(),
            detail: String(item?.detail || '').trim(),
            price: toNumber(item?.price),
            net_price: toNumber(item?.net_price ?? item?.netPrice ?? item?.price),
            discount_pct: Number(toNumber(item?.discount ?? item?.discountPct).toFixed(2)),
            qty: Math.max(1, Math.trunc(toNumber(item?.qty)))
        }))
        .filter((item) => item.detail && item.discount_pct > limitPct);
};

export const readDiscountApprovalPayload = (value: any): DiscountApprovalPayload => {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as DiscountApprovalPayload;
            }
        } catch {
            return {};
        }
        return {};
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as DiscountApprovalPayload;
};

export const getApprovalReason = (approval: any) => {
    const payload = readDiscountApprovalPayload(approval?.payload);
    return String(payload.request_reason || '').trim();
};

export const getApprovalRequestedItems = (approval: any, quotation?: any): DiscountApprovalRequestedItem[] => {
    const payload = readDiscountApprovalPayload(approval?.payload);
    const payloadItems = Array.isArray(payload.requested_items) ? payload.requested_items : [];

    if (payloadItems.length > 0) {
        return payloadItems.map((item) => ({
            product_id: item?.product_id || null,
            code: String(item?.code || '').trim(),
            detail: String(item?.detail || '').trim(),
            price: toNumber(item?.price),
            net_price: toNumber(item?.net_price),
            discount_pct: Number(toNumber(item?.discount_pct).toFixed(2)),
            qty: Math.max(1, Math.trunc(toNumber(item?.qty)))
        })).filter((item) => item.detail);
    }

    const limitPct = toNumber(payload.limit_pct || 5);
    return buildDiscountApprovalRequestedItems(Array.isArray(quotation?.items) ? quotation.items : [], limitPct);
};
