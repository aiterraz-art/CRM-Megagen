import { normalizeChileanPhone } from './messageTemplates';

// Una gestion virtual es una visita con type = 'virtual' y un canal: cuenta en la meta
// diaria y en el historial igual que una visita presencial, pero sin GPS ni geocerca.
export const VIRTUAL_VISIT_TYPE = 'virtual';

export type VirtualChannel = 'call' | 'whatsapp' | 'video' | 'email';
export type VirtualOutcome =
    | 'interested'
    | 'quotation_sent'
    | 'order_closed'
    | 'follow_up'
    | 'no_answer'
    | 'not_interested'
    | 'wrong_contact';

export const VIRTUAL_CHANNELS: { value: VirtualChannel; label: string; desc: string }[] = [
    { value: 'call', label: 'Llamada', desc: 'Llamada telefónica' },
    { value: 'whatsapp', label: 'WhatsApp', desc: 'Chat o audio' },
    { value: 'video', label: 'Videollamada', desc: 'Meet, Zoom o WhatsApp video' },
    { value: 'email', label: 'Correo', desc: 'Intercambio por email' }
];

export const VIRTUAL_OUTCOMES: { value: VirtualOutcome; label: string }[] = [
    { value: 'interested', label: 'Interesado' },
    { value: 'quotation_sent', label: 'Cotización enviada' },
    { value: 'order_closed', label: 'Pedido cerrado' },
    { value: 'follow_up', label: 'Requiere seguimiento' },
    { value: 'no_answer', label: 'No contesta' },
    { value: 'not_interested', label: 'Sin interés' },
    { value: 'wrong_contact', label: 'Datos de contacto erróneos' }
];

export type VirtualCheckoutDetails = {
    outcome: VirtualOutcome;
    durationMinutes: number | null;
    nextActionAt: string | null;
};

export const isVirtualVisit = (visit: { type?: string | null } | null | undefined) =>
    (visit?.type || '').toLowerCase() === VIRTUAL_VISIT_TYPE;

export const getVirtualChannelLabel = (channel: string | null | undefined) =>
    VIRTUAL_CHANNELS.find((item) => item.value === channel)?.label || 'Virtual';

export const getVirtualOutcomeLabel = (outcome: string | null | undefined) =>
    VIRTUAL_OUTCOMES.find((item) => item.value === outcome)?.label || null;

// Tipo de atencion que se preselecciona en la cotizacion creada durante la gestion.
export const getQuotationInteractionTypeForChannel = (channel: string | null | undefined): 'WhatsApp' | 'Teléfono' =>
    channel === 'call' ? 'Teléfono' : 'WhatsApp';

// Enlace para abrir el canal desde el telefono o el navegador. null si falta el dato.
export const buildVirtualChannelUrl = (
    channel: VirtualChannel,
    client: { phone?: string | null; email?: string | null }
): string | null => {
    if (channel === 'call') {
        const phone = String(client.phone || '').replace(/[^\d+]/g, '');
        return phone ? `tel:${phone}` : null;
    }
    if (channel === 'whatsapp') {
        const phone = normalizeChileanPhone(client.phone);
        return phone ? `https://wa.me/${phone}` : null;
    }
    if (channel === 'email') {
        const email = String(client.email || '').trim();
        return email ? `mailto:${email}` : null;
    }
    return null;
};

export const openVirtualChannel = (url: string) => {
    if (url.startsWith('http')) {
        window.open(url, '_blank', 'noopener,noreferrer');
    } else {
        window.location.href = url;
    }
};
