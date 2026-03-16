export type OrderPdfItem = {
    code?: string;
    detail: string;
    qty: number;
    unit?: string;
    unitPrice?: number;
    total: number;
};

export type OrderPdfData = {
    folio: number | string;
    quotationFolio?: number | null;
    date: string;
    clientName: string;
    clientRut?: string;
    clientAddress?: string;
    clientOffice?: string | null;
    clientPhone?: string;
    clientEmail?: string;
    clientGiro?: string;
    paymentTerms: string;
    sellerName: string;
    sellerEmail?: string;
    items: OrderPdfItem[];
    totalAmount: number;
};

const normalizeCompanyValue = (value?: string | null) => {
    const cleaned = (value || '').trim();
    if (!cleaned) return '';
    const lower = cleaned.toLowerCase();
    if (
        lower === '---'
        || lower === '-'
        || lower === 'n/a'
        || lower === 'na'
        || lower === 'null'
        || lower === 'undefined'
        || lower.includes('por configurar')
    ) {
        return '';
    }
    return cleaned;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-CL')}`;

export const generateOrderPdfFile = async (data: OrderPdfData): Promise<File> => {
    const { default: jsPDF } = await import('jspdf');

    const companyName = normalizeCompanyValue(import.meta.env.VITE_COMPANY_NAME) || '3Dental';
    const companyRut = normalizeCompanyValue(import.meta.env.VITE_COMPANY_RUT) || '76.921-029-6';
    const companyGiro = normalizeCompanyValue(import.meta.env.VITE_COMPANY_GIRO) || 'Clinica e Insumos Dentales';
    const companyAddress = normalizeCompanyValue(import.meta.env.VITE_COMPANY_ADDRESS) || 'Americo Vespucio 2880 of 1403, Conchali';
    const companyPhone = normalizeCompanyValue(import.meta.env.VITE_COMPANY_PHONE) || '';
    const companyEmail = normalizeCompanyValue(import.meta.env.VITE_COMPANY_EMAIL) || 'contacto@3dental.cl';
    const sellerEmail = normalizeCompanyValue(data.sellerEmail) || companyEmail;

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 14;
    let y = 18;

    const addTextBlock = (label: string, value: string) => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(107, 114, 128);
        pdf.text(label.toUpperCase(), margin, y);
        y += 4;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        pdf.setTextColor(17, 24, 39);
        const lines = pdf.splitTextToSize(value || '-', pageWidth - (margin * 2));
        pdf.text(lines, margin, y);
        y += (lines.length * 5) + 3;
    };

    const ensureSpace = (needed: number) => {
        if (y + needed <= pageHeight - 18) return;
        pdf.addPage();
        y = 18;
    };

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(17, 24, 39);
    pdf.text(companyName, margin, y);
    pdf.setFontSize(9);
    pdf.setTextColor(107, 114, 128);
    pdf.text('PEDIDO', pageWidth - margin, y, { align: 'right' });

    y += 6;
    pdf.setDrawColor(226, 232, 240);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 8;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(55, 65, 81);
    pdf.text(`RUT: ${companyRut}`, margin, y);
    pdf.text(`Fecha: ${data.date}`, pageWidth - margin, y, { align: 'right' });
    y += 5;
    pdf.text(companyGiro, margin, y);
    pdf.text(`Pedido #${data.folio}`, pageWidth - margin, y, { align: 'right' });
    y += 5;
    pdf.text(companyAddress, margin, y);
    if (data.quotationFolio) {
        pdf.text(`Cotizacion #${data.quotationFolio}`, pageWidth - margin, y, { align: 'right' });
    }
    y += 5;
    if (companyPhone || companyEmail) {
        pdf.text([companyPhone, companyEmail].filter(Boolean).join(' | '), margin, y);
        y += 6;
    } else {
        y += 2;
    }

    ensureSpace(40);
    addTextBlock('Cliente', data.clientName);
    addTextBlock('RUT', data.clientRut || '-');
    addTextBlock('Direccion', `${data.clientAddress || '-'}${data.clientOffice ? `, Oficina ${data.clientOffice}` : ''}`);
    addTextBlock('Giro', data.clientGiro || '-');
    addTextBlock('Condicion de pago', data.paymentTerms || 'Contado');
    addTextBlock('Vendedor', `${data.sellerName}${sellerEmail ? ` (${sellerEmail})` : ''}`);

    ensureSpace(18);
    pdf.setFillColor(249, 250, 251);
    pdf.rect(margin, y, pageWidth - (margin * 2), 10, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(107, 114, 128);
    pdf.text('CODIGO', margin + 2, y + 6.5);
    pdf.text('DESCRIPCION', margin + 28, y + 6.5);
    pdf.text('CANT.', pageWidth - 58, y + 6.5, { align: 'right' });
    pdf.text('P. UNIT', pageWidth - 34, y + 6.5, { align: 'right' });
    pdf.text('TOTAL', pageWidth - 2 - margin, y + 6.5, { align: 'right' });
    y += 13;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(17, 24, 39);

    data.items.forEach((item) => {
        const descriptionLines = pdf.splitTextToSize(item.detail || '-', 88);
        const itemHeight = Math.max(8, descriptionLines.length * 5 + 3);
        ensureSpace(itemHeight + 4);

        pdf.setFontSize(9);
        pdf.text(item.code || '-', margin + 2, y + 4);
        pdf.text(descriptionLines, margin + 28, y + 4);
        pdf.text(`${item.qty} ${item.unit || 'UN'}`, pageWidth - 58, y + 4, { align: 'right' });
        pdf.text(formatMoney(Number(item.unitPrice || 0)), pageWidth - 34, y + 4, { align: 'right' });
        pdf.text(formatMoney(Number(item.total || 0)), pageWidth - 2 - margin, y + 4, { align: 'right' });
        y += itemHeight;

        pdf.setDrawColor(243, 244, 246);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 4;
    });

    ensureSpace(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(79, 70, 229);
    pdf.text(`Total pedido: ${formatMoney(Number(data.totalAmount || 0))}`, pageWidth - margin, y, { align: 'right' });

    y += 12;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(107, 114, 128);
    pdf.text('Documento generado desde CRM 3Dental.', margin, y);

    const pdfBlob = pdf.output('blob');
    return new File([pdfBlob], `Pedido_Folio_${data.folio}.pdf`, { type: 'application/pdf' });
};
