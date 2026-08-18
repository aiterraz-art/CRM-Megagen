const HEIC_MIME_TYPES = new Set([
    'image/heic',
    'image/heif',
    'application/heic',
    'application/heif'
]);

const HEIC_EXTENSIONS = new Set(['heic', 'heif']);
const HEIC_CONVERSION_TIMEOUT_MS = 15_000;

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

export const canPreviewImageFile = (file: Pick<File, 'name' | 'type'> | null | undefined) => {
    if (!file) return false;
    const mimeType = String(file.type || '').toLowerCase();
    if (!mimeType.startsWith('image/')) return false;
    return !isHeicLikeFile(file);
};

export const materializeBrowserFile = async (file: File) => {
    try {
        const buffer = await file.arrayBuffer();
        return new File([buffer], file.name || 'archivo', {
            type: file.type || 'application/octet-stream',
            lastModified: Date.now(),
        });
    } catch (error: any) {
        const message = String(error?.message || error || '').toLowerCase();
        if (message.includes('requested file could not be read') || message.includes('permission')) {
            throw new Error('Android perdio acceso al archivo seleccionado. Vuelve a elegirlo y prueba otra vez.');
        }
        throw error;
    }
};

export const convertHeicToJpeg = async (file: File) => {
    if (!isHeicLikeFile(file)) return file;

    const { default: heic2any } = await import('heic2any');
    const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(() => {
            reject(new Error('La conversion HEIC tardó demasiado en este dispositivo. Intenta con JPG/PNG o vuelve a elegir la imagen.'));
        }, HEIC_CONVERSION_TIMEOUT_MS);
    });
    const conversionResult = await Promise.race([
        heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: 0.92
        }),
        timeoutPromise
    ]);

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

export const prepareBrowserImageUpload = async (
    file: File,
    options?: { fallbackToOriginalOnFailure?: boolean }
) => {
    const sourceFile = isHeicLikeFile(file) ? await materializeBrowserFile(file) : file;

    if (!isHeicLikeFile(sourceFile)) {
        return {
            file: sourceFile,
            previewable: canPreviewImageFile(sourceFile),
            message: null as string | null,
        };
    }

    try {
        const convertedFile = await convertHeicToJpeg(sourceFile);
        return {
            file: convertedFile,
            previewable: canPreviewImageFile(convertedFile),
            message: 'Archivo HEIC convertido automaticamente a JPG para compatibilidad.',
        };
    } catch (error: any) {
        if (!options?.fallbackToOriginalOnFailure) {
            throw error;
        }

        return {
            file: sourceFile,
            previewable: false,
            message: 'No se pudo convertir el archivo HEIC en este dispositivo. Se guardará el archivo original.',
        };
    }
};
