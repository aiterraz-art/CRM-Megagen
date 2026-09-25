import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import WooStockReview from '../components/WooStockReview';
import { WooHealth, fetchWooHealth, invokeWooFunction, isWooConfigured, setWooCredential } from '../utils/wooStockSync';

// Gestión del stock que viaja a la tienda WooCommerce. La conexión con la
// tienda se configura en Configuración → Integraciones; aquí se decide qué
// productos reciben stock y se controla el envío. Vive en abastecimiento
// porque todo lo que se envía sale del inventario.

type BusyKind = 'scan' | 'run' | 'resync' | 'toggle';

const Step: React.FC<{ n: number; title: string; done: boolean; children: React.ReactNode }> = ({ n, title, done, children }) => (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {done ? '✓' : n}
            </span>
            <p className="text-sm font-black text-slate-900">{title}</p>
        </div>
        {children}
    </div>
);

const WebStore: React.FC = () => {
    const { hasPermission } = useUser();
    const isAdmin = hasPermission('MANAGE_WEB_STORE');

    const [health, setHealth] = useState<WooHealth | null>(null);
    const [busy, setBusy] = useState<BusyKind | null>(null);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const [showReview, setShowReview] = useState(true);
    const [reviewKey, setReviewKey] = useState(0);

    const refresh = async () => {
        try {
            setHealth(await fetchWooHealth());
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        }
    };

    useEffect(() => {
        if (isAdmin) void refresh();
    }, [isAdmin]);

    const run = async (kind: BusyKind, action: () => Promise<string>) => {
        setBusy(kind);
        setMessage(null);
        try {
            setMessage({ tone: 'ok', text: await action() });
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
            void refresh();
        }
    };

    const handleScan = () => run('scan', async () => {
        const result = await invokeWooFunction('scan');
        setShowReview(true);
        setReviewKey((k) => k + 1);
        return `Catálogo leído: ${result.productos ?? 0} productos y ${result.variaciones ?? 0} variaciones. No se modificó nada en la tienda.`;
    });

    const handleToggle = () => {
        const enabling = !health?.enabled;
        if (enabling && !window.confirm(`Al encender el envío, los ${health?.approved ?? 0} SKU aprobados recibirán el stock del CRM en la tienda. ¿Continuar?`)) return;

        void run('toggle', async () => {
            await setWooCredential('enabled', enabling ? 'true' : '');
            if (!enabling) return 'Envío apagado. La tienda deja de recibir cambios; las aprobaciones se conservan.';
            const result = await invokeWooFunction('run');
            return `Envío encendido. Enviados: ${result.synced ?? 0}${result.failed ? ` · con error: ${result.failed}` : ''}. Desde ahora viaja cada cambio de los SKU aprobados.`;
        });
    };

    const handleRunNow = () => run('run', async () => {
        const result = await invokeWooFunction('run');
        return `Enviados: ${result.synced ?? 0} · Con error: ${result.failed ?? 0}`;
    });

    const handleResync = () => {
        if (!window.confirm(`¿Reenviar el stock de los ${health?.approved ?? 0} SKU aprobados?`)) return;
        void run('resync', async () => {
            const { error } = await supabase.rpc('enqueue_all_woo_stock_sync');
            if (error) throw new Error(error.message);
            const result = await invokeWooFunction('run');
            return `Reenviados: ${result.synced ?? 0}${result.failed ? ` · con error: ${result.failed}` : ''}.`;
        });
    };

    if (!isAdmin) {
        return (
            <div className="max-w-3xl mx-auto premium-card p-10 text-center">
                <AlertTriangle className="mx-auto mb-4 text-amber-500" size={36} />
                <h2 className="text-2xl font-black text-slate-900 mb-2">Sin acceso a la tienda web</h2>
                <p className="text-slate-500 font-medium">Solo un administrador puede gestionar el stock que se envía a la tienda.</p>
            </div>
        );
    }

    const configured = isWooConfigured(health);
    const connection = health?.connection ?? null;
    const connected = configured && Boolean(connection?.ok);
    const scanned = Boolean(health?.last_scan_at);
    const button = 'py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed';

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-500 mb-2">Abastecimiento</p>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900">Tienda Web</h1>
                    <p className="text-slate-500 font-medium mt-2">
                        El stock del CRM se envía a la tienda WooCommerce solo para los SKU que apruebes.
                    </p>
                </div>
                <span className={`self-start lg:self-center px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest ${health?.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    {health?.enabled ? 'Envío encendido' : 'Envío apagado'}
                </span>
            </div>

            {connected ? (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <p className="text-sm font-black text-emerald-700">
                        Conectado{connection?.store_name ? ` a ${connection.store_name}` : ''}
                    </p>
                    <p className="text-xs text-emerald-800 font-medium break-all">{connection?.store_url}</p>
                    {connection?.consumer_key_suffix && (
                        <p className="text-xs text-emerald-800 font-medium">Clave <span className="font-mono">ck_…{connection.consumer_key_suffix}</span></p>
                    )}
                    <Link to="/settings" className="ml-auto text-xs font-bold text-emerald-700 hover:underline">Cambiar conexión</Link>
                </div>
            ) : (
                <div className="rounded-2xl bg-amber-50 border border-amber-100 px-5 py-4">
                    <p className="text-sm font-black text-amber-700">
                        {connection && !connection.ok ? 'La conexión con la tienda falló.' : 'La tienda aún no está conectada.'}
                    </p>
                    <p className="text-xs text-amber-700 font-medium mt-1">
                        Configura y prueba la conexión en{' '}
                        <Link to="/settings" className="font-bold underline">Configuración → Integraciones</Link>.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Step n={1} title="Escanear y revisar SKU" done={(health?.approved ?? 0) > 0}>
                    <p className="text-xs text-slate-500 font-medium">
                        Lee el catálogo de la tienda sin modificarlo y lo cruza con el inventario por SKU. Luego apruebas uno a uno o en bloque.
                    </p>
                    {scanned && (
                        <p className="text-xs text-slate-500 font-medium">
                            Último escaneo: {new Date(health!.last_scan_at!).toLocaleString('es-CL')} · {health!.catalog_size} productos/variaciones · {health!.approved} SKU aprobados
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button onClick={handleScan} disabled={busy !== null || !connected} className={`${button} flex-1 border border-indigo-200 text-indigo-600 hover:bg-indigo-50`}>
                            {busy === 'scan' ? 'Leyendo la tienda...' : scanned ? 'Volver a escanear' : 'Escanear tienda'}
                        </button>
                        <button onClick={() => setShowReview((v) => !v)} disabled={!scanned} className={`${button} flex-1 border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                            {showReview ? 'Ocultar revisión' : 'Revisar y aprobar'}
                        </button>
                    </div>
                </Step>

                <Step n={2} title="Envío de stock" done={Boolean(health?.enabled)}>
                    <p className="text-xs text-slate-500 font-medium">
                        Encendido, cada cambio de stock de un SKU aprobado viaja a la tienda. Apagado, no se envía nada.
                    </p>
                    {health && (health.approved > 0 || health.enabled) && (
                        <p className="text-xs text-slate-500 font-medium">
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
                        <button onClick={handleRunNow} disabled={busy !== null || !health?.enabled} className={`${button} flex-1 border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                            {busy === 'run' ? 'Enviando...' : 'Enviar pendientes'}
                        </button>
                        <button onClick={handleResync} disabled={busy !== null || !health?.enabled} className={`${button} flex-1 border border-slate-200 text-slate-700 hover:bg-slate-50`}>
                            {busy === 'resync' ? 'Reenviando...' : 'Reenviar aprobados'}
                        </button>
                    </div>
                </Step>
            </div>

            {message && (
                <p className={`text-sm font-bold ${message.tone === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>
            )}

            {showReview && scanned && (
                <WooStockReview
                    key={reviewKey}
                    sendingEnabled={Boolean(health?.enabled)}
                    onChanged={() => void refresh()}
                    runQueue={() => invokeWooFunction('run')}
                />
            )}
        </div>
    );
};

export default WebStore;
