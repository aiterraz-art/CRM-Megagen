import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import WooStockReview from './WooStockReview';

// Tarjeta de Integraciones para enviar el stock del CRM a la tienda
// WooCommerce. Conectar la tienda no envía nada: primero se escanea su
// catálogo, se revisa el cruce por SKU y se aprueba producto por producto.
// Las claves nunca vuelven al navegador; la base solo informa si están puestas.

type WooHealth = {
    enabled: boolean;
    pg_net: boolean;
    credentials: Record<string, boolean>;
    store_url: string | null;
    connection: {
        ok: boolean;
        verified_at: string;
        store_url: string | null;
        store_name: string | null;
        products_count: number | null;
        consumer_key_suffix: string | null;
        error: string | null;
    } | null;
    last_scan_at: string | null;
    catalog_size: number;
    approved: number;
    synced: number;
    pending: number;
    failed: number;
    last_synced_at: string | null;
    recent_errors: Array<{ sku: string; error: string | null; attempts: number }>;
};

type BusyKind = 'save' | 'test' | 'scan' | 'run' | 'resync' | 'toggle';

const FUNCTION_URL = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/woo-stock-sync`;

const randomSecret = () => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const invokeFunction = async (task: 'test' | 'scan' | 'run') => {
    const { data, error } = await supabase.functions.invoke(`woo-stock-sync?task=${task}`, { body: {} });
    if (error) {
        // El cuerpo del error trae el motivo real (claves malas, tienda caída).
        const context = (error as any)?.context;
        const detail = context?.json ? await context.json().catch(() => null) : null;
        throw new Error(detail?.error || error.message);
    }
    return data as Record<string, any>;
};

const Step: React.FC<{ n: number; title: string; done: boolean; children: React.ReactNode }> = ({ n, title, done, children }) => (
    <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="flex items-center gap-3">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {done ? '✓' : n}
            </span>
            <p className="text-sm font-black text-gray-900">{title}</p>
        </div>
        {children}
    </div>
);

const WooStockSyncCard: React.FC = () => {
    const [health, setHealth] = useState<WooHealth | null>(null);
    const [busy, setBusy] = useState<BusyKind | null>(null);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const [storeUrl, setStoreUrl] = useState('');
    const [consumerKey, setConsumerKey] = useState('');
    const [consumerSecret, setConsumerSecret] = useState('');
    const [showReview, setShowReview] = useState(false);
    const [reviewKey, setReviewKey] = useState(0);

    const fetchHealth = async () => {
        const { data, error } = await supabase.rpc('woo_stock_sync_health');
        if (error) {
            setMessage({ tone: 'error', text: `No se pudo leer el estado: ${error.message}` });
            return;
        }
        const next = data as WooHealth | null;
        setHealth(next);
        if (next?.store_url) setStoreUrl((current) => current || next.store_url || '');
    };

    useEffect(() => {
        void fetchHealth();
    }, []);

    const setCredential = async (key: string, value: string) => {
        const { error } = await supabase.rpc('set_woo_stock_credential', { p_key: key, p_value: value });
        if (error) throw new Error(error.message);
    };

    const run = async (kind: BusyKind, action: () => Promise<string>) => {
        setBusy(kind);
        setMessage(null);
        try {
            setMessage({ tone: 'ok', text: await action() });
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
            void fetchHealth();
        }
    };

    const handleSave = () => run('save', async () => {
        const url = storeUrl.trim().replace(/\/+$/, '');
        if (!url.startsWith('https://')) throw new Error('La URL de la tienda debe comenzar con https://');
        // WooCommerce entrega ambas claves juntas y es fácil pegar la misma
        // dos veces; el prefijo distingue una de otra.
        if (consumerKey.trim() && !consumerKey.trim().startsWith('ck_')) {
            throw new Error('La Consumer Key debe comenzar con ck_');
        }
        if (consumerSecret.trim() && !consumerSecret.trim().startsWith('cs_')) {
            throw new Error('El Consumer Secret debe comenzar con cs_ (parece que pegaste la Consumer Key).');
        }

        await setCredential('store_url', url);
        if (consumerKey.trim()) await setCredential('consumer_key', consumerKey.trim());
        if (consumerSecret.trim()) await setCredential('consumer_secret', consumerSecret.trim());
        // La dirección de la función y el secreto del aviso los pone el CRM
        // solo; el administrador no necesita conocerlos.
        await setCredential('function_url', FUNCTION_URL);
        if (!health?.credentials?.dispatch_secret) await setCredential('dispatch_secret', randomSecret());

        setConsumerKey('');
        setConsumerSecret('');
        return 'Configuración guardada. Prueba la conexión.';
    });

    const handleTest = () => run('test', async () => {
        const result = await invokeFunction('test');
        return `Conexión correcta${result.tienda ? ` con ${result.tienda}` : ''}: ${result.productos_en_tienda ?? 0} productos. No se modificó nada.`;
    });

    const handleScan = () => run('scan', async () => {
        const result = await invokeFunction('scan');
        setShowReview(true);
        setReviewKey((k) => k + 1);
        return `Catálogo leído: ${result.productos ?? 0} productos y ${result.variaciones ?? 0} variaciones. No se modificó nada en la tienda.`;
    });

    const handleToggle = () => {
        const enabling = !health?.enabled;
        if (enabling && !window.confirm(`Al encender el envío, los ${health?.approved ?? 0} SKU aprobados recibirán el stock del CRM en la tienda. ¿Continuar?`)) return;

        void run('toggle', async () => {
            await setCredential('enabled', enabling ? 'true' : '');
            if (!enabling) return 'Envío apagado. La tienda deja de recibir cambios; las aprobaciones se conservan.';
            const result = await invokeFunction('run');
            return `Envío encendido. Enviados: ${result.synced ?? 0}${result.failed ? ` · con error: ${result.failed}` : ''}. Desde ahora viaja cada cambio de los SKU aprobados.`;
        });
    };

    const handleRunNow = () => run('run', async () => {
        const result = await invokeFunction('run');
        return `Enviados: ${result.synced ?? 0} · Con error: ${result.failed ?? 0}`;
    });

    const handleResync = () => {
        if (!window.confirm(`¿Reenviar el stock de los ${health?.approved ?? 0} SKU aprobados?`)) return;
        void run('resync', async () => {
            const { error } = await supabase.rpc('enqueue_all_woo_stock_sync');
            if (error) throw new Error(error.message);
            const result = await invokeFunction('run');
            return `Reenviados: ${result.synced ?? 0}${result.failed ? ` · con error: ${result.failed}` : ''}.`;
        });
    };

    const creds = health?.credentials ?? {};
    const configured = Boolean(creds.store_url && creds.consumer_key && creds.consumer_secret);
    const scanned = Boolean(health?.last_scan_at);
    const connection = health?.connection ?? null;
    const button = 'py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed';

    return (
        <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm">
            <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center font-bold text-2xl">
                    W
                </div>
                <div className="flex-1">
                    <h4 className="text-lg font-black text-gray-900">Tienda web (WooCommerce)</h4>
                    <p className="text-xs text-gray-500 font-medium">
                        El stock del CRM se envía a la tienda solo para los SKU que apruebes.
                    </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${health?.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                    {health?.enabled ? 'Envío encendido' : 'Envío apagado'}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Step n={1} title="Conectar la tienda" done={configured && Boolean(connection?.ok)}>
                    {connection?.ok ? (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 space-y-1">
                            <p className="text-sm font-black text-emerald-700">
                                Conectado{connection.store_name ? ` a ${connection.store_name}` : ''}
                            </p>
                            <p className="text-xs text-emerald-800 font-medium break-all">{connection.store_url}</p>
                            <p className="text-xs text-emerald-800 font-medium">
                                {connection.consumer_key_suffix && <>Clave activa: <span className="font-mono">ck_…{connection.consumer_key_suffix}</span> · </>}
                                {connection.products_count ?? 0} productos en la tienda
                            </p>
                            <p className="text-[11px] text-emerald-700/70 font-medium">
                                Verificada el {new Date(connection.verified_at).toLocaleString('es-CL')}
                            </p>
                        </div>
                    ) : connection && !connection.ok ? (
                        <div className="rounded-xl bg-rose-50 border border-rose-100 p-3 space-y-1">
                            <p className="text-sm font-black text-rose-700">Sin conexión</p>
                            <p className="text-xs text-rose-700 font-medium break-words">{connection.error}</p>
                            <p className="text-[11px] text-rose-700/70 font-medium">
                                Última prueba: {new Date(connection.verified_at).toLocaleString('es-CL')}
                            </p>
                        </div>
                    ) : configured ? (
                        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                            <p className="text-xs text-amber-700 font-bold">Claves guardadas sin verificar. Presiona "Probar conexión".</p>
                        </div>
                    ) : null}
                    <input
                        value={storeUrl}
                        onChange={(e) => setStoreUrl(e.target.value)}
                        placeholder="https://www.3dental.cl"
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium focus:border-indigo-400 focus:outline-none"
                    />
                    <input
                        value={consumerKey}
                        onChange={(e) => setConsumerKey(e.target.value)}
                        placeholder={creds.consumer_key ? 'Consumer Key guardada (vacío para mantener)' : 'Consumer Key (ck_...)'}
                        autoComplete="off"
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-mono focus:border-indigo-400 focus:outline-none"
                    />
                    <input
                        type="password"
                        value={consumerSecret}
                        onChange={(e) => setConsumerSecret(e.target.value)}
                        placeholder={creds.consumer_secret ? 'Consumer Secret guardado (vacío para mantener)' : 'Consumer Secret (cs_...)'}
                        autoComplete="new-password"
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-mono focus:border-indigo-400 focus:outline-none"
                    />
                    <p className="text-[11px] text-gray-400 font-medium">
                        En WordPress: WooCommerce → Ajustes → Avanzado → API REST → Añadir clave, con permisos de Lectura/Escritura.
                    </p>
                    <div className="flex gap-2">
                        <button onClick={handleSave} disabled={busy !== null} className={`${button} flex-1 bg-indigo-600 text-white hover:bg-indigo-700`}>
                            {busy === 'save' ? 'Guardando...' : 'Guardar'}
                        </button>
                        <button onClick={handleTest} disabled={busy !== null || !configured} className={`${button} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}>
                            {busy === 'test' ? 'Probando...' : 'Probar conexión'}
                        </button>
                    </div>
                </Step>

                <div className="space-y-4">
                    <Step n={2} title="Escanear y revisar SKU" done={(health?.approved ?? 0) > 0}>
                        <p className="text-xs text-gray-500 font-medium">
                            Lee el catálogo de la tienda sin modificarlo y lo cruza con el inventario por SKU. Luego apruebas uno a uno o en bloque.
                        </p>
                        {scanned && (
                            <p className="text-xs text-gray-500 font-medium">
                                Último escaneo: {new Date(health!.last_scan_at!).toLocaleString('es-CL')} · {health!.catalog_size} productos/variaciones · {health!.approved} SKU aprobados
                            </p>
                        )}
                        <div className="flex gap-2">
                            <button onClick={handleScan} disabled={busy !== null || !configured} className={`${button} flex-1 border border-indigo-200 text-indigo-600 hover:bg-indigo-50`}>
                                {busy === 'scan' ? 'Leyendo la tienda...' : scanned ? 'Volver a escanear' : 'Escanear tienda'}
                            </button>
                            <button onClick={() => setShowReview((v) => !v)} disabled={!scanned} className={`${button} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}>
                                {showReview ? 'Ocultar revisión' : 'Revisar y aprobar'}
                            </button>
                        </div>
                    </Step>

                    <Step n={3} title="Envío de stock" done={Boolean(health?.enabled)}>
                        <p className="text-xs text-gray-500 font-medium">
                            Encendido, cada cambio de stock de un SKU aprobado viaja a la tienda. Apagado, no se envía nada.
                        </p>
                        {health && (health.approved > 0 || health.enabled) && (
                            <p className="text-xs text-gray-500 font-medium">
                                Al día: {health.synced} · Por enviar: {health.pending + health.failed}
                                {health.last_synced_at && ` · Último envío: ${new Date(health.last_synced_at).toLocaleString('es-CL')}`}
                            </p>
                        )}
                        {health?.enabled && !health.pg_net && (
                            <p className="text-xs text-amber-600 font-bold">
                                La base no tiene pg_net: los cambios se envían con el barrido periódico o el botón "Enviar pendientes".
                            </p>
                        )}
                        {health?.recent_errors?.slice(0, 3).map((item) => (
                            <p key={item.sku} className="text-xs text-rose-600 font-bold break-words">{item.sku}: {item.error}</p>
                        ))}
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleToggle}
                                disabled={busy !== null || !configured || (!health?.enabled && !(health?.approved ?? 0))}
                                className={`${button} flex-1 ${health?.enabled ? 'border border-rose-200 text-rose-600 hover:bg-rose-50' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                            >
                                {busy === 'toggle' ? '...' : health?.enabled ? 'Apagar envío' : 'Encender envío'}
                            </button>
                            <button onClick={handleRunNow} disabled={busy !== null || !health?.enabled} className={`${button} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}>
                                {busy === 'run' ? 'Enviando...' : 'Enviar pendientes'}
                            </button>
                            <button onClick={handleResync} disabled={busy !== null || !health?.enabled} className={`${button} flex-1 border border-gray-200 text-gray-700 hover:bg-gray-50`}>
                                {busy === 'resync' ? 'Reenviando...' : 'Reenviar aprobados'}
                            </button>
                        </div>
                    </Step>
                </div>
            </div>

            {message && (
                <p className={`mt-4 text-sm font-bold ${message.tone === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>
            )}

            {showReview && scanned && (
                <WooStockReview
                    key={reviewKey}
                    sendingEnabled={Boolean(health?.enabled)}
                    onChanged={() => void fetchHealth()}
                    runQueue={() => invokeFunction('run')}
                />
            )}
        </div>
    );
};

export default WooStockSyncCard;
