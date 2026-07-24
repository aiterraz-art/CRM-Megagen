import { supabase } from '../services/supabase';
import { Database } from '../types/supabase';

type ClientRow = Database['public']['Tables']['clients']['Row'];
type ClientInsert = Database['public']['Tables']['clients']['Insert'];
type ClientUpdate = Database['public']['Tables']['clients']['Update'];
type ClientDraft = ClientInsert & {
    created_by?: string | null;
};
type ClientUpdatePayload = ClientUpdate & {
    created_by?: string | null;
};

export type DuplicateReason =
    | 'name'
    | 'phone_name'
    | 'name_address'
    | 'name_contact'
    | 'name_location'
    | 'name_geo';

export interface DuplicateMatch {
    client: ClientRow;
    reasons: DuplicateReason[];
    score: number;
}

export interface DuplicateClientGroup {
    id: string;
    primary: ClientRow;
    duplicates: ClientRow[];
    reasonsByClientId: Record<string, DuplicateReason[]>;
}

export interface SaveClientWithDeduplicationResult {
    action: 'created' | 'merged' | 'reused';
    client: ClientRow;
    match: DuplicateMatch | null;
}

const STATUS_PRIORITY = ['lead', 'prospect', 'prospect_new', 'prospect_contacted', 'prospect_evaluating', 'active'];
const CLIENT_REFERENCE_TABLES = [
    'visits',
    'orders',
    'quotations',
    'tasks',
    'installed_base',
    'lead_message_logs',
    'kit_loan_requests',
    'size_change_requests',
    'dispatch_queue_items',
    'call_logs',
    'email_logs'
] as const;

const normalizeText = (value: string | null | undefined): string => value
    ? value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

const normalizeRut = (value: string | null | undefined): string => {
    const clean = `${value || ''}`.replace(/[^0-9kK]/g, '').toUpperCase();
    if (clean.length < 2) return '';
    return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
};

const normalizeEmail = (value: string | null | undefined): string => `${value || ''}`.trim().toLowerCase();

const normalizePhone = (value: string | null | undefined): string => {
    const digits = `${value || ''}`.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length > 9 && digits.startsWith('56')) return digits.slice(-9);
    return digits;
};

const normalizeAddress = (value: string | null | undefined): string => normalizeText(value)
    .replace(/\bavenida\b/g, 'av')
    .replace(/\boficina\b/g, 'of')
    .replace(/\bdepartamento\b/g, 'depto')
    .replace(/\bnumero\b/g, '')
    .trim();

const getSearchTokens = (value: string | null | undefined): string[] => {
    return Array.from(new Set(
        normalizeText(value)
            .split(' ')
            .map((token) => token.trim())
            .filter((token) => token.length >= 4)
            .sort((a, b) => b.length - a.length)
    )).slice(0, 2);
};

const escapeLikePattern = (value: string): string => value.replace(/[%_]/g, (match) => `\\${match}`);

const hasCoordinates = (lat: number | null | undefined, lng: number | null | undefined): lat is number =>
    typeof lat === 'number'
    && Number.isFinite(lat)
    && typeof lng === 'number'
    && Number.isFinite(lng)
    && Math.abs(lat) > 0.0001
    && Math.abs(lng) > 0.0001;

const getDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const toRadians = (deg: number) => deg * (Math.PI / 180);
    const earthRadiusKm = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
};

const pickPreferredString = (...values: Array<string | null | undefined>) => {
    return values
        .map((value) => `${value || ''}`.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] || null;
};

const pickPreferredNumber = (...values: Array<number | null | undefined>) => {
    const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (valid.length === 0) return null;
    return valid.sort((a, b) => b - a)[0];
};

const getStatusPriority = (status: string | null | undefined) => {
    const normalized = normalizeText(status);
    const index = STATUS_PRIORITY.indexOf(normalized);
    return index === -1 ? -1 : index;
};

