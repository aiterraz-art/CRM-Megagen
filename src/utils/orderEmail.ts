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

export const sendOrderNotificationEmail = async (input: SendOrderNotificationEmailInput): Promise<SendOrderNotificationEmailResult> => {
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
        throw new Error(detailedMessage || error.message || 'No se pudo enviar el pedido a facturación.');
    }
    if (!data || data.error) {
        throw new Error(data?.error || 'No se pudo enviar el pedido a facturación.');
    }

    return data as SendOrderNotificationEmailResult;
};
