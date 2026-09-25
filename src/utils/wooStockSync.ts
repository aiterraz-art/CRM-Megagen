import { supabase } from '../services/supabase';

// Piezas compartidas entre la conexión con la tienda (Configuración →
// Integraciones) y la gestión del stock web (Abastecimiento → Tienda Web).

export type WooConnection = {
    ok: boolean;
    verified_at: string;
    store_url: string | null;
    store_name: string | null;
    products_count: number | null;
    consumer_key_suffix: string | null;
    error: string | null;
};

export type WooHealth = {
    enabled: boolean;
    pg_net: boolean;
    sweep_scheduled?: boolean;
    credentials: Record<string, boolean>;
    store_url: string | null;
    connection: WooConnection | null;
    last_scan_at: string | null;
    catalog_size: number;
    approved: number;
    synced: number;
    pending: number;
    failed: number;
    exhausted?: number;
    last_synced_at: string | null;
    recent_errors: Array<{ sku: string; error: string | null; attempts: number }>;
};

export const WOO_FUNCTION_URL = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/woo-stock-sync`;

export const randomSecret = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const fetchWooHealth = async () => {
    const { data, error } = await supabase.rpc('woo_stock_sync_health');
    if (error) throw new Error(`No se pudo leer el estado: ${error.message}`);
    return data as WooHealth | null;
};

export const setWooCredential = async (key: string, value: string) => {
    const { error } = await supabase.rpc('set_woo_stock_credential', { p_key: key, p_value: value });
    if (error) throw new Error(error.message);
};

export const invokeWooFunction = async (task: 'test' | 'scan' | 'run') => {
    const { data, error } = await supabase.functions.invoke(`woo-stock-sync?task=${task}`, { body: {} });
    if (error) {
        // El cuerpo del error trae el motivo real (claves malas, tienda caída).
        const context = (error as any)?.context;
        const detail = context?.json ? await context.json().catch(() => null) : null;
        throw new Error(detail?.error || error.message);
    }
    return data as Record<string, any>;
};

export const isWooConfigured = (health: WooHealth | null) => {
    const creds = health?.credentials ?? {};
    return Boolean(creds.store_url && creds.consumer_key && creds.consumer_secret);
};
