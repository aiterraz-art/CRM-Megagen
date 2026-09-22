import { useCallback, useEffect, useRef, useState } from 'react';
import {
    clearPersistedModalDraft,
    loadPersistedModalDraft,
    savePersistedModalDraft
} from '../utils/modalDrafts';

/**
 * Estado de formulario que sobrevive a una recarga real de la pagina.
 *
 * Al cerrar la aplicacion en el movil, o cuando el navegador descarta una pestana en
 * segundo plano, el documento se destruye y el estado de React se pierde. Este hook
 * conserva el contenido del formulario en el almacenamiento local y lo restaura al
 * volver, de modo que el usuario no pierda lo que estaba escribiendo.
 *
 * Usa el mismo formato de borrador que los modales del CRM, por lo que ambos
 * mecanismos son intercambiables.
 */

/** Los borradores caducan para que uno olvidado no reaparezca dias despues. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type PersistentFormControls = {
    /** Descarta el borrador y devuelve el formulario a su valor inicial. */
    clear: () => void;
    /** Indica si el contenido actual proviene de un borrador restaurado. */
    hasRestoredDraft: boolean;
    /** Estado de apertura que tenia el formulario al guardarse, para poder reabrirlo. */
    restoredIsOpen: boolean;
};

export type PersistentFormOptions = {
    /** Se persiste junto al contenido para poder reabrir el panel o modal que lo aloja. */
    isOpen?: boolean;
    /** Antiguedad maxima admitida del borrador. Por defecto 24 horas. */
    maxAgeMs?: number;
};

const isDraftFresh = (updatedAt: string | undefined, maxAgeMs: number) => {
    if (!updatedAt) return true;

    const savedAt = new Date(updatedAt).getTime();
    if (Number.isNaN(savedAt)) return true;

    return Date.now() - savedAt <= maxAgeMs;
};

export const usePersistentFormState = <T,>(
    // Admite null mientras la clave no pueda construirse todavia, por ejemplo si aun no
    // se conoce el usuario. Mientras tanto el hook se comporta como un useState normal.
    storageKey: string | null,
    createInitialValue: () => T,
    options: PersistentFormOptions = {}
): [T, React.Dispatch<React.SetStateAction<T>>, PersistentFormControls] => {
    const { isOpen, maxAgeMs = DEFAULT_MAX_AGE_MS } = options;

    const [value, setValue] = useState<T>(createInitialValue);
    const [hasRestoredDraft, setHasRestoredDraft] = useState(false);
    const [restoredIsOpen, setRestoredIsOpen] = useState(false);

    // Evita guardar antes de haber leido el borrador: hacerlo sobrescribiria el
    // contenido almacenado con el valor inicial vacio del formulario.
    const hydratedKeyRef = useRef<string | null>(null);
    const createInitialValueRef = useRef(createInitialValue);
    createInitialValueRef.current = createInitialValue;

    useEffect(() => {
        if (!storageKey || hydratedKeyRef.current === storageKey) return;

        hydratedKeyRef.current = storageKey;

        const savedDraft = loadPersistedModalDraft<T>(storageKey);

        if (!savedDraft || !isDraftFresh(savedDraft.updatedAt, maxAgeMs)) {
            if (savedDraft) clearPersistedModalDraft(storageKey);
            setHasRestoredDraft(false);
            setRestoredIsOpen(false);
            return;
        }

        setValue(savedDraft.data);
        setHasRestoredDraft(true);
        setRestoredIsOpen(savedDraft.isOpen !== false);
    }, [storageKey, maxAgeMs]);

    useEffect(() => {
        if (!storageKey || hydratedKeyRef.current !== storageKey) return;

        savePersistedModalDraft(storageKey, value, isOpen !== false);
    }, [storageKey, value, isOpen]);

    const clear = useCallback(() => {
        if (storageKey) clearPersistedModalDraft(storageKey);
        setHasRestoredDraft(false);
        setRestoredIsOpen(false);
        setValue(createInitialValueRef.current());
    }, [storageKey]);

    return [value, setValue, { clear, hasRestoredDraft, restoredIsOpen }];
};
