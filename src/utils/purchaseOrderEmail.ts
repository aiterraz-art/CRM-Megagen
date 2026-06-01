import { supabase } from '../services/supabase';

export type PurchaseOrderNotificationRequestSource = 'creation' | 'manual_resend';

type SendPurchaseOrderNotificationInput = {
    purchaseOrderId: string;
    requestSource: PurchaseOrderNotificationRequestSource;
    pdfAttachment: File;
};

type SendPurchaseOrderNotificationResult = {
    status: 'sent';
    senderEmail: string;
    toRecipients: string[];
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

export const sendPurchaseOrderNotificationEmail = async (
    input: SendPurchaseOrderNotificationInput
): Promise<SendPurchaseOrderNotificationResult> => {
    const contentBase64 = await fileToBase64(input.pdfAttachment);

    const { data, error } = await supabase.functions.invoke('send-purchase-order-notification', {
        body: {
            purchaseOrderId: input.purchaseOrderId,
            requestSource: input.requestSource,
            pdfAttachment: {
                name: input.pdfAttachment.name,
                mimeType: input.pdfAttachment.type || 'application/pdf',
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
                try {
                    const response = functionsError.context as Response;
                    const text = await response.clone().text();
                    if (text) {
                        detailedMessage = text;
                    }
                } catch {
                    // Use default error below.
                }
            }
        }

        throw new Error(detailedMessage || error.message || 'No se pudo enviar la orden de compra.');
    }

    if (!data || data.error) {
        throw new Error(data?.error || 'No se pudo enviar la orden de compra.');
    }

    return data as SendPurchaseOrderNotificationResult;
};
