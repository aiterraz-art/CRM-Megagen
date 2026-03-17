export type QuotationPreviewItem = {
    code: string;
    detail: string;
    subDetail?: string;
    qty: number;
    unit: string;
    price: number;
    discount: number;
    total: number;
};

export type QuotationPreviewData = {
    folio: number;
    date: string;
    expiryDate: string;
    clientName: string;
    clientRut: string;
    clientAddress: string;
    clientCity: string;
    clientComuna: string;
    clientGiro: string;
    clientPhone?: string;
    clientEmail?: string;
    clientContact?: string;
    paymentTerms: string;
    sellerName: string;
    sellerEmail?: string;
    items: QuotationPreviewItem[];
    comments?: string;
};

const parseItems = (value: any): QuotationPreviewItem[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const formatDate = (value: string | null | undefined) => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime())
        ? new Date().toLocaleDateString('es-CL')
        : date.toLocaleDateString('es-CL');
};

export const buildQuotationPreviewData = (quotation: any, paymentTerms: string): QuotationPreviewData => {
    const createdAt = quotation?.created_at ? new Date(quotation.created_at) : new Date();
    const expiryAt = Number.isNaN(createdAt.getTime())
        ? new Date()
        : new Date(createdAt.getTime() + (15 * 24 * 60 * 60 * 1000));
    const client = quotation?.client || quotation?.clients || {};

    return {
        folio: Number(quotation?.folio || 0),
        date: formatDate(quotation?.created_at),
        expiryDate: expiryAt.toLocaleDateString('es-CL'),
        clientName: quotation?.client_name || client?.name || 'Cliente',
        clientRut: client?.rut || 'Sin RUT',
        clientAddress: client?.address || client?.comuna || 'Sin Dirección',
        clientCity: client?.zone || 'Santiago',
        clientComuna: client?.comuna || '',
        clientGiro: client?.giro || '',
        clientPhone: quotation?.client_phone || client?.phone || '',
        clientEmail: quotation?.client_email || client?.email || '',
        clientContact: quotation?.client_contact || client?.purchase_contact || '',
        paymentTerms,
        sellerName: quotation?.seller_name || quotation?.seller?.full_name || quotation?.seller?.email || 'Vendedor',
        sellerEmail: quotation?.seller_email || quotation?.seller?.email || '',
        items: parseItems(quotation?.items),
        comments: quotation?.comments || ''
    };
};
