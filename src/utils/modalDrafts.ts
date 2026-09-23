export interface PersistedModalDraft<T> {
    isOpen?: boolean;
    data: T;
    updatedAt?: string;
}

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

/** Antiguedad maxima por defecto de un borrador: un dia. */
export const DEFAULT_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Indica si un borrador sigue vigente.
 *
 * Los borradores caducan para que uno olvidado no reaparezca dias despues delante de
 * otra persona ni se confunda con trabajo en curso. Un borrador sin marca de tiempo
 * proviene de una version anterior del formato y se da por vigente.
 */
export const isPersistedDraftFresh = (
    draft: Pick<PersistedModalDraft<unknown>, 'updatedAt'> | null,
    maxAgeMs: number = DEFAULT_DRAFT_MAX_AGE_MS
): boolean => {
    if (!draft) return false;
    if (!draft.updatedAt) return true;

    const savedAt = new Date(draft.updatedAt).getTime();
    if (Number.isNaN(savedAt)) return true;

    return Date.now() - savedAt <= maxAgeMs;
};

export const loadPersistedModalDraft = <T>(storageKey: string): PersistedModalDraft<T> | null => {
    if (!storageKey || !canUseStorage()) return null;

    try {
        const rawValue = window.localStorage.getItem(storageKey);
        if (!rawValue) return null;

        const parsedValue = JSON.parse(rawValue) as PersistedModalDraft<T> | T;
        if (
            parsedValue
            && typeof parsedValue === 'object'
            && 'data' in (parsedValue as Record<string, unknown>)
        ) {
            return parsedValue as PersistedModalDraft<T>;
        }

        return {
            isOpen: true,
            data: parsedValue as T
        };
    } catch (error) {
        console.error('No se pudo restaurar el borrador del modal:', error);
        window.localStorage.removeItem(storageKey);
        return null;
    }
};

export const savePersistedModalDraft = <T>(storageKey: string, data: T, isOpen = true) => {
    if (!storageKey || !canUseStorage()) return;

    const payload: PersistedModalDraft<T> = {
        isOpen,
        data,
        updatedAt: new Date().toISOString()
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));
};

export const clearPersistedModalDraft = (storageKey: string) => {
    if (!storageKey || !canUseStorage()) return;
    window.localStorage.removeItem(storageKey);
};
