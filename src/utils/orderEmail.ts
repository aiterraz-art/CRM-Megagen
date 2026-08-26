import { supabase } from '../services/supabase';
import { generateOrderPdfFile, type OrderPdfData } from './orderPdf';

export type OrderNotificationRequestSource = 'quotation_conversion' | 'manual_resend';

type SendOrderNotificationEmailInput = {
    orderId: string;
    requestSource: OrderNotificationRequestSource;
    order: OrderPdfData;
};

type SendOrderNotificationEmailResult = {
    status: 'sent';
    senderEmail: string;
    toRecipients: string[];
    ccRecipients: string[];
    gmailMessageId: string;
    gmailThreadId: string | null;
};

const fileToBase64 = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
};

const persistOrderNotificationFailure = async (
    input: Pick<SendOrderNotificationEmailInput, 'orderId' | 'requestSource' | 'order'>,
    message: string
) => {
    try {
        const { error: orderError } = await supabase
            .from('orders')
            .update({
                payment_email_status: 'failed',
                payment_email_error: message,
                payment_email_sent_at: null,
            })
            .eq('id', input.orderId);

        if (orderError) {
            console.warn('No se pudo persistir el error de correo del pedido:', orderError.message);
        }

        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user?.id) {
            if (authError) {
                console.warn('No se pudo identificar al usuario para registrar historial de correo:', authError.message);
            }
            return;
        }

        const { error: logError } = await supabase
            .from('order_notification_logs')
            .insert({
                order_id: input.orderId,
                triggered_by: authData.user.id,
                sender_email: String(import.meta.env.VITE_COMPANY_EMAIL || '').trim(),
                to_recipients: [],
                cc_recipients: [],
                subject: `Pedido #${input.order.folio} - ${input.order.clientName}`,
                body_preview: `El envío del pedido #${input.order.folio} falló antes de completar el despacho del correo.`,
                status: 'failed',
                error_message: message,
                request_source: input.requestSource,
                attachments: [],
                sent_at: null,
            });

        if (logError) {
            console.warn('No se pudo registrar el historial fallido de correo del pedido:', logError.message);
        }
    } catch (error: any) {
        console.warn('Error inesperado guardando fallo de correo del pedido:', error?.message || error);
    }
};

export const sendOrderNotificationEmail = async (input: SendOrderNotificationEmailInput): Promise<SendOrderNotificationEmailResult> => {
    try {
        const orderPdf = await generateOrderPdfFile(input.order);
        const contentBase64 = await fileToBase64(orderPdf);

        const { data, error } = await supabase.functions.invoke('send-order-notification', {
            body: {
                orderId: input.orderId,
                requestSource: input.requestSource,
                orderPdfAttachment: {
                    name: orderPdf.name,
                    mimeType: orderPdf.type || 'application/pdf',
                    contentBase64,
                },
            },
        });

        if (error) {
            const functionsError = error as any;
            let detailedMessage: string | null = null;
            if (functionsError?.context) {
                try {
                    const response = functionsError.context as Response;
                    const payload = await response.clone().json();
                    if (payload?.error) {
                        detailedMessage = String(payload.error);
                    }
                } catch {
                    if (!detailedMessage) {
                        try {
                            const response = functionsError.context as Response;
                            const text = await response.clone().text();
                            if (text) {
                                detailedMessage = text;
                            }
                        } catch {
                            // Fallback to original message below.
                        }
                    }
                }
            }
            const message = detailedMessage || error.message || 'No se pudo enviar el pedido a facturación.';
            throw new Error(message);
        }
        if (!data || data.error) {
            const message = data?.error || 'No se pudo enviar el pedido a facturación.';
            throw new Error(message);
        }

        return data as SendOrderNotificationEmailResult;
    } catch (error: any) {
        const message = error?.message || 'No se pudo enviar el pedido a facturación.';
        await persistOrderNotificationFailure(input, message);
        throw error;
    }
};
