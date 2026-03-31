const HEIC_MIME_TYPES = new Set([
    'image/heic',
    'image/heif',
    'application/heic',
    'application/heif'
]);

const HEIC_EXTENSIONS = new Set(['heic', 'heif']);

const getFileExtension = (fileName: string) => {
    const parts = String(fileName || '').split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
};

export const isHeicLikeFile = (file: Pick<File, 'name' | 'type'> | null | undefined) => {
    if (!file) return false;
    const mimeType = String(file.type || '').toLowerCase();
    const extension = getFileExtension(file.name);
    return HEIC_MIME_TYPES.has(mimeType) || HEIC_EXTENSIONS.has(extension);
};

export const convertHeicToJpeg = async (file: File) => {
    if (!isHeicLikeFile(file)) return file;

    const { default: heic2any } = await import('heic2any');
    const conversionResult = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.92
    });

    const convertedBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
    if (!(convertedBlob instanceof Blob)) {
        throw new Error('No se pudo convertir el archivo HEIC a JPG.');
    }

    const baseName = String(file.name || 'comprobante').replace(/\.[^.]+$/, '') || 'comprobante';
    return new File([convertedBlob], `${baseName}.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now(),
    });
};
