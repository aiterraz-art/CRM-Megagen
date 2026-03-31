import { supabase } from '../services/supabase';
import { Json } from '../types/supabase';

export type QuotationOrderConversionStage =
    | 'started'
    | 'payment_proof_upload'
    | 'order_creation'
    | 'notification'
    | 'cleanup'
    | 'completed';

export type QuotationOrderConversionStatus = 'info' | 'success' | 'failed';

type LogQuotationOrderConversionInput = {
    attemptId: string;
    quotationId: string;
    orderId?: string | null;
    actorId: string;
    stage: QuotationOrderConversionStage;
    status: QuotationOrderConversionStatus;
    message?: string | null;
    metadata?: Json;
};

export const logQuotationOrderConversion = async (input: LogQuotationOrderConversionInput) => {
    const { error } = await supabase
        .from('quotation_order_conversion_logs')
        .insert({
            attempt_id: input.attemptId,
            quotation_id: input.quotationId,
            order_id: input.orderId || null,
            actor_id: input.actorId,
            stage: input.stage,
            status: input.status,
            message: input.message || null,
            metadata: input.metadata ?? {},
        });

    if (error) {
        throw error;
    }
};

export const logQuotationOrderConversionSafe = async (input: LogQuotationOrderConversionInput) => {
    try {
        await logQuotationOrderConversion(input);
    } catch (error) {
        console.warn('No se pudo registrar trazabilidad de conversión de cotización a pedido:', error);
    }
};
