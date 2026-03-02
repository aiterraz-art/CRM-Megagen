import { supabase } from '../services/supabase';
import { googleService } from '../services/googleService';

type SendGmailMessageInput = {
    to: string;
    cc?: string;
    subject: string;
    message: string;
    attachment?: File | null;
    clientId?: string;
    profileId?: string;
};

const toWebSafeBase64 = (value: string) =>
    btoa(unescape(encodeURIComponent(value)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

export const sendGmailMessage = async (input: SendGmailMessageInput) => {
    const { to, cc = '', subject, message, attachment = null, clientId, profileId } = input;
    const { data: { session } } = await supabase.auth.getSession();
    const validToken = await googleService.ensureSession();

    if (!session || !validToken) {
        throw new Error('Sesion de Google no disponible.');
    }

    const boundary = 'foo_bar_baz';
    const messageParts: Array<string | null> = [
        `From: ${session.user.email}`,
        `To: ${to}`,
        cc ? `Cc: ${cc}` : null,
        `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 7bit',
        '',
        message,
        ''
    ];

    if (attachment) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(attachment);
        });

        const base64Data = String(reader.result || '').split(',')[1];
        if (!base64Data) {
            throw new Error('No se pudo leer el archivo adjunto.');
        }

        messageParts.push(
            `--${boundary}`,
            `Content-Type: ${attachment.type}; name="${attachment.name}"`,
            `Content-Disposition: attachment; filename="${attachment.name}"`,
            'Content-Transfer-Encoding: base64',
            '',
            base64Data,
            ''
        );
    }

    messageParts.push(`--${boundary}--`);
    const rawMimeMessage = messageParts.filter(Boolean).join('\r\n');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${validToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: toWebSafeBase64(rawMimeMessage) })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || 'Error al enviar correo.');
    }

    if (clientId && profileId) {
        await supabase.from('email_logs').insert({
            client_id: clientId,
            user_id: profileId,
            subject,
            snippet: `${message.substring(0, 100)}...`
        });
    }

    return data;
};
