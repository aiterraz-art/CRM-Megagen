import { supabase } from '../services/supabase';

type SendSizeChangeNotificationEmailInput = {
    requestId: string;
};

type SendSizeChangeNotificationEmailResult = {
    status: 'sent';
    senderEmail: string;
    toRecipients: string[];
    gmailMessageId: string;
    gmailThreadId: string | null;
};

export const sendSizeChangeNotificationEmail = async (
    input: SendSizeChangeNotificationEmailInput
): Promise<SendSizeChangeNotificationEmailResult> => {
    const { data, error } = await supabase.functions.invoke('send-size-change-notification', {
        body: {
            requestId: input.requestId,
        },
    });

    if (error) {
        throw new Error(error.message || 'No se pudo enviar el cambio de medida a facturación.');
    }
    if (!data || data.error) {
        throw new Error(data?.error || 'No se pudo enviar el cambio de medida a facturación.');
    }

    return data as SendSizeChangeNotificationEmailResult;
};
