export const LOST_REASON_REFRESH_EVENT = 'crm:lost-reason-updated';

export const hasLostReason = (value: string | null | undefined) =>
    String(value || '').trim().length > 0;

export const countPendingLostReasons = <T extends { lost_reason?: string | null }>(rows: T[]) =>
    rows.filter((row) => !hasLostReason(row.lost_reason)).length;

export const notifyLostReasonUpdated = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LOST_REASON_REFRESH_EVENT));
};
