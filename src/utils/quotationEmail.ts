import { sendGmailMessage } from './gmail';
import { getCompanyConfig } from './companyConfig';
import { generateQuotationPdfFile } from './quotationPdf';
import type { QuotationPreviewData } from './quotationPreview';

type SendQuotationEmailInput = {
    quotation: QuotationPreviewData;
    recipient?: string | null;
    contactName?: string | null;
    clientId?: string | null;
    profileId?: string | null;
    pdfAttachment?: File | null;
};

const formatMoney = (value: number) => `$${Math.max(0, Math.round(Number(value || 0))).toLocaleString('es-CL')}`;

export const sendQuotationEmail = async (input: SendQuotationEmailInput) => {
    const { quotation, recipient, contactName, clientId, profileId, pdfAttachment = null } = input;
    const { companyName } = getCompanyConfig();
    const targetEmail = String(recipient || quotation.clientEmail || '').trim();

    if (!targetEmail) {
        throw new Error('El cliente no tiene correo registrado.');
    }

    const items = Array.isArray(quotation.items) ? quotation.items : [];
    const subtotal = items.reduce((acc, item) => acc + Math.max(0, Math.round(Number(item.total || 0))), 0);
    const tax = Math.round(subtotal * 0.19);
    const total = subtotal + tax;
    const quotationPdf = pdfAttachment || await generateQuotationPdfFile(quotation);
    const subject = `Cotización Folio Nº ${quotation.folio} - ${companyName}`;
    const message = [
        `Hola ${String(contactName || quotation.clientContact || 'cliente').trim()},`,
        '',
        `Te comparto la cotización Folio Nº ${quotation.folio}.`,
        `Total: ${formatMoney(total)}`,
        `Vendedor: ${quotation.sellerName || 'Vendedor'}`,
        '',
        'Adjunto encontrarás el PDF formal de la cotización.',
        '',
        'Quedo atento(a) a tus comentarios.'
    ].join('\n');

    return sendGmailMessage({
        to: targetEmail,
        subject,
        message,
        attachments: [quotationPdf],
        clientId: clientId || undefined,
        profileId: profileId || undefined
    });
};
