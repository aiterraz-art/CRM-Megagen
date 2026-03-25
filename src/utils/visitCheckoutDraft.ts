export type VisitCheckoutDraft = {
    visitId: string;
    isOpen: boolean;
    notes: string;
    leadScore: number | null;
    clientEmail: string;
    doctorName: string;
    doctorSpecialty: string;
    updatedAt: string;
};

const STORAGE_PREFIX = 'visit_checkout_draft';

const getStorageKey = (visitId: string) => `${STORAGE_PREFIX}:${visitId}`;

export const loadVisitCheckoutDraft = (visitId: string): VisitCheckoutDraft | null => {
    if (typeof window === 'undefined' || !visitId) return null;

    try {
        const raw = window.localStorage.getItem(getStorageKey(visitId));
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<VisitCheckoutDraft>;
        return {
            visitId,
            isOpen: Boolean(parsed.isOpen),
            notes: String(parsed.notes || ''),
            leadScore: typeof parsed.leadScore === 'number' ? parsed.leadScore : null,
            clientEmail: String(parsed.clientEmail || ''),
            doctorName: String(parsed.doctorName || ''),
            doctorSpecialty: String(parsed.doctorSpecialty || ''),
            updatedAt: String(parsed.updatedAt || '')
        };
    } catch (error) {
        console.error('Error restoring visit checkout draft:', error);
        window.localStorage.removeItem(getStorageKey(visitId));
        return null;
    }
};

export const saveVisitCheckoutDraft = (draft: VisitCheckoutDraft) => {
    if (typeof window === 'undefined' || !draft.visitId) return;

    try {
        window.localStorage.setItem(getStorageKey(draft.visitId), JSON.stringify(draft));
    } catch (error) {
        console.error('Error saving visit checkout draft:', error);
    }
};

export const clearVisitCheckoutDraft = (visitId: string) => {
    if (typeof window === 'undefined' || !visitId) return;

    try {
        window.localStorage.removeItem(getStorageKey(visitId));
    } catch (error) {
        console.error('Error clearing visit checkout draft:', error);
    }
};
