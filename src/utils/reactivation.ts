/**
 * Definiciones compartidas del módulo de reactivación.
 *
 * Los catálogos de aquí deben mantenerse en paralelo con las restricciones CHECK de la
 * migración 20260924000017: si se añade un segmento, un resultado de intento o un motivo
 * de descarte, hay que añadirlo en ambos lados o la base rechazará la escritura.
 */

export type ReactivationSegment = 'cooling' | 'dormant' | 'never_contacted';
export type ReactivationStatus = 'open' | 'won' | 'discarded';
export type AttemptChannel = 'call' | 'whatsapp' | 'email' | 'visit' | 'other';
export type AttemptOutcome =
    | 'contacted'
    | 'no_answer'
    | 'wrong_number'
    | 'promised_purchase'
    | 'refused'
    | 'left_message';
export type DiscardReason =
    | 'cerro_local'
    | 'cambio_proveedor'
    | 'sin_datos_de_contacto'
    | 'no_interesado'
    | 'precio'
    | 'duplicado'
    | 'fuera_de_target'
    | 'otro';

export const SEGMENT_LABELS: Record<ReactivationSegment, string> = {
    cooling: 'Enfriándose',
    dormant: 'Dormido',
    never_contacted: 'Sin contacto'
};

export const SEGMENT_STYLES: Record<ReactivationSegment, string> = {
    cooling: 'bg-amber-100 text-amber-700',
    dormant: 'bg-rose-100 text-rose-700',
    never_contacted: 'bg-slate-100 text-slate-600'
};

export const STATUS_LABELS: Record<ReactivationStatus, string> = {
    open: 'Abierto',
    won: 'Reactivado',
    discarded: 'Descartado'
};

export const ATTEMPT_CHANNELS: Array<{ value: AttemptChannel; label: string }> = [
    { value: 'call', label: 'Llamada' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'email', label: 'Correo' },
    { value: 'visit', label: 'Visita' },
    { value: 'other', label: 'Otro' }
];

export const ATTEMPT_OUTCOMES: Array<{ value: AttemptOutcome; label: string; contactoEfectivo: boolean }> = [
    { value: 'contacted', label: 'Hablé con el cliente', contactoEfectivo: true },
    { value: 'promised_purchase', label: 'Prometió comprar', contactoEfectivo: true },
    { value: 'refused', label: 'No le interesa', contactoEfectivo: true },
    { value: 'no_answer', label: 'No contestó', contactoEfectivo: false },
    { value: 'left_message', label: 'Dejé mensaje', contactoEfectivo: false },
    { value: 'wrong_number', label: 'Datos equivocados', contactoEfectivo: false }
];

export const DISCARD_REASONS: Array<{ value: DiscardReason; label: string }> = [
    { value: 'cerro_local', label: 'Cerró el local' },
    { value: 'cambio_proveedor', label: 'Cambió de proveedor' },
    { value: 'sin_datos_de_contacto', label: 'Sin datos de contacto válidos' },
    { value: 'no_interesado', label: 'No está interesado' },
    { value: 'precio', label: 'Precio' },
    { value: 'duplicado', label: 'Cliente duplicado' },
    { value: 'fuera_de_target', label: 'Fuera del perfil objetivo' },
    { value: 'otro', label: 'Otro motivo' }
];

/**
 * El estado de llamada que espera call_logs no es el mismo vocabulario que el resultado
 * del intento. Esta tabla traduce uno al otro para que el historial del cliente siga
 * siendo coherente con lo que registra el modal de gestión.
 */
export const CALL_STATUS_BY_OUTCOME: Record<AttemptOutcome, string> = {
    contacted: 'contestada',
    promised_purchase: 'contestada',
    refused: 'contestada',
    no_answer: 'no_contesto',
    left_message: 'buzon',
    wrong_number: 'equivocado'
};

/** lead_message_logs solo admite estos tres estados de entrega. */
export const MESSAGE_STATUS_BY_OUTCOME: Record<AttemptOutcome, string> = {
    contacted: 'sent',
    promised_purchase: 'sent',
    refused: 'sent',
    no_answer: 'sent',
    left_message: 'sent',
    wrong_number: 'failed'
};

export const formatMoney = (value: number | null | undefined) =>
    `$${Math.round(Number(value || 0)).toLocaleString('es-CL')}`;

export const formatDays = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'nunca';
    if (value === 0) return 'hoy';
    if (value === 1) return '1 día';
    return `${value} días`;
};