const buildMergedNotes = (existing: string | null | undefined, incoming: string | null | undefined) => {
    const pieces = [existing, incoming]
        .map((value) => `${value || ''}`.trim())
        .filter(Boolean);
    if (pieces.length <= 1) return pieces[0] || null;
    const uniquePieces = Array.from(new Set(pieces));
    return uniquePieces.join(' | ').slice(0, 4000);
};

const getClientCompletenessScore = (client: Partial<ClientRow>) => {
    return [
        client.rut,
        client.email,
        client.phone,
        client.address,
        client.purchase_contact,
        client.comuna,
        client.office,
        client.giro,
        client.notes
    ].reduce((score, value) => score + (`${value || ''}`.trim() ? 1 : 0), 0);
};

export const compareClientsForDuplicate = (
    a: Pick<ClientRow, 'rut' | 'name' | 'email' | 'phone' | 'address' | 'purchase_contact' | 'comuna' | 'office' | 'lat' | 'lng'>,
    b: Pick<ClientRow, 'rut' | 'name' | 'email' | 'phone' | 'address' | 'purchase_contact' | 'comuna' | 'office' | 'lat' | 'lng'>
): DuplicateReason[] => {
    const reasons: DuplicateReason[] = [];

    const nameA = normalizeText(a.name);
    const nameB = normalizeText(b.name);
    const phoneA = normalizePhone(a.phone);
    const phoneB = normalizePhone(b.phone);
    const addressA = normalizeAddress(a.address);
    const addressB = normalizeAddress(b.address);
    const contactA = normalizeText(a.purchase_contact);
    const contactB = normalizeText(b.purchase_contact);
    const comunaA = normalizeText(a.comuna);
    const comunaB = normalizeText(b.comuna);
    const officeA = normalizeText(a.office);
    const officeB = normalizeText(b.office);
    const sameName = Boolean(nameA && nameA === nameB);
    const sameComuna = Boolean(comunaA && comunaA === comunaB);
    const sameOffice = Boolean(officeA && officeA === officeB);
    const sameAddress = Boolean(addressA && addressA === addressB);
    const sameContact = Boolean(contactA && contactA === contactB);
    if (!sameName) return reasons;

    let nearby = false;
    const latA = a.lat;
    const lngA = a.lng;
    const latB = b.lat;
    const lngB = b.lng;
    if (hasCoordinates(latA, lngA) && hasCoordinates(latB, lngB)) {
        nearby = getDistanceKm(latA as number, lngA as number, latB as number, lngB as number) <= 0.25;
    }

    reasons.push('name');
    if (phoneA && phoneA === phoneB) reasons.push('phone_name');
    if (sameAddress) reasons.push('name_address');
    if (sameContact) reasons.push('name_contact');
    if (sameComuna && (sameOffice || sameAddress)) reasons.push('name_location');
    if (sameComuna && nearby) reasons.push('name_geo');

    return Array.from(new Set(reasons));
};

const getDuplicateScore = (reasons: DuplicateReason[]) => reasons.reduce((score, reason) => {
    switch (reason) {
        case 'name':
            return score + 8;
        case 'phone_name':
            return score + 7;
        case 'name_address':
            return score + 6;
        case 'name_contact':
            return score + 5;
        case 'name_location':
            return score + 4;
        case 'name_geo':
            return score + 4;
        default:
            return score;
    }
}, 0);

const isStrongDuplicate = (reasons: DuplicateReason[]) => reasons.length > 0 && getDuplicateScore(reasons) >= 6;

export const findDuplicateClientInList = (
    incoming: Pick<ClientRow, 'rut' | 'name' | 'email' | 'phone' | 'address' | 'purchase_contact' | 'comuna' | 'office' | 'lat' | 'lng'>,
    clients: ClientRow[],
    excludeIds: string[] = []
): DuplicateMatch | null => {
    let bestMatch: DuplicateMatch | null = null;

    clients.forEach((client) => {
        if (excludeIds.includes(client.id)) return;
        const reasons = compareClientsForDuplicate(incoming, client);
        if (!isStrongDuplicate(reasons)) return;
        const score = getDuplicateScore(reasons) + getClientCompletenessScore(client);
        if (!bestMatch || score > bestMatch.score) {
            bestMatch = { client, reasons, score };
        }
    });

    return bestMatch;
};

