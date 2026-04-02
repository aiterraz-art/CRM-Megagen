type SizeChangeFormLineDraft = {
    localId: string;
    productId: string;
    productSearch: string;
    qty: number;
    unitPrice: number;
};

export type SizeChangeFormDraft = {
    clientId: string;
    clientSearch: string;
    sellerId: string;
    requestComment: string;
    lines: SizeChangeFormLineDraft[];
};

export type SizeChangeModalDraft = {
    actorId: string;
    modal: 'detail' | 'form' | 'action';
    selectedRequestId?: string | null;
    editingRequestId?: string | null;
    actionType?: 'send' | 'close' | 'cancel' | null;
    actionRequestId?: string | null;
    actionNote?: string;
    formMode?: 'create' | 'edit';
    formDraft?: SizeChangeFormDraft | null;
    updatedAt: string;
};

const STORAGE_KEY = 'size_change_modal_draft';

export const loadSizeChangeModalDraft = (): SizeChangeModalDraft | null => {
    if (typeof window === 'undefined') return null;

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<SizeChangeModalDraft>;
        if (!parsed.actorId || !parsed.modal) {
            window.localStorage.removeItem(STORAGE_KEY);
            return null;
        }
        return {
            actorId: String(parsed.actorId),
            modal: parsed.modal,
            selectedRequestId: parsed.selectedRequestId ? String(parsed.selectedRequestId) : null,
            editingRequestId: parsed.editingRequestId ? String(parsed.editingRequestId) : null,
            actionType: parsed.actionType || null,
            actionRequestId: parsed.actionRequestId ? String(parsed.actionRequestId) : null,
            actionNote: typeof parsed.actionNote === 'string' ? parsed.actionNote : '',
            formMode: parsed.formMode === 'edit' ? 'edit' : 'create',
            formDraft: parsed.formDraft ? {
                clientId: String(parsed.formDraft.clientId || ''),
                clientSearch: String(parsed.formDraft.clientSearch || ''),
                sellerId: String(parsed.formDraft.sellerId || ''),
                requestComment: String(parsed.formDraft.requestComment || ''),
                lines: Array.isArray(parsed.formDraft.lines)
                    ? parsed.formDraft.lines.map((line) => ({
                        localId: String(line.localId || ''),
                        productId: String(line.productId || ''),
                        productSearch: String(line.productSearch || ''),
                        qty: Number(line.qty || 0),
                        unitPrice: Number(line.unitPrice || 0),
                    }))
                    : [],
            } : null,
            updatedAt: String(parsed.updatedAt || ''),
        };
    } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
    }
};

export const saveSizeChangeModalDraft = (draft: SizeChangeModalDraft) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
};

export const clearSizeChangeModalDraft = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(STORAGE_KEY);
};
