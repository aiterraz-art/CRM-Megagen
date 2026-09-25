// Browsers (iOS Safari especially) silently corrupt or blank canvases above ~16.7M pixels,
// so keep the html2canvas capture well below that regardless of document length.
const MAX_CANVAS_PIXELS = 12_000_000;
const PREFERRED_SCALE = 3;
const MIN_SCALE = 1;

export const getSafeRenderScale = (element: HTMLElement, width: number) => {
    const height = Math.max(element.scrollHeight, element.offsetHeight, 1);
    const budgetScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
    return Math.max(MIN_SCALE, Math.min(PREFERRED_SCALE, budgetScale));
};

// JPEG is embedded as-is (DCTDecode); jsPDF re-encodes PNGs, which some viewers render as garbage on large images.
export const canvasToPdfImage = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/jpeg', 0.92);
