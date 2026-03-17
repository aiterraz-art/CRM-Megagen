export const getCompanyConfig = () => {
    const companyName = String(import.meta.env.VITE_COMPANY_NAME || '').trim() || 'CRM';
    const ownerEmail = String(import.meta.env.VITE_OWNER_EMAIL || '').trim().toLowerCase() || null;
    const companyEmail = String(import.meta.env.VITE_COMPANY_EMAIL || '').trim().toLowerCase() || ownerEmail;

    return {
        companyName,
        companyEmail,
        ownerEmail
    };
};
