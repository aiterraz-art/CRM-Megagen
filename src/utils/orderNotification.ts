export type OrderNotificationLog = {
    id: string;
    order_id: string;
    sender_email: string;
    to_recipients: string[];
    cc_recipients: string[];
    status: 'pending' | 'sent' | 'failed';
    gmail_message_id: string | null;
    gmail_thread_id: string | null;
    error_message: string | null;
    request_source: 'quotation_conversion' | 'manual_resend';
    sent_at: string | null;
    created_at: string;
};
