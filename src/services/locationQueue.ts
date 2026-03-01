import { supabase } from './supabase';
import { checkGPSConnection } from '../utils/gps';

interface QuotationLocationPayload {
    seller_id: string;
    quotation_id: string;
    lat: number;
    lng: number;
}

interface VisitCheckinLocationPayload {
    visit_id: string;
    seller_id: string;
    lat?: number;
    lng?: number;
}

interface VisitCheckoutLocationPayload {
    visit_id: string;
    seller_id: string;
    lat?: number;
    lng?: number;
}

type LocationQueueItem = {
    id: string;
    type: 'quotation_location' | 'visit_checkin_location' | 'visit_checkout_location';
    payload: QuotationLocationPayload | VisitCheckinLocationPayload | VisitCheckoutLocationPayload;
    attempts: number;
    created_at: string;
    last_error?: string;
};

const STORAGE_KEY = 'crm_location_queue_v1';
const FLUSH_INTERVAL_MS = 45000;
const MAX_ATTEMPTS = 25;

let workerStarted = false;
let flushInProgress = false;
let flushIntervalId: number | null = null;
let onlineHandler: (() => void) | null = null;

const canUseWindow = () => typeof window !== 'undefined';

const toErrorText = (error: any) => {
    if (!error) return 'unknown_error';
    if (typeof error === 'string') return error;
    return error.message || JSON.stringify(error);
};

const readQueue = (): LocationQueueItem[] => {
    if (!canUseWindow()) return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.warn("Could not parse location queue:", error);
        return [];
    }
};

const writeQueue = (queue: LocationQueueItem[]) => {
    if (!canUseWindow()) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
};

const isDuplicateInsertError = (error: any) => {
    const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
    return text.includes('23505') || text.includes('duplicate key');
};

const insertQuotationLocation = async (payload: QuotationLocationPayload) => {
    const { error } = await supabase
        .from('seller_locations')
        .insert(payload);

    if (error && !isDuplicateInsertError(error)) {
        throw error;
    }
};

