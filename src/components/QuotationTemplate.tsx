import React from 'react';
import { createPortal } from 'react-dom';
import { Printer, Download, X, Share2, Loader2, MessageSquare } from 'lucide-react';
import type { QuotationPreviewData } from '../utils/quotationPreview';
import { sendQuotationEmail } from '../utils/quotationEmail';
import QuotationDocumentContent, { buildQuotationDocumentViewModel } from './QuotationDocumentContent';

interface Props {
    data: QuotationPreviewData;
    onClose: () => void;
    canShareAndDownload?: boolean;
    shareBlockReason?: string;
    onMarkedAsSent?: (action: 'share' | 'download') => Promise<void> | void;
    onSendEmail?: (pdfAttachment?: File) => Promise<void> | void;
    readOnly?: boolean;
}

const QuotationTemplate: React.FC<Props> = ({ data, onClose, canShareAndDownload = true, shareBlockReason, onMarkedAsSent, onSendEmail, readOnly = false }) => {
    const contentRef = React.useRef<HTMLDivElement>(null);
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const [generatingPdf, setGeneratingPdf] = React.useState(false);
    const [previewScale, setPreviewScale] = React.useState(1);
    const [previewHeight, setPreviewHeight] = React.useState(1400);
    const [zoomMultiplier, setZoomMultiplier] = React.useState(1);
    const viewModel = React.useMemo(() => buildQuotationDocumentViewModel(data), [data]);
    const { companyName, items, total } = viewModel;

    const generateCurrentPreviewPdfBlob = React.useCallback(async (): Promise<Blob | null> => {
        if (!contentRef.current) return null;

        try {
            const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
                import('html2canvas'),
                import('jspdf')
            ]);
            const renderScale = Math.min(Math.max(window.devicePixelRatio || 1, 3), 4);
            const captureWidth = 1000;
            const sourceNode = contentRef.current;
            const sandbox = document.createElement('div');
            sandbox.style.position = 'fixed';
            sandbox.style.left = '-20000px';
            sandbox.style.top = '0';
            sandbox.style.width = `${captureWidth}px`;
            sandbox.style.background = '#ffffff';
            sandbox.style.padding = '0';
            sandbox.style.zIndex = '-1';

            const clonedNode = sourceNode.cloneNode(true) as HTMLDivElement;
            clonedNode.style.position = 'static';
            clonedNode.style.left = '0';
            clonedNode.style.top = '0';
            clonedNode.style.transform = 'none';
            clonedNode.style.transformOrigin = 'top left';
            clonedNode.style.width = `${captureWidth}px`;
            clonedNode.style.margin = '0';
            clonedNode.style.padding = '';
            clonedNode.style.boxSizing = 'border-box';
            clonedNode.style.background = '#ffffff';

            sandbox.appendChild(clonedNode);
            document.body.appendChild(sandbox);

            const images = Array.from(clonedNode.querySelectorAll('img'));
            await Promise.all(
                images.map((image) => {
                    if (image.complete) return Promise.resolve();
                    return new Promise<void>((resolve) => {
                        image.onload = () => resolve();
                        image.onerror = () => resolve();
                    });
                })
            );

            const canvas = await html2canvas(clonedNode, {
                scale: renderScale,
                useCORS: true,
                backgroundColor: '#ffffff',
                windowWidth: captureWidth,
                width: captureWidth
            });

            document.body.removeChild(sandbox);

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
        } catch (error) {
            console.error('Error generating PDF blob from preview:', error);
            return null;
        }
    }, []);

    const normalizePhoneForWhatsapp = (raw: string): string | null => {
        const digits = raw.replace(/\D/g, '');
        if (!digits) return null;
        if (digits.startsWith('569') && digits.length >= 11) return digits;
        if (digits.startsWith('56') && digits.length >= 10) return digits;
        if (digits.startsWith('9') && digits.length === 9) return `56${digits}`;
        return null;
    };

    const buildQuoteMessage = () =>
        `Hola, te comparto la cotización Folio Nº ${data.folio} de ${import.meta.env.VITE_COMPANY_NAME || 'Megagen Chile'}.\n\nTotal: $${total.toLocaleString('es-CL')}\nVendedor: ${data.sellerName}\nCliente: ${data.clientName}`;

    const markAsSentSafely = async (action: 'share' | 'download') => {
        if (!onMarkedAsSent) return;
        try {
            await onMarkedAsSent(action);
        } catch (markError) {
            console.warn('No se pudo marcar la cotización como enviada:', markError);
        }
    };

    const handleSendWhatsApp = async () => {
        if (!canShareAndDownload) {
            alert('Esta cotización debe estar aprobada para poder enviarse.');
            return;
        }
        const normalizedPhone = normalizePhoneForWhatsapp(data.clientPhone || '');
        if (!normalizedPhone) {
            alert('El cliente no tiene un celular válido para WhatsApp.');
            return;
        }
        const url = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(buildQuoteMessage())}`;
        window.open(url, '_blank', 'noopener,noreferrer');
        await markAsSentSafely('share');
    };

    const handleSendEmail = async () => {
        if (!canShareAndDownload) {
            alert('Esta cotización debe estar aprobada para poder enviarse.');
            return;
        }
        if (onSendEmail) {
            setGeneratingPdf(true);
            try {
                const pdfBlob = await generateCurrentPreviewPdfBlob();
                if (!pdfBlob) {
                    throw new Error('No se pudo generar el PDF actual de la cotización.');
                }
                const pdfFile = new File([pdfBlob], `Cotizacion_Folio_${data.folio}.pdf`, { type: 'application/pdf' });
                await onSendEmail(pdfFile);
            } finally {
                setGeneratingPdf(false);
            }
            return;
        }
        const recipient = String(data.clientEmail || '').trim();
        if (!recipient) {
            alert('El cliente no tiene email registrado.');
            return;
        }
        try {
            await sendQuotationEmail({
                quotation: data,
                recipient
            });
            await markAsSentSafely('share');
            alert('Correo enviado correctamente con el PDF adjunto.');
        } catch (error: any) {
            alert(error?.message || 'No se pudo enviar el correo con la cotización adjunta.');
        }
    };

    const handleShare = async () => {
        if (!canShareAndDownload) {
            alert('Esta cotización debe estar aprobada para poder enviarse.');
            return;
        }
        setGeneratingPdf(true);
        try {
            let shared = false;
            const pdfBlob = await generateCurrentPreviewPdfBlob();
            if (!pdfBlob) return;

            const file = new File([pdfBlob], `Cotizacion_${data.folio}.pdf`, { type: 'application/pdf' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: `Cotización ${data.folio}`,
                    text: `Adjunto cotización formal Folio Nº ${data.folio} de ${import.meta.env.VITE_COMPANY_NAME || 'Megagen Chile'}.`,
                });
                shared = true;
            } else {
                // Fallback to text share if files are not supported
                const shareText = `Estimado(a) ${data.clientName},\n\nLe adjunto la cotización Folio Nº ${data.folio} de ${import.meta.env.VITE_COMPANY_NAME || 'Megagen Chile'}.\n\nTotal: $${total.toLocaleString()}\nVendedor: ${data.sellerName}\n\nGracias por su confianza.`;
                const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
                window.open(waUrl, '_blank');
                shared = true;
            }

            if (shared) await markAsSentSafely('share');
        } catch (err) {
            console.error('Error sharing:', err);
        } finally {
            setGeneratingPdf(false);
        }
    };

    const handleDownloadPDF = async () => {
        if (!canShareAndDownload) {
            alert('Esta cotización debe estar aprobada para poder descargarse.');
            return;
        }
        setGeneratingPdf(true);
        try {
            const pdfBlob = await generateCurrentPreviewPdfBlob();
            if (pdfBlob) {
                const url = URL.createObjectURL(pdfBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `Cotizacion_Folio_${data.folio}.pdf`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                await markAsSentSafely('download');
            }
        } catch (error) {
            console.error("Error downloading PDF:", error);
            alert("Error generando PDF. Intente imprimir como PDF.");
        } finally {
            setGeneratingPdf(false);
        }
    };

    React.useEffect(() => {
        const recomputeScale = () => {
            const viewport = viewportRef.current;
            const content = contentRef.current;
            if (!viewport || !content) return;

            const availableWidth = viewport.clientWidth - 24;
            const availableHeight = viewport.clientHeight - 24;
            const contentWidth = content.offsetWidth || 1000;
            const contentHeight = content.scrollHeight || content.offsetHeight || 1400;

            const widthScale = availableWidth / contentWidth;
            const heightScale = availableHeight / contentHeight;
            const nextScale = Math.min(widthScale, heightScale, 1);

            setPreviewScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1);
            setPreviewHeight(contentHeight);
        };

        const frame = window.requestAnimationFrame(recomputeScale);
        window.addEventListener('resize', recomputeScale);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', recomputeScale);
        };
    }, [data, canShareAndDownload, generatingPdf, items.length, data.comments]);

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const effectiveScale = clamp(previewScale * zoomMultiplier, 0.2, 3);
    const zoomPercent = Math.round(effectiveScale * 100);

    const modalContent = (
        <div
            className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-2 md:p-3 overflow-y-auto cursor-pointer"
            onClick={onClose} // Close on backdrop click
        >
            <div
                className="relative bg-white w-[96vw] max-w-[1700px] shadow-2xl rounded-lg flex min-h-0 flex-col h-[100dvh] max-h-[100dvh] overflow-hidden animate-in fade-in zoom-in duration-300 cursor-default md:h-[98vh] md:max-h-[98vh]"
                onClick={(e) => e.stopPropagation()} // Prevent close on content click
            >

                <div className="border-b bg-gray-100 print:hidden md:hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-4">
                        <h3 className="text-sm font-bold text-gray-700">Visualización de Cotización</h3>
                        <button onClick={onClose} className="shrink-0 rounded-full p-2 text-gray-400 transition-all hover:bg-gray-200">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="hidden border-b bg-gray-100 print:hidden md:block">
                    <div className="flex items-center justify-between gap-3 px-4 pt-4">
                        <h3 className="text-base font-bold text-gray-700">Visualización de Cotización</h3>
                        <button onClick={onClose} className="shrink-0 rounded-full p-2 text-gray-400 transition-all hover:bg-gray-200">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="space-y-3 px-4 pb-4 pt-3">
                        {!readOnly && (
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={handleSendWhatsApp}
                                    disabled={!canShareAndDownload || generatingPdf || !normalizePhoneForWhatsapp(data.clientPhone || '')}
                                    className="flex shrink-0 items-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={normalizePhoneForWhatsapp(data.clientPhone || '') ? 'Enviar por WhatsApp' : 'Cliente sin celular válido'}
                                >
                                    <MessageSquare size={16} className="mr-2" /> WhatsApp
                                </button>
                                <button
                                    onClick={handleSendEmail}
                                    disabled={!canShareAndDownload || generatingPdf || !String(data.clientEmail || '').trim()}
                                    className="flex shrink-0 items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    title={String(data.clientEmail || '').trim() ? 'Compartir PDF con correo como respaldo' : 'Cliente sin correo'}
                                >
                                    <Share2 size={16} className="mr-2" /> Compartir
                                </button>
                                <button
                                    onClick={handleShare}
                                    disabled={!canShareAndDownload || generatingPdf}
                                    className="flex shrink-0 items-center rounded-lg bg-green-500 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="Abrir más opciones para compartir"
                                >
                                    <Share2 size={16} className="mr-2" /> Más opciones
                                </button>
                                <button onClick={() => window.print()} className="flex shrink-0 items-center rounded-lg border bg-white px-4 py-2 text-sm font-bold transition-all hover:bg-gray-50">
                                    <Printer size={16} className="mr-2" /> Imprimir
                                </button>
                                <button
                                    onClick={handleDownloadPDF}
                                    disabled={generatingPdf || !canShareAndDownload}
                                    className="flex shrink-0 items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {generatingPdf ? (
                                        <Loader2 size={16} className="mr-2 animate-spin" />
                                    ) : (
                                        <Download size={16} className="mr-2" />
                                    )}
                                    PDF
                                </button>
                            </div>
                        )}

                        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-white px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <button
                                onClick={() => setZoomMultiplier((prev) => clamp(prev / 1.1, 0.2, 6))}
                                className="px-2 py-1 text-sm font-black text-gray-600 hover:bg-gray-100 rounded"
                                title="Alejar"
                            >
                                -
                            </button>
                            <span className="min-w-[52px] text-center text-xs font-black text-gray-500">{zoomPercent}%</span>
                            <button
                                onClick={() => setZoomMultiplier((prev) => clamp(prev * 1.1, 0.2, 6))}
                                className="px-2 py-1 text-sm font-black text-gray-600 hover:bg-gray-100 rounded"
                                title="Acercar"
                            >
                                +
                            </button>
                            <button
                                onClick={() => setZoomMultiplier(1)}
                                className="px-2 py-1 text-[10px] font-black text-gray-600 hover:bg-gray-100 rounded uppercase"
                                title="Ajustar a pantalla"
                            >
                                Ajustar
                            </button>
                            <button
                                onClick={() => setZoomMultiplier(previewScale > 0 ? clamp(1 / previewScale, 0.2, 6) : 1)}
                                className="px-2 py-1 text-[10px] font-black text-gray-600 hover:bg-gray-100 rounded uppercase"
                                title="Zoom real 100%"
                            >
                                100%
                            </button>
                        </div>
                    </div>
                </div>
                {!readOnly && !canShareAndDownload && (
                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-amber-700 text-xs font-bold print:hidden">
                        {shareBlockReason || 'Esta cotización no se puede enviar ni descargar todavía.'}
                    </div>
                )}

                {/* Contenedor con escalado dinámico */}
                <div
                    ref={viewportRef}
                    className="min-h-0 w-full flex-1 overflow-auto bg-gray-50 p-1 pb-24 flex items-start justify-start md:items-center md:justify-center md:pb-1"
                >
                    <div
                        style={{
                            width: `${1000 * effectiveScale}px`,
                            height: `${previewHeight * effectiveScale}px`,
                            transition: 'width 120ms ease-out, height 120ms ease-out'
                        }}
                        className="relative"
                    >
                        <div
                            ref={contentRef}
                            // @ts-ignore
                            ref-content-container="true"
                            className="bg-white p-6 md:p-12 shadow-sm w-[1000px]"
                            style={{
                                transform: `scale(${effectiveScale})`,
                                transformOrigin: 'top left',
                                position: 'absolute',
                                top: 0,
                                left: 0
                            }}
                        >
                            <QuotationDocumentContent data={data} />
                        </div>
                </div>
                </div>

                {!readOnly && (
                    <div className="absolute inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 border-t bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[0_-8px_24px_rgba(15,23,42,0.12)] print:hidden md:hidden">
                        <button
                            onClick={handleSendWhatsApp}
                            disabled={!canShareAndDownload || generatingPdf || !normalizePhoneForWhatsapp(data.clientPhone || '')}
                            className="flex min-h-[42px] items-center justify-center rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title={normalizePhoneForWhatsapp(data.clientPhone || '') ? 'Enviar por WhatsApp' : 'Cliente sin celular válido'}
                        >
                            <MessageSquare size={16} className="mr-2" /> WhatsApp
                        </button>
                        <button
                            onClick={handleSendEmail}
                            disabled={!canShareAndDownload || generatingPdf || !String(data.clientEmail || '').trim()}
                            className="flex min-h-[42px] items-center justify-center rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                            title={String(data.clientEmail || '').trim() ? 'Compartir PDF con correo como respaldo' : 'Cliente sin correo'}
                        >
                            <Share2 size={16} className="mr-2" /> Compartir
                        </button>
                        <button
                            onClick={handleShare}
                            disabled={!canShareAndDownload || generatingPdf}
                            className="flex min-h-[42px] items-center justify-center rounded-lg bg-green-500 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title="Abrir más opciones para compartir"
                        >
                            <Share2 size={16} className="mr-2" /> Más opciones
                        </button>
                        <button
                            onClick={handleDownloadPDF}
                            disabled={generatingPdf || !canShareAndDownload}
                            className="flex min-h-[42px] items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {generatingPdf ? (
                                <Loader2 size={16} className="mr-2 animate-spin" />
                            ) : (
                                <Download size={16} className="mr-2" />
                            )}
                            PDF
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

    if (typeof document === 'undefined') {
        return modalContent;
    }

    return createPortal(modalContent, document.body);
};

export default QuotationTemplate;