export const buildClientConsolidationUpdate = (
    existing: ClientRow,
    incoming: Partial<ClientDraft>
): ClientUpdatePayload => {
    const mergedStatus = getStatusPriority(incoming.status) > getStatusPriority(existing.status)
        ? incoming.status || existing.status
        : existing.status;

    const mergedLat = hasCoordinates(existing.lat, existing.lng)
        ? existing.lat
        : (hasCoordinates(incoming.lat ?? null, incoming.lng ?? null) ? incoming.lat ?? null : null);

    const mergedLng = hasCoordinates(existing.lat, existing.lng)
        ? existing.lng
        : (hasCoordinates(incoming.lat ?? null, incoming.lng ?? null) ? incoming.lng ?? null : null);

    const mergedClient: ClientUpdatePayload = {
        name: pickPreferredString(existing.name, incoming.name) || existing.name,
        rut: pickPreferredString(existing.rut, incoming.rut),
        email: pickPreferredString(existing.email, incoming.email),
        phone: pickPreferredString(existing.phone, incoming.phone),
        address: pickPreferredString(existing.address, incoming.address),
        purchase_contact: pickPreferredString(existing.purchase_contact, incoming.purchase_contact),
        comuna: pickPreferredString(existing.comuna, incoming.comuna),
        office: pickPreferredString(existing.office, incoming.office),
        giro: pickPreferredString(existing.giro, incoming.giro),
        doctor_specialty: pickPreferredString(existing.doctor_specialty, incoming.doctor_specialty),
        zone: pickPreferredString(existing.zone, incoming.zone),
        notes: buildMergedNotes(existing.notes, incoming.notes),
        status: mergedStatus,
        created_by: existing.created_by || incoming.created_by || null,
        pending_seller_email: existing.pending_seller_email || incoming.pending_seller_email || null,
        credit_days: Math.max(existing.credit_days || 0, incoming.credit_days || 0),
        lead_score: pickPreferredNumber(existing.lead_score, incoming.lead_score),
        requires_discount_approval: Boolean(existing.requires_discount_approval || incoming.requires_discount_approval),
        lat: mergedLat,
        lng: mergedLng,
        last_visit_date: pickPreferredString(existing.last_visit_date, incoming.last_visit_date)
    };

    const changedEntries = Object.entries(mergedClient).filter(([key, value]) => {
        return value !== (existing as Record<string, unknown>)[key];
    });

    return Object.fromEntries(changedEntries) as ClientUpdatePayload;
};

export const findPotentialDuplicateClient = async (
    incoming: Pick<ClientRow, 'rut' | 'name' | 'email' | 'phone' | 'address' | 'purchase_contact' | 'comuna' | 'office' | 'lat' | 'lng'>,
    excludeIds: string[] = []
): Promise<DuplicateMatch | null> => {
    const queries: Array<Promise<{ data: ClientRow[] | null; error: any }>> = [];
    const nameTokens = getSearchTokens(incoming.name);

    nameTokens.forEach((token) => {
        queries.push(supabase.from('clients').select('*').ilike('name', `%${escapeLikePattern(token)}%`).limit(40) as any);
    });

    if (queries.length === 0) return null;

    const settled = await Promise.all(queries);
    const candidates = new Map<string, ClientRow>();

    settled.forEach(({ data, error }) => {
        if (error) throw error;
        (data || []).forEach((client) => {
            if (!excludeIds.includes(client.id)) {
                candidates.set(client.id, client);
            }
        });
    });

    return findDuplicateClientInList(incoming, Array.from(candidates.values()), excludeIds);
};

