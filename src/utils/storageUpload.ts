import { supabase } from '../services/supabase';

type UploadFileToStorageInput = {
    bucket: string;
    path: string;
    file: File;
    cacheControl?: string;
    upsert?: boolean;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const uploadFileToStorage = async ({
    bucket,
    path,
    file,
    cacheControl = '3600',
    upsert = false,
}: UploadFileToStorageInput) => {
    const payload = new Uint8Array(await file.arrayBuffer());
    let lastError: any = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error } = await supabase.storage
            .from(bucket)
            .upload(path, payload, {
                cacheControl,
                upsert,
                contentType: file.type || undefined,
            });

        if (!error) {
            return;
        }

        lastError = error;
        const message = String(error?.message || '').toLowerCase();
        if (!message.includes('failed to fetch') || attempt === 1) {
            throw error;
        }

        await wait(500 * (attempt + 1));
    }

    if (lastError) {
        throw lastError;
    }
};
