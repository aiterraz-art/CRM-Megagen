import { supabase } from '../services/supabase';

/**
 * Registro de una gestión con el cliente en su tabla histórica.
 *
 * Cada canal vive en una tabla distinta y con un esquema distinto, herencia de cómo
 * fueron apareciendo. Este helper concentra esa divergencia en un solo sitio para que
 * quien registra una gestión no tenga que conocerla: lo usan el modal de gestión de
 * clientes y la bandeja de reactivación.
 *
 * Importante: escribir aquí actualiza la última actividad del cliente, que es lo que
 * alimenta los indicadores de seguimiento. No cierra ningún caso de reactivación, porque
 * contactar no es reactivar.
 */

export type InteractionChannel = 'call' | 'whatsapp' | 'email';

export type LoggedInteraction = {
    channel: InteractionChannel;
    /** Identificador de la fila insertada en la tabla del canal, si la devolvió. */
    logId: string | null;
};

export type LogClientInteractionInput = {
    clientId: string;
    userId: string;
    channel: InteractionChannel;
    /** Resultado de la llamada, o estado de entrega del mensaje. */
    status?: string | null;
    destination?: string | null;
    subject?: string | null;
    notes?: string | null;
};

export const logClientInteraction = async (
    input: LogClientInteractionInput
): Promise<LoggedInteraction> => {
    const notas = input.notes?.trim() ? input.notes.trim() : null;

    if (input.channel === 'call') {
        const { data, error } = await (supabase.from('call_logs') as any)
            .insert({
                client_id: input.clientId,
                user_id: input.userId,
                status: input.status,
                notes: notas
            })
            .select('id')
            .maybeSingle();

        if (error) throw error;
        return { channel: 'call', logId: data?.id ?? null };
    }

    if (input.channel === 'whatsapp') {
        const { data, error } = await (supabase.from('lead_message_logs') as any)
            .insert({
                client_id: input.clientId,
                user_id: input.userId,
                channel: 'whatsapp',
                destination: input.destination,
                status: input.status,
                // La tabla no tiene columna de notas: el texto libre viaja en este campo,
                // que es donde lo ha guardado el modal de gestión desde el principio.
                error_message: notas
            })
            .select('id')
            .maybeSingle();

        if (error) throw error;
        return { channel: 'whatsapp', logId: data?.id ?? null };
    }

    // email_logs no tiene destinatario ni estado, así que esa información se pierde aquí.
    // Quien necesite conservarla, como la bandeja de reactivación, la guarda en su propio
    // registro de intentos.
    const { data, error } = await (supabase.from('email_logs') as any)
        .insert({
            client_id: input.clientId,
            user_id: input.userId,
            subject: input.subject?.trim() || 'Correo registrado manualmente',
            snippet: notas
        })
        .select('id')
        .maybeSingle();

    if (error) throw error;
    return { channel: 'email', logId: data?.id ?? null };
};
