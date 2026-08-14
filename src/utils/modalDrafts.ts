export interface PersistedModalDraft<T> {
    isOpen?: boolean;
    data: T;
    updatedAt?: string;
}

const canUseStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

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
