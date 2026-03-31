declare module 'heic2any' {
    type HeicToAnyOptions = {
        blob: Blob;
        toType?: string;
        quality?: number;
    };

    export default function heic2any(options: HeicToAnyOptions): Promise<Blob | Blob[]>;
}
