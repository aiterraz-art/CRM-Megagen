import React from 'react';
import { createRoot } from 'react-dom/client';
import type { QuotationPreviewData } from './quotationPreview';
import QuotationDocumentContent from '../components/QuotationDocumentContent';

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

export const generateQuotationPdfBlob = async (data: QuotationPreviewData): Promise<Blob | null> => {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf')
    ]);

    const sandbox = document.createElement('div');
    sandbox.style.position = 'fixed';
    sandbox.style.left = '-20000px';
    sandbox.style.top = '0';
    sandbox.style.width = '1000px';
    sandbox.style.background = '#ffffff';
    sandbox.style.zIndex = '-1';
    sandbox.style.pointerEvents = 'none';

    const mountNode = document.createElement('div');
    mountNode.className = 'bg-white p-6 md:p-12 shadow-sm w-[1000px]';
    mountNode.style.width = '1000px';
    mountNode.style.background = '#ffffff';

    sandbox.appendChild(mountNode);
    document.body.appendChild(sandbox);

    const root = createRoot(mountNode);

    try {
        root.render(React.createElement(QuotationDocumentContent, { data }));
        await waitForNextPaint();
        await waitForImages(mountNode);

        const canvas = await html2canvas(mountNode, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            windowWidth: 1000,
            width: 1000
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [imgWidth, imgHeight],
            compress: true
        });

        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight, undefined, 'FAST');
        return pdf.output('blob');
    } finally {
        root.unmount();
        document.body.removeChild(sandbox);
    }
};

export const generateQuotationPdfFile = async (data: QuotationPreviewData): Promise<File> => {
    const pdfBlob = await generateQuotationPdfBlob(data);

    if (!pdfBlob) {
        throw new Error('No se pudo generar el PDF de la cotización.');
    }

    return new File([pdfBlob], `Cotizacion_Folio_${data.folio}.pdf`, { type: 'application/pdf' });
};
