import React from 'react';
import { createRoot } from 'react-dom/client';
import OrderDocumentContent from '../components/OrderDocumentContent';

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
    clientCity?: string;
    clientComuna?: string;
    clientContact?: string;
    paymentTerms: string;
    sellerName: string;
    sellerEmail?: string;
    items: OrderPdfItem[];
    totalAmount: number;
    comments?: string;
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

export const generateOrderPdfBlob = async (data: OrderPdfData): Promise<Blob | null> => {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf')
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
    mountNode.className = 'bg-white p-6 md:p-12 shadow-sm w-[1000px]';
    mountNode.style.width = '1000px';
    mountNode.style.background = '#ffffff';

    sandbox.appendChild(mountNode);
    document.body.appendChild(sandbox);

    const root = createRoot(mountNode);

    try {
        root.render(React.createElement(OrderDocumentContent, { data }));
        await waitForNextPaint();
        await waitForImages(mountNode);

        const canvas = await html2canvas(mountNode, {
            scale: renderScale,
            useCORS: true,
            backgroundColor: '#ffffff',
            windowWidth: 1000,
            width: 1000
        });

        const imgData = canvas.toDataURL('image/png');
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [imgWidth, imgHeight],
            compress: true
        });

        pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
        return pdf.output('blob');
    } finally {
        root.unmount();
        document.body.removeChild(sandbox);
    }
};

export const generateOrderPdfFile = async (data: OrderPdfData): Promise<File> => {
    const pdfBlob = await generateOrderPdfBlob(data);

    if (!pdfBlob) {
        throw new Error('No se pudo generar el PDF del pedido.');
    }

    return new File([pdfBlob], `Pedido_Folio_${data.folio}.pdf`, { type: 'application/pdf' });
};
