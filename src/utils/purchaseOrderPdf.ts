import React from 'react';
import { createRoot } from 'react-dom/client';
import PurchaseOrderDocumentContent from '../components/PurchaseOrderDocumentContent';

export type PurchaseOrderPdfItem = {
    sku: string;
    productName: string;
    qty: number;
    unitPrice: number;
    discountAmount: number;
    lineTotal: number;
    lineNotes?: string | null;
};

export type PurchaseOrderPdfData = {
    folio: number | string;
    formattedFolio: string;
    issuedDate: string;
    neededByDate?: string | null;
    supplierName: string;
    supplierEmail: string;
    supplierContact?: string | null;
    supplierPhone?: string | null;
    supplierTaxId?: string | null;
    supplierAddress?: string | null;
    supplierCity?: string | null;
    supplierCountry?: string | null;
    currency: 'CLP' | 'USD';
    createdByName: string;
    createdByEmail?: string | null;
    items: PurchaseOrderPdfItem[];
    subtotal: number;
    totalDiscount: number;
    totalAmount: number;
    generalNotes?: string | null;
};

const waitForNextPaint = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

const waitForImages = async (container: HTMLElement) => {
    const images = Array.from(container.querySelectorAll('img'));
    await Promise.all(
        images.map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
                image.onload = () => resolve();
                image.onerror = () => resolve();
            });
        })
    );
};

export const generatePurchaseOrderPdfBlob = async (data: PurchaseOrderPdfData): Promise<Blob | null> => {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
    ]);
    const renderScale = Math.min(Math.max(window.devicePixelRatio || 1, 3), 4);

    const sandbox = document.createElement('div');
    sandbox.style.position = 'fixed';
    sandbox.style.left = '-20000px';
    sandbox.style.top = '0';
    sandbox.style.width = '1000px';
    sandbox.style.background = '#ffffff';
    sandbox.style.zIndex = '-1';
    sandbox.style.pointerEvents = 'none';

    const mountNode = document.createElement('div');
    mountNode.className = 'bg-white p-6 md:p-12 shadow-sm';
    mountNode.style.width = '1000px';
    mountNode.style.background = '#ffffff';
    mountNode.style.boxSizing = 'border-box';
    mountNode.style.overflow = 'hidden';

    sandbox.appendChild(mountNode);
    document.body.appendChild(sandbox);

    const root = createRoot(mountNode);

    try {
        root.render(React.createElement(PurchaseOrderDocumentContent, { data }));
        await waitForNextPaint();
        await waitForImages(mountNode);

        const canvas = await html2canvas(mountNode, {
            scale: renderScale,
            useCORS: true,
            backgroundColor: '#ffffff',
            windowWidth: 1000,
            width: 1000,
        });

        const imgData = canvas.toDataURL('image/png');
        const pageWidth = 210;
        const horizontalMargin = 10;
        const topMargin = 10;
        const imgWidth = pageWidth - horizontalMargin * 2;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [pageWidth, imgHeight + topMargin * 2],
            compress: true,
        });

        pdf.addImage(imgData, 'PNG', horizontalMargin, topMargin, imgWidth, imgHeight);
        return pdf.output('blob');
    } finally {
        root.unmount();
        document.body.removeChild(sandbox);
    }
};

export const generatePurchaseOrderPdfFile = async (data: PurchaseOrderPdfData): Promise<File> => {
    const pdfBlob = await generatePurchaseOrderPdfBlob(data);

    if (!pdfBlob) {
        throw new Error('No se pudo generar el PDF de la orden de compra.');
    }

    return new File([pdfBlob], `${data.formattedFolio}.pdf`, { type: 'application/pdf' });
};
