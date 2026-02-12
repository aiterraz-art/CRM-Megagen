import { supabase } from './supabase';

export const googleService = {
    /**
     * Checks if the Google provider token is valid by calling a lightweight tokeninfo endpoint.
     */
    async getValidToken(): Promise<string | null> {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = (session as any)?.provider_token;

            if (!token) {
                console.warn("googleService: No provider_token found in session.");
                return null;
            }

            // Verify token with Google's tokeninfo endpoint
            const resp = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`);
            if (!resp.ok) {
                console.error("googleService: Token validation failed:", await resp.text());
                return null;
            }

            const data = await resp.json();
            // Check if token belongs to an authorized app (optional but good practice)
            if (data.error) {
                console.error("googleService: Token error data:", data.error_description);
                return null;
            }

            return token;
        } catch (e) {
            console.error("googleService: Unexpected validation error:", e);
            return null;
        }
    },

    /**
     * Ensures a valid Google session exists.
     * If not, alerts the user to re-login and returns null.
     */
    async ensureSession(): Promise<string | null> {
        const token = await this.getValidToken();
        if (!token) {
            alert("⚠️ TU SESIÓN DE GOOGLE HA EXPIRADO\n\nPor seguridad y para que las funciones de Gmail y Google Calendar funcionen correctamente, debes:\n\n1. Cerrar sesión en el CRM.\n2. Volver a ingresar usando el botón 'Acceder con Google'.\n\nEsto renovará tus permisos automáticamente.");
            return null;
        }
        return token;
    }
};
