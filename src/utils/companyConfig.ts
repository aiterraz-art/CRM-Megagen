export const getCompanyConfig = () => {
    const companyName = String(import.meta.env.VITE_COMPANY_NAME || '').trim() || 'CRM';
    const ownerEmail = String(import.meta.env.VITE_OWNER_EMAIL || '').trim().toLowerCase() || null;
    const companyEmail = String(import.meta.env.VITE_COMPANY_EMAIL || '').trim().toLowerCase() || ownerEmail;
    const collectionsPaymentsEmail = String(import.meta.env.VITE_COLLECTIONS_PAYMENTS_EMAIL || '').trim().toLowerCase()
        || (companyName.toLowerCase().includes('3dental') ? 'pagos@3dental.cl' : companyEmail);

    return {
        companyName,
        companyEmail,
        ownerEmail,
        collectionsPaymentsEmail
    };
};