export const saveClientWithDeduplication = async (
    incoming: ClientDraft,
    options?: {
        excludeClientIds?: string[];
        onDuplicate?: 'error' | 'merge' | 'reuse';
    }
): Promise<SaveClientWithDeduplicationResult> => {
    const match = await findPotentialDuplicateClient({
        rut: incoming.rut || null,
        name: incoming.name,
        email: incoming.email || null,
        phone: incoming.phone || null,
        address: incoming.address || null,
        purchase_contact: incoming.purchase_contact || null,
        comuna: incoming.comuna || null,
        office: incoming.office || null,
        lat: incoming.lat ?? null,
        lng: incoming.lng ?? null
    }, options?.excludeClientIds || []);

    if (!match) {
        const insertPayload = { ...incoming, id: incoming.id || crypto.randomUUID() };
        const { data, error } = await (supabase.from('clients') as any)
            .insert(insertPayload)
            .select()
            .single();
        if (error) throw error;
        return { action: 'created', client: data as ClientRow, match: null };
    }

    if (options?.onDuplicate === 'error') {
        throw new Error(`Cliente duplicado detectado: coincide con ${match.client.name} por ${match.reasons.join(', ')}.`);
    }

    if (options?.onDuplicate === 'reuse') {
        return { action: 'reused', client: match.client, match };
    }

    const updatePayload = buildClientConsolidationUpdate(match.client, incoming);
    if (Object.keys(updatePayload).length === 0) {
        return { action: 'reused', client: match.client, match };
    }

    const { data, error } = await (supabase.from('clients') as any)
        .update(updatePayload)
        .eq('id', match.client.id)
        .select()
        .single();
    if (error) throw error;

    return { action: 'merged', client: data as ClientRow, match };
};

const buildUnionFind = (size: number) => {
    const parent = Array.from({ length: size }, (_, index) => index);

    const find = (index: number): number => {
        if (parent[index] !== index) parent[index] = find(parent[index]);
        return parent[index];
    };

    const union = (a: number, b: number) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) parent[rootB] = rootA;
    };

    return { find, union };
};

const choosePrimaryClient = (clients: ClientRow[]) => {
    return [...clients].sort((a, b) => {
        const rutDiff = Number(Boolean(normalizeRut(b.rut))) - Number(Boolean(normalizeRut(a.rut)));
        if (rutDiff !== 0) return rutDiff;

        const completenessDiff = getClientCompletenessScore(b) - getClientCompletenessScore(a);
        if (completenessDiff !== 0) return completenessDiff;

        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })[0];
};

export const computeDuplicateClientGroups = (clients: ClientRow[]): DuplicateClientGroup[] => {
    if (clients.length < 2) return [];
    const unionFind = buildUnionFind(clients.length);
    const reasonsByPair = new Map<string, DuplicateReason[]>();

    for (let index = 0; index < clients.length; index += 1) {
        for (let candidateIndex = index + 1; candidateIndex < clients.length; candidateIndex += 1) {
            const reasons = compareClientsForDuplicate(clients[index], clients[candidateIndex]);
            if (!isStrongDuplicate(reasons)) continue;
            unionFind.union(index, candidateIndex);
            reasonsByPair.set(`${clients[index].id}:${clients[candidateIndex].id}`, reasons);
        }
    }

    const grouped = new Map<number, ClientRow[]>();
    clients.forEach((client, index) => {
        const root = unionFind.find(index);
        const group = grouped.get(root) || [];
        group.push(client);
        grouped.set(root, group);
    });

    return Array.from(grouped.values())
        .filter((group) => group.length > 1)
        .map((group) => {
            const primary = choosePrimaryClient(group);
            const duplicates = group.filter((client) => client.id !== primary.id);
            const reasonsByClientId: Record<string, DuplicateReason[]> = {};

            duplicates.forEach((duplicate) => {
                const pairKey = `${primary.id}:${duplicate.id}`;
                const reversePairKey = `${duplicate.id}:${primary.id}`;
                reasonsByClientId[duplicate.id] = reasonsByPair.get(pairKey)
                    || reasonsByPair.get(reversePairKey)
                    || compareClientsForDuplicate(primary, duplicate);
            });

            return {
                id: [primary.id, ...duplicates.map((duplicate) => duplicate.id)].join(':'),
                primary,
                duplicates,
                reasonsByClientId
            };
        })
        .sort((a, b) => b.duplicates.length - a.duplicates.length);
};