const updateVisitCheckinLocation = async (payload: VisitCheckinLocationPayload) => {
    let lat = typeof payload.lat === 'number' ? payload.lat : null;
    let lng = typeof payload.lng === 'number' ? payload.lng : null;

    if (lat === null || lng === null) {
        const pos = await checkGPSConnection({
            showAlert: false,
            timeoutMs: 10000,
            retries: 1,
            minAccuracyMeters: 900
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
    }

    const { error } = await supabase
        .from('visits')
        .update({ lat, lng } as any)
        .eq('id', payload.visit_id);

    if (error) {
        throw error;
    }
};

const updateVisitCheckoutLocation = async (payload: VisitCheckoutLocationPayload) => {
    let lat = typeof payload.lat === 'number' ? payload.lat : null;
    let lng = typeof payload.lng === 'number' ? payload.lng : null;

    if (lat === null || lng === null) {
        const pos = await checkGPSConnection({
            showAlert: false,
            timeoutMs: 10000,
            retries: 1,
            minAccuracyMeters: 900
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
    }

    const { error } = await supabase
        .from('visits')
        .update({ check_out_lat: lat, check_out_lng: lng } as any)
        .eq('id', payload.visit_id);

    if (error) {
        throw error;
    }
};

export const queueQuotationLocation = async (payload: QuotationLocationPayload): Promise<{ sent: boolean; queued: boolean; error?: string }> => {
    try {
        await insertQuotationLocation(payload);
        return { sent: true, queued: false };
    } catch (error: any) {
        const queue = readQueue();
        queue.push({
            id: `${payload.quotation_id}-${Date.now()}`,
            type: 'quotation_location',
            payload,
            attempts: 0,
            created_at: new Date().toISOString(),
            last_error: toErrorText(error)
        });
        writeQueue(queue);
        return { sent: false, queued: true, error: toErrorText(error) };
    }
};

export const queueVisitCheckinLocation = async (
    payload: VisitCheckinLocationPayload
): Promise<{ sent: boolean; queued: boolean; error?: string }> => {
    try {
        await updateVisitCheckinLocation(payload);
        return { sent: true, queued: false };
    } catch (error: any) {
        const queue = readQueue();
        const existingIndex = queue.findIndex((item) => item.type === 'visit_checkin_location' && (item.payload as VisitCheckinLocationPayload).visit_id === payload.visit_id);
        const nextItem: LocationQueueItem = {
            id: `visit-checkin-${payload.visit_id}`,
            type: 'visit_checkin_location',
            payload,
            attempts: existingIndex >= 0 ? queue[existingIndex].attempts : 0,
            created_at: existingIndex >= 0 ? queue[existingIndex].created_at : new Date().toISOString(),
            last_error: toErrorText(error)
        };

        if (existingIndex >= 0) {
            queue[existingIndex] = nextItem;
        } else {
            queue.push(nextItem);
        }

        writeQueue(queue);
        return { sent: false, queued: true, error: toErrorText(error) };
    }
};

export const queueVisitCheckoutLocation = async (
    payload: VisitCheckoutLocationPayload
): Promise<{ sent: boolean; queued: boolean; error?: string }> => {
    try {
        await updateVisitCheckoutLocation(payload);
        return { sent: true, queued: false };
    } catch (error: any) {
        const queue = readQueue();
        const existingIndex = queue.findIndex((item) => item.type === 'visit_checkout_location' && (item.payload as VisitCheckoutLocationPayload).visit_id === payload.visit_id);
        const nextItem: LocationQueueItem = {
            id: `visit-checkout-${payload.visit_id}`,
            type: 'visit_checkout_location',
            payload,
            attempts: existingIndex >= 0 ? queue[existingIndex].attempts : 0,
            created_at: existingIndex >= 0 ? queue[existingIndex].created_at : new Date().toISOString(),
            last_error: toErrorText(error)
        };

        if (existingIndex >= 0) {
            queue[existingIndex] = nextItem;
        } else {
            queue.push(nextItem);
        }

        writeQueue(queue);
        return { sent: false, queued: true, error: toErrorText(error) };
    }
};

const processQueueItem = async (item: LocationQueueItem) => {
    if (item.type === 'quotation_location') {
        await insertQuotationLocation(item.payload as QuotationLocationPayload);
        return;
    }
    if (item.type === 'visit_checkin_location') {
        await updateVisitCheckinLocation(item.payload as VisitCheckinLocationPayload);
        return;
    }
    if (item.type === 'visit_checkout_location') {
        await updateVisitCheckoutLocation(item.payload as VisitCheckoutLocationPayload);
        return;
    }
    throw new Error(`Unsupported queue item type: ${item.type}`);
};

export const flushLocationQueue = async (): Promise<{ processed: number; remaining: number }> => {
    if (!canUseWindow()) return { processed: 0, remaining: 0 };
    if (flushInProgress) return { processed: 0, remaining: readQueue().length };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return { processed: 0, remaining: readQueue().length };
    }

    flushInProgress = true;
    try {
        const queue = readQueue();
        if (queue.length === 0) return { processed: 0, remaining: 0 };

        let processed = 0;
        const remaining: LocationQueueItem[] = [];

        for (const item of queue) {
            try {
                await processQueueItem(item);
                processed += 1;
            } catch (error) {
                const attempts = (item.attempts || 0) + 1;
                const shouldKeepRetrying = item.type === 'visit_checkin_location' || item.type === 'visit_checkout_location' || attempts < MAX_ATTEMPTS;
                if (shouldKeepRetrying) {
                    remaining.push({
                        ...item,
                        attempts,
                        last_error: toErrorText(error)
                    });
                } else {
                    console.warn(`Dropping location queue item after ${attempts} attempts:`, item.id);
                }
            }
        }

        writeQueue(remaining);
        return { processed, remaining: remaining.length };
    } finally {
        flushInProgress = false;
    }
};

export const startLocationQueueWorker = () => {
    if (!canUseWindow() || workerStarted) {
        return () => undefined;
    }

    workerStarted = true;
    onlineHandler = () => {
        void flushLocationQueue();
    };

    window.addEventListener('online', onlineHandler);
    flushIntervalId = window.setInterval(() => {
        void flushLocationQueue();
    }, FLUSH_INTERVAL_MS);

    void flushLocationQueue();

    return () => {
        if (!workerStarted) return;
        workerStarted = false;

        if (onlineHandler) {
            window.removeEventListener('online', onlineHandler);
        }
        onlineHandler = null;

        if (flushIntervalId !== null) {
            window.clearInterval(flushIntervalId);
            flushIntervalId = null;
        }
    };
};
