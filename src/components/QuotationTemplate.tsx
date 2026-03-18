import React from 'react';
import { Printer, Download, X, Share2, Loader2, MessageSquare, Mail } from 'lucide-react';
import type { QuotationPreviewData, QuotationPreviewItem } from '../utils/quotationPreview';
import { sendQuotationEmail } from '../utils/quotationEmail';

interface Props {
    data: QuotationPreviewData;
    onClose: () => void;
    canShareAndDownload?: boolean;
    shareBlockReason?: string;
    onMarkedAsSent?: (action: 'share' | 'download') => Promise<void> | void;
    onSendEmail?: () => Promise<void> | void;
    readOnly?: boolean;
}

const QuotationTemplate: React.FC<Props> = ({ data, onClose, canShareAndDownload = true, shareBlockReason, onMarkedAsSent, onSendEmail, readOnly = false }) => {
    const contentRef = React.useRef<HTMLDivElement>(null);
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const [generatingPdf, setGeneratingPdf] = React.useState(false);
    const [previewScale, setPreviewScale] = React.useState(1);
    const [previewHeight, setPreviewHeight] = React.useState(1400);
    const [zoomMultiplier, setZoomMultiplier] = React.useState(1);
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

    const companyName = normalizeCompanyValue(import.meta.env.VITE_COMPANY_NAME) || 'MEGAGEN IMPLANT';
    const companyLogo = import.meta.env.VITE_COMPANY_LOGO || '/logo_megagen.png';
    const is3DentalCompany = companyName.toLowerCase().includes('3dental');
    const companyGiro = normalizeCompanyValue(import.meta.env.VITE_COMPANY_GIRO) || 'Venta insumos dentales';
    const companyAddress = normalizeCompanyValue(import.meta.env.VITE_COMPANY_ADDRESS) || (is3DentalCompany ? 'Americo Vespucio 2880 of 1403, Conchali' : 'Avenida Americo Vespucio 2880 of 1403, CONCHALI');
    const companyPhone = normalizeCompanyValue(import.meta.env.VITE_COMPANY_PHONE) || '961183899';
    const companyEmail = normalizeCompanyValue(import.meta.env.VITE_COMPANY_EMAIL) || normalizeCompanyValue(import.meta.env.VITE_OWNER_EMAIL) || 'aterraza@imegagen.cl';
    const companyRut = normalizeCompanyValue(import.meta.env.VITE_COMPANY_RUT) || (is3DentalCompany ? '76.921-029-6' : '76.921.029-6');
    const sellerEmail = normalizeCompanyValue(data.sellerEmail) || companyEmail;

    // Robust parsing: items could be a string (JSON) or an object
    let items: QuotationPreviewItem[] = [];
    try {
        if (typeof data.items === 'string') {
            items = JSON.parse(data.items);
        } else if (Array.isArray(data.items)) {
            items = data.items;
        }
    } catch (e) {
        console.error("Error parsing items:", e);
        items = [];
    }

    // Calculate from scratch to be safe
    const subtotal = items.reduce((acc, item) => acc + (item.total || 0), 0);
    const tax = Math.round(subtotal * 0.19);
    const total = subtotal + tax;

    // Simple number to words (very basic version for demo, could be a library like numero-a-letras)
    const numberToWords = (num: number) => {
        // This is a placeholder for a real implementation
        return "MONTO TOTAL EN PESOS";
    };

    const generatePdfBlob = async (): Promise<Blob | null> => {
        if (!contentRef.current) return null;

        try {
            const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
                import('html2canvas'),
                import('jspdf')
            ]);
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
            clonedNode.style.padding = '40px';
            clonedNode.style.boxSizing = 'border-box';
            clonedNode.style.background = '#ffffff';
            clonedNode.style.fontFamily = 'Arial, Helvetica, sans-serif';
            clonedNode.style.fontKerning = 'normal';
            clonedNode.style.letterSpacing = 'normal';
            clonedNode.style.textRendering = 'optimizeLegibility';
            clonedNode.querySelectorAll<HTMLElement>('*').forEach((el) => {
                el.style.fontFamily = 'Arial, Helvetica, sans-serif';
                el.style.fontKerning = 'normal';
            });

            sandbox.appendChild(clonedNode);
            document.body.appendChild(sandbox);

            const canvas = await html2canvas(clonedNode, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                windowWidth: captureWidth,
                width: captureWidth
            });

            document.body.removeChild(sandbox);

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
        } catch (error) {
            console.error("Error generating PDF blob:", error);
            return null;
        }
    };

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
                await onSendEmail();
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
            const pdfBlob = await generatePdfBlob();
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
            const pdfBlob = await generatePdfBlob();
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

    return (
        <div
            className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-2 md:p-3 overflow-y-auto cursor-pointer"
            onClick={onClose} // Close on backdrop click
        >
            <div
                className="bg-white w-[96vw] max-w-[1700px] shadow-2xl rounded-lg flex flex-col h-[98vh] overflow-hidden animate-in fade-in zoom-in duration-300 cursor-default"
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
                                    title={String(data.clientEmail || '').trim() ? 'Enviar por correo' : 'Cliente sin correo'}
                                >
                                    <Mail size={16} className="mr-2" /> Correo
                                </button>
                                <button
                                    onClick={handleShare}
                                    disabled={!canShareAndDownload || generatingPdf}
                                    className="flex shrink-0 items-center rounded-lg bg-green-500 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Share2 size={16} className="mr-2" /> Compartir
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
                    className="w-full flex-1 flex items-center justify-center overflow-auto bg-gray-50 p-1"
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
                        {/* Header Section */}
                        <div className="flex justify-between items-start mb-10">
                            <div className="space-y-1">
                                <div className="flex items-center space-x-2 mb-4">
                                    <img src={companyLogo} alt={companyName} className="h-16 w-auto" />
                                </div>
                                <p className="font-bold text-xs uppercase">{companyName}</p>
                                <p>{companyGiro}</p>
                                <p>{companyAddress}</p>
                                <p>Telefono: {companyPhone}</p>
                                <p>Email: <span className="text-blue-600 underline">{sellerEmail}</span></p>
                            </div>

                            <div className="w-64 border-2 border-orange-400 p-4 text-center rounded-lg space-y-2">
                                <p className="text-orange-500 font-extrabold text-sm tracking-widest">R.U.T: {companyRut}</p>
                                <p className="text-orange-500 font-black text-lg uppercase tracking-wider">Cotización</p>
                                <p className="text-orange-500 font-extrabold text-sm uppercase">Folio N° {data.folio}</p>
                            </div>
                        </div>

                        {/* Client Info Grid */}
                        <div className="grid grid-cols-12 gap-y-3 mb-8 border-t border-b border-gray-100 py-6 text-[11px]">
                            <div className="col-span-4 self-start">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Señor (es)</p>
                                <p className="font-bold uppercase text-[12px]">{data.clientName}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Ciudad</p>
                                <p className="font-bold uppercase">{data.clientCity}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Giro</p>
                                <p className="font-bold uppercase truncate pr-4" title={data.clientGiro}>{data.clientGiro}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">R.U.T</p>
                                <p className="font-bold uppercase">{data.clientRut}</p>
                            </div>

                            <div className="col-span-4">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Dirección</p>
                                <p className="font-bold uppercase">
                                    {data.clientAddress || data.clientComuna || 'SIN DIRECCIÓN'}
                                </p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Condición de pago</p>
                                <p className="font-bold uppercase">
                                    {(() => {
                                        try {
                                            const parsed = typeof data.paymentTerms === 'string' ? JSON.parse(data.paymentTerms) : data.paymentTerms;
                                            if (typeof parsed === 'object' && parsed !== null) {
                                                return `${parsed.type}${parsed.days > 0 ? ` - ${parsed.days} DÍAS` : ''}`;
                                            }
                                            return data.paymentTerms;
                                        } catch {
                                            return data.paymentTerms;
                                        }
                                    })()}
                                </p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Vendedor</p>
                                <p className="font-bold uppercase">{data.sellerName}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Tipo de Cambio</p>
                                <p className="font-bold uppercase">PESO</p>
                            </div>

                            <div className="col-span-4">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Comuna</p>
                                <p className="font-bold uppercase">{data.clientComuna}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Fecha Emisión</p>
                                <p className="font-bold uppercase">{data.date}</p>
                            </div>
                            <div className="col-span-3">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Fecha Vencimiento</p>
                                <p className="font-bold uppercase">{data.expiryDate}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Tasa de Cambio</p>
                                <p className="font-bold uppercase">1</p>
                            </div>

                            {/* New Contact Info Row */}
                            {(data.clientContact || data.clientPhone || data.clientEmail) && (
                                <div className="col-span-12 grid grid-cols-12 mt-2 pt-3 border-t border-gray-50 bg-gray-50/20 rounded-lg">
                                    <div className="col-span-4 pl-2">
                                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Atención Dr/Clínica</p>
                                        <p className="font-bold uppercase text-[10px] text-indigo-600">{data.clientContact || '---'}</p>
                                    </div>
                                    <div className="col-span-4">
                                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Teléfono Contacto</p>
                                        <p className="font-bold uppercase text-[10px]">{data.clientPhone || '---'}</p>
                                    </div>
                                    <div className="col-span-4">
                                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Email Contacto</p>
                                        <p className="font-bold uppercase text-[10px] lowercase text-blue-500">{data.clientEmail || '---'}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Items Table */}
                        <div className="min-h-[140px] text-[11px]">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b-2 border-gray-100 text-sm font-bold text-gray-500">
                                        <th className="py-4 text-left pl-4">Ítem</th>
                                        <th className="p-2 font-medium w-24">Código</th>
                                        <th className="p-2 font-medium">Detalle</th>
                                        <th className="p-2 font-medium w-16 text-center">Cant</th>
                                        <th className="p-2 font-medium w-24 text-right">P. Unitario</th>
                                        <th className="p-2 font-medium w-20 text-right">Rec/Desc</th>
                                        <th className="p-2 font-medium w-24 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((item, index) => (
                                        <React.Fragment key={index}>
                                            <tr className="border-b border-gray-50 align-top">
                                                <td className="p-2 text-center text-gray-400">{index + 1}</td>
                                                <td className="p-2 font-medium">{item.code}</td>
                                                <td className="p-2 font-black uppercase tracking-tight">{item.detail}</td>
                                                <td className="p-2 text-center uppercase">{item.qty} {item.unit}</td>
                                                <td className="p-2 text-right">${item.price.toLocaleString()}</td>
                                                <td className="p-2 text-right border-l border-gray-50 text-gray-400">${item.discount}</td>
                                                <td className="p-2 text-right font-bold border-l border-gray-50">${item.total.toLocaleString()}</td>
                                            </tr>
                                            {item.subDetail && (
                                                <tr className="border-b border-gray-50">
                                                    <td colSpan={2}></td>
                                                    <td className="p-2 pt-0 pb-4 text-[9px] text-gray-400 italic font-medium leading-none">
                                                        Desc. Detallada: {item.subDetail}
                                                    </td>
                                                    <td colSpan={4}></td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer / Totals Section */}
                        <div className="grid grid-cols-12 mt-8 gap-8 items-start text-[11px]">
                            <div className="col-span-8 border border-gray-100 rounded-lg p-6 min-h-[100px]">
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-4">Comentario</p>
                                <p className="text-gray-600 font-medium italic">{data.comments || "Sin comentarios adicionales."}</p>
                            </div>

                            <div className="col-span-4 space-y-2">
                                <div className="flex justify-between items-center text-gray-500">
                                    <span className="font-bold">Recargo/Dscto.</span>
                                    <span>$ 0</span>
                                </div>
                                <div className="flex justify-between items-center text-gray-800 font-bold">
                                    <span>Afecto</span>
                                    <span>$ {subtotal.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center text-gray-500">
                                    <span>Exento</span>
                                    <span>$ 0</span>
                                </div>
                                <div className="flex justify-between items-center text-gray-800 font-bold">
                                    <span>19% IVA</span>
                                    <span>$ {tax.toLocaleString()}</span>
                                </div>

                                <div className="pt-6 border-t border-gray-100 flex justify-between items-end">
                                    <div>
                                        <p className="font-bold text-lg text-orange-400 tracking-tighter">Total</p>
                                        <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest leading-none mt-1">{numberToWords(total)}</p>
                                    </div>
                                    <p className="text-2xl font-black text-orange-400 tracking-tighter leading-none">$ {total.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>

                        {/* Logo Bottom (Small) */}
                        <div className="mt-auto pt-12 flex justify-center opacity-10 grayscale">
                            <div className="text-xl font-black text-gray-400 tracking-tighter italic">
                                {import.meta.env.VITE_COMPANY_NAME?.split(' ')[0] || 'Megagen'}
                                <span className="text-gray-400 font-light not-italic text-xs ml-1 uppercase">
                                    {import.meta.env.VITE_COMPANY_NAME?.split(' ').slice(1).join(' ') || 'Chile'}
                                </span>
                        </div>
                    </div>
                </div>

                {!readOnly && (
                    <div className="grid shrink-0 grid-cols-2 gap-2 border-t bg-white p-3 print:hidden md:hidden">
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
                            title={String(data.clientEmail || '').trim() ? 'Enviar por correo' : 'Cliente sin correo'}
                        >
                            <Mail size={16} className="mr-2" /> Correo
                        </button>
                        <button
                            onClick={handleShare}
                            disabled={!canShareAndDownload || generatingPdf}
                            className="flex min-h-[42px] items-center justify-center rounded-lg bg-green-500 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <Share2 size={16} className="mr-2" /> Compartir
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

            </div>
        </div>
    );
};

export default QuotationTemplate;
