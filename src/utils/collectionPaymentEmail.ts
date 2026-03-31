import { sendGmailMessage } from './gmail';
import { getCompanyConfig } from './companyConfig';

type CollectionPaymentEmailInput = {
    attachment: File;
    row: {
        client_name?: string | null;
        client_rut?: string | null;
        document_number?: string | number | null;
        due_date?: string | null;
        amount?: number | string | null;
        outstanding_amount?: number | string | null;
        seller_comment?: string | null;
        client_id?: string | null;
    };
    profileId?: string | null;
    senderEmail?: string | null;
    senderName?: string | null;
};

const formatMoney = (value: number | string | null | undefined) =>
    `$${Number(value || 0).toLocaleString('es-CL')}`;

const formatDate = (value: string | null | undefined) => {
    if (!value) return 'Sin fecha';
    const raw = String(value).trim();
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0];
    const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return `${match[3]}/${match[2]}/${match[1]}`;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const day = `${parsed.getDate()}`.padStart(2, '0');
    const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
};

export const sendCollectionPaymentEmail = async ({
    attachment,
    row,
    profileId,
    senderEmail,
    senderName
}: CollectionPaymentEmailInput) => {
    const { companyName, collectionsPaymentsEmail } = getCompanyConfig();
    if (!collectionsPaymentsEmail) {
        throw new Error('No hay correo de pagos configurado para esta empresa.');
    }

    const clientName = String(row.client_name || 'Cliente sin nombre').trim();
    const documentNumber = String(row.document_number || 'Sin documento').trim();
    const subject = `Comprobante de pago cobranza - Documento ${documentNumber} - ${clientName}`;
    const sellerLabel = String(senderName || '').trim() || String(senderEmail || '').trim() || 'Usuario CRM';
    const amount = Number(row.amount || 0);
    const outstandingAmount = Number(row.outstanding_amount || row.amount || 0);

    const message = [
        'Equipo de pagos,',
        '',
        `Se adjunta comprobante de pago cargado desde el módulo de Cobranzas de ${companyName}.`,
        '',
        `Cliente: ${clientName}`,
        `RUT: ${row.client_rut || 'Sin RUT'}`,
        `Documento: ${documentNumber}`,
        `Vencimiento: ${formatDate(row.due_date)}`,
        `Monto factura: ${formatMoney(amount)}`,
        `Saldo registrado: ${formatMoney(outstandingAmount)}`,
        `Comentario vendedor: ${String(row.seller_comment || '').trim() || 'Sin comentario.'}`,
        `Enviado por: ${sellerLabel}`,
        '',
        'Favor revisar y conciliar el pago informado.',
    ].join('\n');

    return sendGmailMessage({
        to: collectionsPaymentsEmail,
        subject,
        message,
        attachment,
        clientId: row.client_id || undefined,
        profileId: profileId || undefined,
    });
};
