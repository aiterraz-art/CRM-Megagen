import { sendGmailMessage } from './gmail';
import { generateOrderPdfFile, type OrderPdfData } from './orderPdf';

export const ORDER_NOTIFICATION_RECIPIENTS = ['soporte@3dental.cl', 'amerino@3dental.cl'];

type SendOrderNotificationEmailInput = {
    order: OrderPdfData;
    proofAttachment?: File | null;
    clientId?: string;
    profileId?: string;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

export const sendOrderNotificationEmail = async (input: SendOrderNotificationEmailInput) => {
    const { order, proofAttachment = null, clientId, profileId } = input;
    const orderPdf = await generateOrderPdfFile(order);
    const attachments = proofAttachment ? [orderPdf, proofAttachment] : [orderPdf];
    const subject = `Pedido #${order.folio} - ${order.clientName}`;
    const message = [
        'Equipo 3Dental,',
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
        to: ORDER_NOTIFICATION_RECIPIENTS.join(','),
        subject,
        message,
        attachments,
        clientId,
        profileId
    });
};
