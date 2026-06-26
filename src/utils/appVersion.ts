const VERSION_CHECK_URL = '/version.json';
const VERSION_CHECK_TIMEOUT_MS = 4000;
const VERSION_RELOAD_GUARD_KEY = 'crm_version_reload_guard';

type VersionPayload = {
    buildId?: string;
    buildTime?: string;
};

const currentBuildId = __APP_BUILD_ID__;
const currentBuildTime = __APP_BUILD_TIME__;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
    return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            window.setTimeout(() => reject(new Error('version_check_timeout')), timeoutMs);
        })
    ]);
};

const clearRuntimeCaches = async () => {
    if ('caches' in window) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
    }

    if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.update()));
    }
};

const buildReloadUrl = (buildId: string) => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('app_build', buildId);
    return nextUrl.toString();
};

export const getCurrentAppBuild = () => ({
    buildId: currentBuildId,
    buildTime: currentBuildTime
});

export const checkForAppUpdate = async () => {
    try {
        const response = await withTimeout(
            fetch(`${VERSION_CHECK_URL}?t=${Date.now()}`, {
                cache: 'no-store',
                headers: {
                    'cache-control': 'no-cache, no-store, max-age=0'
                }
            }),
            VERSION_CHECK_TIMEOUT_MS
        );

        if (!response.ok) return false;

        const payload = (await response.json()) as VersionPayload;
        const latestBuildId = String(payload.buildId || '').trim();
        if (!latestBuildId || latestBuildId === currentBuildId) {
            window.sessionStorage.removeItem(VERSION_RELOAD_GUARD_KEY);
            return false;
        }

        const alreadyAttemptedBuild = window.sessionStorage.getItem(VERSION_RELOAD_GUARD_KEY);
        if (alreadyAttemptedBuild === latestBuildId) {
            return false;
        }

        window.sessionStorage.setItem(VERSION_RELOAD_GUARD_KEY, latestBuildId);
        await clearRuntimeCaches();
        window.location.replace(buildReloadUrl(latestBuildId));
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== 'version_check_timeout') {
            console.warn('appVersion: unable to verify build freshness', message);
        }
        return false;
    }
};
