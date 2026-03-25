const VAT_RATE = 0.19;

const toSafeNumber = (value: unknown) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const grossToNet = (grossAmount: unknown) => {
    const gross = toSafeNumber(grossAmount);
    if (gross <= 0) return 0;
    return Math.round(gross / (1 + VAT_RATE));
};
