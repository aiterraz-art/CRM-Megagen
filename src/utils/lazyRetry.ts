const LAZY_RETRY_KEY = 'crm_lazy_chunk_retry';

const isChunkLoadError = (error: unknown): boolean => {
    const message = String((error as any)?.message || error || '').toLowerCase();
    return (
        message.includes('chunkloaderror')
        || message.includes('loading chunk')
        || message.includes('failed to fetch dynamically imported module')
        || message.includes('importing a module script failed')
    );
};

export const lazyRetry = async <T>(importer: () => Promise<T>): Promise<T> => {
    try {
        const module = await importer();
        if (typeof window !== 'undefined') {
            window.sessionStorage.setItem(LAZY_RETRY_KEY, 'false');
        }
        return module;
    } catch (error) {
        if (typeof window !== 'undefined' && isChunkLoadError(error)) {
            const alreadyRetried = window.sessionStorage.getItem(LAZY_RETRY_KEY) === 'true';
            if (!alreadyRetried) {
                window.sessionStorage.setItem(LAZY_RETRY_KEY, 'true');
                window.location.reload();
                return new Promise<T>(() => { });
            }
            window.sessionStorage.setItem(LAZY_RETRY_KEY, 'false');
        }
        throw error;
    }
};
