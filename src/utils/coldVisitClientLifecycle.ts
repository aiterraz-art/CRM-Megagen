import { supabase } from '../services/supabase';
import { Database } from '../types/supabase';

type ClientRow = Database['public']['Tables']['clients']['Row'];

interface CleanupTransientColdVisitClientParams {
    visitId: string;
    client: ClientRow;
    clientEmail?: string | null;
    doctorName?: string | null;
    doctorSpecialty?: string | null;
}

interface CleanupTransientColdVisitClientResult {
    removed: boolean;
    reason: 'missing_rut' | 'linked_records' | null;
}

const normalizeRut = (value: string | null | undefined) => `${value || ''}`.replace(/[^0-9kK]/g, '').toUpperCase();

const hasRut = (value: string | null | undefined) => normalizeRut(value).length >= 2;

export const shouldKeepColdVisitAsClient = (client: Pick<ClientRow, 'rut'> | null | undefined) => hasRut(client?.rut);

export const cleanupTransientColdVisitClient = async ({
    visitId,
    client,
    clientEmail,
    doctorName,
    doctorSpecialty
}: CleanupTransientColdVisitClientParams): Promise<CleanupTransientColdVisitClientResult> => {
    if (shouldKeepColdVisitAsClient(client)) {
        return { removed: false, reason: null };
    }

    const [
        { count: quotationCount, error: quotationError },
        { count: orderCount, error: orderError }
    ] = await Promise.all([
        supabase.from('quotations').select('id', { count: 'exact', head: true }).eq('client_id', client.id),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('client_id', client.id)
    ]);

    if (quotationError) throw quotationError;
    if (orderError) throw orderError;

    if ((quotationCount || 0) > 0 || (orderCount || 0) > 0) {
        return { removed: false, reason: 'linked_records' };
    }

    const { error: snapshotError } = await (supabase.from('visits') as any)
        .update({
            client_id: null,
            cold_visit_clinic_name: client.name,
            cold_visit_address: client.address || null,
            cold_visit_doctor_name: (doctorName || client.purchase_contact || '').trim() || null,
            cold_visit_doctor_specialty: (doctorSpecialty || client.doctor_specialty || '').trim() || null,
            cold_visit_client_email: (clientEmail || client.email || '').trim().toLowerCase() || null,
            cold_visit_client_rut: client.rut || null
        })
        .eq('id', visitId);

    if (snapshotError) throw snapshotError;

    const { error: deleteError } = await supabase.from('clients').delete().eq('id', client.id);
    if (deleteError) throw deleteError;

    return { removed: true, reason: 'missing_rut' };
};
