import { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.send'
].join(' ');

type GoogleConnectionStatus = {
    googleEmail: string | null;
    hasRefreshToken: boolean;
    lastRefreshAt: string | null;
    lastError: string | null;
    updatedAt: string | null;
    needsReconnect: boolean;
};

type GoogleJsonError = {
    error?: {
        message?: string;
    };
};

const TOKEN_SKEW_MS = 60_000;
let cachedToken: { token: string; expiresAt: number } | null = null;
let syncPromise: Promise<boolean> | null = null;

const resolveSession = async (session?: Session | null) =>
    session ?? (await supabase.auth.getSession()).data.session;

const parseResponseJson = async <T>(response: Response): Promise<T | null> => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    try {
        return await response.json();
    } catch {
        return null;
    }
};

const extractErrorMessage = (response: Response, payload?: GoogleJsonError | null) =>
    payload?.error?.message || `Google API ${response.status}`;

const validateAndCacheProviderToken = async (token: string) => {
    try {
        const response = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
        if (!response.ok) return null;

        const data = await response.json();
        const expiresAt = Number(data?.exp || 0) * 1000;
        cachedToken = {
            token,
            expiresAt: expiresAt || Date.now() + (10 * 60 * 1000),
        };
        return token;
    } catch (error) {
        console.warn('googleService: token validation failed', error);
        return null;
    }
};

const readStoredAccessToken = async () => {
    const { data, error } = await supabase.functions.invoke('get-google-access-token', { body: {} });
    if (error) {
        throw new Error(error.message || 'No se pudo renovar Google');
    }

    const token = data?.access_token;
    if (!token) {
        throw new Error('Google no devolvió access token');
    }

    const expiresIn = Number(data?.expires_in || 3600);
    cachedToken = {
        token,
        expiresAt: Date.now() + (expiresIn * 1000),
    };
    return token as string;
};

export const googleService = {
    async storeRefreshTokenIfPresent(session?: Session | null) {
        const effectiveSession = await resolveSession(session);
        const refreshToken = (effectiveSession as any)?.provider_refresh_token as string | null | undefined;
        const googleEmail = effectiveSession?.user?.email?.trim().toLowerCase();

        if (!refreshToken || !googleEmail) {
            return false;
        }

        if (syncPromise) {
            return syncPromise;
        }

        syncPromise = (async () => {
            const { error } = await supabase.functions.invoke('store-google-refresh-token', {
                body: {
                    provider_refresh_token: refreshToken,
                    google_email: googleEmail,
                    scopes: GOOGLE_SCOPES.split(' '),
                }
            });

            if (error) {
                console.warn('googleService: refresh token sync failed', error.message);
                return false;
            }

            return true;
        })();

        try {
            return await syncPromise;
        } finally {
            syncPromise = null;
        }
    },

    async getConnectionStatus(): Promise<GoogleConnectionStatus> {
        const session = await resolveSession();
        if ((session as any)?.provider_refresh_token) {
            await this.storeRefreshTokenIfPresent(session);
        }

        const { data, error } = await supabase.rpc('get_google_oauth_status');
        if (error) {
            console.warn('googleService: getConnectionStatus failed', error.message);
        }

        const row = Array.isArray(data) ? data[0] : data;
        const hasRefreshToken = Boolean(row?.has_refresh_token || (session as any)?.provider_refresh_token);

        return {
            googleEmail: row?.google_email || session?.user?.email?.trim().toLowerCase() || null,
            hasRefreshToken,
            lastRefreshAt: row?.last_refresh_at || null,
            lastError: row?.last_error || null,
            updatedAt: row?.updated_at || null,
            needsReconnect: !hasRefreshToken,
        };
    },

    async getValidToken(): Promise<string | null> {
        if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_SKEW_MS) {
            return cachedToken.token;
        }

        const session = await resolveSession();
        const providerToken = (session as any)?.provider_token as string | null | undefined;
        if (providerToken) {
            const validProviderToken = await validateAndCacheProviderToken(providerToken);
            if (validProviderToken) {
                void this.storeRefreshTokenIfPresent(session);
                return validProviderToken;
            }
        }

        try {
            return await readStoredAccessToken();
        } catch (error) {
            console.warn('googleService: stored token refresh failed', error);
            return null;
        }
    },

    async ensureSession(): Promise<string | null> {
        const token = await this.getValidToken();
        if (!token) {
            alert("Google necesita reconectarse.\n\nVe a Configuración > Integraciones y usa 'Reconectar Google'.");
            return null;
        }
        return token;
    },

    async fetchGoogle(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
        let token = await this.getValidToken();
        if (!token) {
            throw new Error('Google no está conectado. Reconecta tu cuenta desde Integraciones.');
        }

        let response = await fetch(url, {
            ...init,
            headers: {
                ...(init.headers || {}),
                Authorization: `Bearer ${token}`,
            }
        });

        if (response.status === 401 && retry) {
            cachedToken = null;
            token = await readStoredAccessToken().catch(() => null);
            if (!token) {
                throw new Error('Google necesita reconectarse. No se pudo renovar el acceso.');
            }

            response = await fetch(url, {
                ...init,
                headers: {
                    ...(init.headers || {}),
                    Authorization: `Bearer ${token}`,
                }
            });
        }

        return response;
    },

    async fetchGoogleJson<T = any>(url: string, init: RequestInit = {}, retry = true): Promise<T> {
        const response = await this.fetchGoogle(url, init, retry);
        const payload = await parseResponseJson<T>(response);

        if (!response.ok) {
            throw new Error(extractErrorMessage(response, payload as GoogleJsonError | null));
        }

        return (payload ?? {}) as T;
    },

    async startReconnect(returnTo = window.location.href) {
        return supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: returnTo,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent select_account',
                    include_granted_scopes: 'true',
                },
                scopes: GOOGLE_SCOPES,
            }
        });
    },

    clearCachedToken() {
        cachedToken = null;
    }
};
