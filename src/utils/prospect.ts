export const isProspectStatus = (status: string | null | undefined): boolean => {
    if (!status) return false;
    const normalized = status.toLowerCase();
    return normalized === 'prospect' || normalized.startsWith('prospect_');
};

export const normalizeProspectStatus = (status: string | null | undefined): string | null | undefined => {
    if (!status) return status;
    return status.toLowerCase() === 'prospect' ? 'prospect_new' : status;
};
