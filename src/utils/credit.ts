export const getClientCreditDays = (client: { credit_days?: number | null } | null | undefined): number =>
    Math.max(0, Math.trunc(Number(client?.credit_days || 0)));

export const getPaymentTermsFromCreditDays = (creditDays: number) =>
    creditDays > 0
        ? { type: 'Crédito' as const, days: creditDays }
        : { type: 'Contado' as const, days: 0 };

export const formatPaymentTermsFromCreditDays = (creditDays: number) =>
    creditDays > 0 ? `Crédito ${creditDays} Días` : 'Contado';