const isRpcMissingError = (error: any) => {
    const message = `${error?.message || ''}`.toLowerCase();
    const code = `${error?.code || ''}`.toUpperCase();
    return code === 'PGRST202' || message.includes('merge_client_duplicates') || message.includes('could not find the function');
};

const isMissingRelationError = (error: any) => {
    const message = `${error?.message || ''}`.toLowerCase();
    const code = `${error?.code || ''}`.toUpperCase();
    return code === '42P01' || message.includes('relation') || message.includes('schema cache');
};

const describeError = (error: unknown): string => {
    if (!error) return 'desconocido';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || error.name || 'desconocido';

    const candidate = error as {
        message?: string;
        details?: string;
        hint?: string;
        code?: string;
        error_description?: string;
    };

    const directMessage = candidate.message
        || candidate.details
        || candidate.hint
        || candidate.error_description
        || candidate.code;

    if (directMessage) return directMessage;

    try {
        const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
        if (serialized && serialized !== '{}') return serialized;
    } catch {
        // noop
    }

    return 'desconocido';
};

const toMergeError = (context: string, error: unknown): Error => new Error(`${context}: ${describeError(error)}`);

const fallbackMergeClientDuplicates = async (primary: ClientRow, duplicates: ClientRow[]) => {
    const duplicateIds = duplicates.map((client) => client.id);
    const finalMergedPayload = duplicates.reduce((accumulator, client) => {
        return { ...accumulator, ...buildClientConsolidationUpdate({ ...primary, ...accumulator } as ClientRow, client) };
    }, {} as ClientUpdatePayload);

    if (Object.keys(finalMergedPayload).length > 0) {
        const { error: primaryUpdateError } = await (supabase.from('clients') as any)
            .update(finalMergedPayload)
            .eq('id', primary.id);
        if (primaryUpdateError) throw primaryUpdateError;
    }

    for (const table of CLIENT_REFERENCE_TABLES) {
        const { error } = await (supabase.from(table) as any)
            .update({ client_id: primary.id })
            .in('client_id', duplicateIds);
        if (error && !isMissingRelationError(error)) throw error;
    }

    const { error: deleteError } = await (supabase.from('clients') as any)
        .delete()
        .in('id', duplicateIds);
    if (deleteError) throw deleteError;

    return {
        merged_into: primary.id,
        duplicate_ids: duplicateIds,
        merged_fields: Object.keys(finalMergedPayload)
    };
};

export const mergeClientDuplicates = async (primary: ClientRow, duplicates: ClientRow[]) => {
    const duplicateIds = duplicates.map((client) => client.id);
    if (duplicateIds.length === 0) {
        throw new Error('No hay clientes duplicados para fusionar.');
    }

    try {
        const { data, error } = await supabase.rpc('merge_client_duplicates', {
            p_primary_client_id: primary.id,
            p_duplicate_client_ids: duplicateIds
        } as any);

        if (error) {
            if (!isRpcMissingError(error)) throw toMergeError('Error al ejecutar merge_client_duplicates', error);

            if (import.meta.env.DEV) {
                try {
                    return await fallbackMergeClientDuplicates(primary, duplicates);
                } catch (fallbackError) {
                    throw toMergeError('Error en fallback de fusión de clientes', fallbackError);
                }
            }

            throw new Error(
                'La base de datos no tiene habilitada la función de fusión de clientes. Falta aplicar en Supabase las migraciones 20260724000136 y 20260724000138.'
            );
        }

        if (!data) {
            throw new Error(
                'La fusión no devolvió resultado desde Supabase. Revisa que la función merge_client_duplicates exista y esté actualizada en la base.'
            );
        }

        return data;
    } catch (error) {
        throw error instanceof Error ? error : toMergeError('Error inesperado al fusionar clientes', error);
    }
};
