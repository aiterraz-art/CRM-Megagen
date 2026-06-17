import { CollectionInvoiceSummary } from './collectionsLinking';

export type CollectionDebtPdfData = {
    clientName: string;
    clientRut: string;
    sellerName?: string | null;
    sellerEmail?: string | null;
    generatedAt: string;
    overdueInvoices: CollectionInvoiceSummary[];
};

const formatMoney = (value: number | null | undefined) =>
    `$${Number(value || 0).toLocaleString('es-CL')}`;

const formatDate = (value: string | null | undefined) => {
    if (!value) return '-';
    return new Date(value).toLocaleDateString('es-CL');
};

const sanitizeFileName = (value: string) =>
    String(value || 'cliente')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '_');

export const generateCollectionDebtPdfFile = async (data: CollectionDebtPdfData): Promise<File> => {
    const { default: jsPDF } = await import('jspdf');

    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const marginX = 14;
    const contentWidth = pageWidth - marginX * 2;
    let cursorY = 18;

    const ensurePage = (neededHeight = 8) => {
        if (cursorY + neededHeight <= pageHeight - 14) return;
        pdf.addPage();
        cursorY = 18;
    };

    const writeLabelValue = (label: string, value: string) => {
        ensurePage(10);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.text(label, marginX, cursorY);
        pdf.setFont('helvetica', 'normal');
        const lines = pdf.splitTextToSize(value || '-', contentWidth - 36);
        pdf.text(lines, marginX + 36, cursorY);
        cursorY += Math.max(6, lines.length * 5);
    };

    const overdueTotal = data.overdueInvoices.reduce((total, invoice) => total + Number(invoice.outstanding_amount || 0), 0);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('Resumen de Facturas Vencidas', marginX, cursorY);
    cursorY += 8;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(import.meta.env.VITE_COMPANY_NAME || 'CRM', marginX, cursorY);
    cursorY += 8;

    writeLabelValue('Cliente:', data.clientName);
    writeLabelValue('RUT:', data.clientRut || '-');
    writeLabelValue('Vendedor:', data.sellerName || data.sellerEmail || 'Sin vendedor');
    writeLabelValue('Generado:', new Date(data.generatedAt).toLocaleString('es-CL'));
    writeLabelValue('Facturas vencidas:', String(data.overdueInvoices.length));
    writeLabelValue('Deuda vencida total:', formatMoney(overdueTotal));

    cursorY += 3;
    ensurePage(12);
    pdf.setDrawColor(220, 220, 220);
    pdf.line(marginX, cursorY, pageWidth - marginX, cursorY);
    cursorY += 7;

    data.overdueInvoices.forEach((invoice, index) => {
        const noteLines = invoice.seller_comment
            ? pdf.splitTextToSize(`Descargo: ${invoice.seller_comment}`, contentWidth - 4)
            : [];

        const blockHeight = 28 + noteLines.length * 5;
        ensurePage(blockHeight);

        pdf.setFillColor(248, 250, 252);
        pdf.roundedRect(marginX, cursorY - 4, contentWidth, blockHeight, 3, 3, 'F');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text(`${index + 1}. Documento ${invoice.document_number || 'Sin número'}`, marginX + 4, cursorY + 2);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9.5);
        pdf.text(`Emisión: ${formatDate(invoice.issue_date)}`, marginX + 4, cursorY + 9);
        pdf.text(`Vencimiento: ${formatDate(invoice.due_date)}`, marginX + 62, cursorY + 9);
        pdf.text(`Estado: ${invoice.status || 'Pendiente'}`, marginX + 122, cursorY + 9);

        pdf.text(`Monto: ${formatMoney(invoice.amount)}`, marginX + 4, cursorY + 16);
        pdf.text(`Saldo: ${formatMoney(invoice.outstanding_amount)}`, marginX + 62, cursorY + 16);
        pdf.text(`Mora: ${invoice.aging_days} días`, marginX + 122, cursorY + 16);

        if (noteLines.length > 0) {
            pdf.text(noteLines, marginX + 4, cursorY + 23);
        }

        cursorY += blockHeight + 4;
    });

    const fileName = `facturas_vencidas_${sanitizeFileName(data.clientRut || data.clientName)}.pdf`;
    const blob = pdf.output('blob');
    return new File([blob], fileName, { type: 'application/pdf' });
};
