import { supabase } from '../services/supabase';
import { sendGmailMessage } from './gmail';
import { getCompanyConfig } from './companyConfig';
import { generateOrderPdfFile, type OrderPdfData } from './orderPdf';

type SendOrderNotificationEmailInput = {
    order: OrderPdfData;
    proofAttachment?: File | null;
    clientId?: string;
    profileId?: string;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

const loadOrderNotificationRecipients = async () => {
    const { data, error } = await supabase
        .from('profiles')
        .select('email, role, status')
        .in('role', ['facturador', 'administrativo'])
        .eq('status', 'active');

    if (error) throw error;

    const recipients = Array.from(new Set(
        (data || [])
            .map((profile) => String(profile.email || '').trim().toLowerCase())
            .filter(Boolean)
    ));

    if (recipients.length === 0) {
        throw new Error('No hay usuarios facturadores activos configurados.');
    }

    return recipients;
};

export const sendOrderNotificationEmail = async (input: SendOrderNotificationEmailInput) => {
    const { order, proofAttachment = null, clientId, profileId } = input;
    const { companyName } = getCompanyConfig();
    const recipients = await loadOrderNotificationRecipients();
    const orderPdf = await generateOrderPdfFile(order);
    const attachments = proofAttachment ? [orderPdf, proofAttachment] : [orderPdf];
    const subject = `Pedido #${order.folio} - ${order.clientName}`;
    const message = [
        `Equipo ${companyName},`,
        '',
        `Se genero el pedido #${order.folio}${order.quotationFolio ? ` desde la cotizacion #${order.quotationFolio}` : ''}.`,
        `Cliente: ${order.clientName}`,
        `Condicion de pago: ${order.paymentTerms}`,
        `Total: ${formatMoney(order.totalAmount)}`,
        `Vendedor: ${order.sellerName}`,
        '',
        proofAttachment
            ? 'Adjuntos: PDF del pedido y comprobante de pago.'
            : 'Adjunto: PDF del pedido.',
    ].join('\n');

    return sendGmailMessage({
        to: recipients.join(','),
        subject,
        message,
        attachments,
        clientId,
        profileId
    });
};
