type QuotationLikeItem = {
    product_id?: string | null;
    productId?: string | null;
    code?: string | null;
    detail?: string | null;
};

const stockInsufficientRegex = /Stock insuficiente para producto ([0-9a-f-]{36})(?: \(stock ([^,]+), solicitado ([^)]+)\))?/i;
const missingInventoryRegex = /Producto ([0-9a-f-]{36}) no existe en inventario/i;

const normalizeUuid = (value: unknown) => String(value || '').trim().toLowerCase();

const getItemLabel = (item: QuotationLikeItem | undefined) => {
    if (!item) return null;
    const sku = String(item.code || '').trim() || 'SIN-SKU';
    const name = String(item.detail || '').trim() || 'Producto sin nombre';
    return `${sku} - ${name}`;
};

const findQuotationItem = (items: QuotationLikeItem[] | null | undefined, productId: string) => {
    const normalizedProductId = normalizeUuid(productId);
    return (items || []).find((item) => {
        const itemId = normalizeUuid(item.product_id || item.productId);
        return itemId === normalizedProductId;
    });
};

export const formatOrderConversionErrorMessage = (
    rawMessage: string | null | undefined,
    items: QuotationLikeItem[] | null | undefined
) => {
    const message = String(rawMessage || '').trim();
    if (!message) return 'Ocurrió un error al generar el pedido.';

    const insufficientMatch = message.match(stockInsufficientRegex);
    if (insufficientMatch) {
        const [, productId, stock, requested] = insufficientMatch;
        const item = findQuotationItem(items, productId);
        const itemLabel = getItemLabel(item) || productId;
        const stockSuffix = stock && requested ? ` (stock ${stock}, solicitado ${requested})` : '';
        return `Stock insuficiente para ${itemLabel}${stockSuffix}`;
    }

    const missingProductMatch = message.match(missingInventoryRegex);
    if (missingProductMatch) {
        const [, productId] = missingProductMatch;
        const item = findQuotationItem(items, productId);
        const itemLabel = getItemLabel(item) || productId;
        return `El producto ${itemLabel} no existe en inventario.`;
    }

    return message;
};
