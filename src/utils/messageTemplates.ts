export type MessageTemplateContext = {
    clinic_name?: string | null;
    doctor_name?: string | null;
    seller_name?: string | null;
    company_name?: string | null;
    client_phone?: string | null;
    client_email?: string | null;
};

const PLACEHOLDERS: Record<string, keyof MessageTemplateContext> = {
    '{{clinic_name}}': 'clinic_name',
    '{{doctor_name}}': 'doctor_name',
    '{{seller_name}}': 'seller_name',
    '{{company_name}}': 'company_name',
    '{{client_phone}}': 'client_phone',
    '{{client_email}}': 'client_email'
};

const replaceTags = (input: string, context: MessageTemplateContext): string => {
    let output = input || '';
    Object.entries(PLACEHOLDERS).forEach(([tag, key]) => {
        const value = (context[key] || '').toString();
        output = output.split(tag).join(value);
    });
    return output;
};

export const renderTemplate = (body: string, context: MessageTemplateContext) => replaceTags(body, context);
export const renderSubject = (subject: string | null | undefined, context: MessageTemplateContext) => replaceTags(subject || '', context);

export const TEMPLATE_TAGS = Object.keys(PLACEHOLDERS);

export const normalizeChileanPhone = (rawPhone: string | null | undefined): string | null => {
    const cleaned = (rawPhone || '').replace(/\D+/g, '');
    if (!cleaned) return null;

    if (cleaned.startsWith('56') && cleaned.length === 11) return cleaned;
    if (cleaned.startsWith('9') && cleaned.length === 9) return `56${cleaned}`;
    if (cleaned.startsWith('569') && cleaned.length === 11) return cleaned;

    return null;
};
