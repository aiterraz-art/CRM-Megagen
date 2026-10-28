import { supabase } from '../services/supabase';
import { formatPaymentTermsFromCreditDays, getClientCreditDays } from './credit';
import { readDiscountApprovalPayload } from './discountApproval';
import { formatOrderConversionErrorMessage } from './orderConversionErrors';
import { sendOrderNotificationEmail } from './orderEmail';
import { logQuotationOrderConversionSafe } from './quotationOrderConversionLog';

export type ApprovedDiscountConversionResult =
    | { status: 'converted'; orderId: string; orderFolio: number | string; emailError: string | null }
    | { status: 'already_exists'; orderFolio: number | string | null }
    | { status: 'missing_proof' }
    | { status: 'failed'; message: string };

const toWholeMoney = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

/**
 * Genera el pedido de una cotizacion en cuanto se aprueba su descuento, con el comprobante
 * que el vendedor adjunto al pedir la autorizacion (clientes sin credito). Si algo falla,
 * la aprobacion queda vigente y el vendedor puede generar el pedido manualmente.
 */
export const convertQuotationAfterDiscountApproval = async (
    approval: { id: string; entity_id: string | null; payload: unknown },
    actorId: string
): Promise<ApprovedDiscountConversionResult> => {
    const quotationId = approval.entity_id;
    if (!quotationId) return { status: 'failed', message: 'La solicitud no tiene cotización asociada.' };

    const attemptId = crypto.randomUUID();
    const log = (input: Omit<Parameters<typeof logQuotationOrderConversionSafe>[0], 'attemptId' | 'quotationId' | 'actorId'>) =>
        logQuotationOrderConversionSafe({
            attemptId,
            quotationId,
            actorId,
            ...input,
            metadata: { source: 'discount_approval', approvalId: approval.id, ...((input.metadata as object) || {}) },
        });

    const { data: quotation, error: quotationError } = await supabase
        .from('quotations')
        .select(`
            id,
            folio,
            seller_id,
            seller_name_snapshot,
            seller_email_snapshot,
            source_visit_id,
            items,
            total_amount,
            comments,
            clients (id, name, rut, address, zone, purchase_contact, phone, email, giro, comuna, office, credit_days)
        `)
        .eq('id', quotationId)
        .maybeSingle();

    if (quotationError || !quotation) {
        return { status: 'failed', message: quotationError?.message || 'No se encontró la cotización.' };
    }

    const client: any = Array.isArray(quotation.clients) ? quotation.clients[0] : quotation.clients;
    const creditDays = getClientCreditDays(client);
    const payload = readDiscountApprovalPayload(approval.payload);
    const proof = payload.payment_proof?.path ? payload.payment_proof : null;

    // Solicitudes creadas antes de exigir el comprobante al pedir la autorizacion.
    if (creditDays === 0 && !proof) return { status: 'missing_proof' };

    await log({ stage: 'started', status: 'info', message: 'Conversión automática tras aprobar descuento.', metadata: { creditDays } });

    const { data, error: rpcError } = await supabase.rpc('convert_quotation_to_order', {
        p_quotation_id: quotationId,
        p_user_id: quotation.seller_id || actorId,
        p_payment_proof_path: proof?.path ?? null,
        p_payment_proof_name: proof?.name ?? null,
        p_payment_proof_mime_type: proof?.mime_type ?? null,
    });

    if (rpcError) {
        const message = formatOrderConversionErrorMessage(
            rpcError.message || rpcError.details || 'No se pudo generar el pedido.',
            Array.isArray(quotation.items) ? quotation.items : []
        );
        await log({ stage: 'order_creation', status: 'failed', message });
        return { status: 'failed', message };
    }

    const response = (data || {}) as any;
    if (response.already_exists) {
        await log({ stage: 'completed', status: 'success', orderId: response.order_id || null, message: 'La cotización ya tenía pedido asociado.' });
        return { status: 'already_exists', orderFolio: response.order_folio ?? null };
    }

    const orderId: string = response.order_id;
    const orderFolio = response.order_folio || orderId?.slice(0, 8) || 'N/A';
    await log({ stage: 'order_creation', status: 'success', orderId, message: 'Pedido creado correctamente.', metadata: { orderFolio } });

    if (quotation.source_visit_id) {
        const { error: visitError } = await supabase.from('orders').update({ visit_id: quotation.source_visit_id }).eq('id', orderId);
        if (visitError) console.warn('No se pudo vincular el pedido a la visita en frío de origen:', visitError.message);
    }

    const items = Array.isArray(quotation.items) ? (quotation.items as any[]) : [];
    let emailError: string | null = null;
    try {
        await sendOrderNotificationEmail({
            orderId,
            requestSource: 'quotation_conversion',
            order: {
                folio: orderFolio,
                quotationFolio: quotation.folio || null,
                date: new Date().toLocaleDateString('es-CL'),
                clientName: client?.name || 'Cliente',
                clientRut: client?.rut || '',
                clientAddress: client?.address || client?.comuna || '',
                clientOffice: client?.office || '',
                clientPhone: client?.phone || '',
                clientEmail: client?.email || '',
                clientGiro: client?.giro || '',
                clientCity: client?.zone || 'Santiago',
                clientComuna: client?.comuna || '',
                clientContact: client?.purchase_contact || '',
                paymentTerms: formatPaymentTermsFromCreditDays(creditDays),
                sellerName: payload.seller_name || quotation.seller_name_snapshot || 'Vendedor',
                sellerEmail: payload.seller_email || quotation.seller_email_snapshot || '',
                items: items.map((item: any) => ({
                    code: item.code || '',
                    detail: item.detail || '',
                    qty: Number(item.qty || 0),
                    unit: item.unit || 'UN',
                    unitPrice: toWholeMoney(item.net_price ?? item.netPrice ?? item.price ?? 0),
                    total: toWholeMoney(item.total ?? (Number(item.qty || 0) * Number(item.net_price ?? item.netPrice ?? item.price ?? 0) || 0)),
                })),
                totalAmount: toWholeMoney(quotation.total_amount || 0),
                comments: quotation.comments || (quotation.folio ? `Pedido generado desde cotización #${quotation.folio}.` : 'Pedido generado desde CRM.'),
            },
        });
        await log({ stage: 'notification', status: 'success', orderId, message: 'Correo a facturación enviado correctamente.' });
    } catch (error: any) {
        emailError = error?.message || 'Error enviando correo a facturación.';
        await log({ stage: 'notification', status: 'failed', orderId, message: emailError });
    }

    await log({ stage: 'completed', status: 'success', orderId, message: 'Conversión automática finalizada.', metadata: { orderFolio } });
    return { status: 'converted', orderId, orderFolio, emailError };
};
