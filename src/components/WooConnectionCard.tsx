import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    WOO_FUNCTION_URL,
    WooHealth,
    fetchWooHealth,
    invokeWooFunction,
    isWooConfigured,
    randomSecret,
    setWooCredential,
} from '../utils/wooStockSync';

// Conexión con la API REST de WooCommerce, en Configuración → Integraciones.
// Solo guarda y verifica las credenciales: qué productos reciben stock se
// decide en Abastecimiento → Tienda Web. Las claves nunca vuelven al
// navegador; la base solo informa si están puestas.

const WooConnectionCard: React.FC = () => {
    const [health, setHealth] = useState<WooHealth | null>(null);
    const [busy, setBusy] = useState<'save' | 'test' | null>(null);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const [storeUrl, setStoreUrl] = useState('');
    const [consumerKey, setConsumerKey] = useState('');
    const [consumerSecret, setConsumerSecret] = useState('');

    const refresh = async () => {
        try {
            const next = await fetchWooHealth();
            setHealth(next);
            if (next?.store_url) setStoreUrl((current) => current || next.store_url || '');
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    const run = async (kind: 'save' | 'test', action: () => Promise<string>) => {
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

        await setWooCredential('store_url', url);
        if (consumerKey.trim()) await setWooCredential('consumer_key', consumerKey.trim());
        if (consumerSecret.trim()) await setWooCredential('consumer_secret', consumerSecret.trim());
        // La dirección de la función y el secreto del aviso los pone el CRM
        // solo; el administrador no necesita conocerlos.
        await setWooCredential('function_url', WOO_FUNCTION_URL);
        if (!health?.credentials?.dispatch_secret) await setWooCredential('dispatch_secret', randomSecret());

        setConsumerKey('');
        setConsumerSecret('');
        return 'Configuración guardada. Prueba la conexión.';
    });

    const handleTest = () => run('test', async () => {
        const result = await invokeWooFunction('test');
        return `Conexión correcta${result.tienda ? ` con ${result.tienda}` : ''}: ${result.productos_en_tienda ?? 0} productos. No se modificó nada.`;
    });

    const creds = health?.credentials ?? {};
    const configured = isWooConfigured(health);
    const connection = health?.connection ?? null;
    const button = 'py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed';

    return (
        <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center font-bold text-2xl">
                    W
                </div>
                <div>
                    <h4 className="text-lg font-black text-gray-900">Tienda web (WooCommerce)</h4>
                    <p className="text-xs text-gray-500 font-medium">Conexión con la API REST de la tienda</p>
                </div>
            </div>

            <div className="space-y-3">
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

                {message && (
                    <p className={`text-sm font-bold ${message.tone === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>
                )}

                <p className="text-[11px] text-gray-400 font-medium">
                    Qué productos reciben stock se gestiona en{' '}
                    <Link to="/web-store" className="font-bold text-indigo-600 hover:underline">Abastecimiento → Tienda Web</Link>.
                </p>
            </div>
        </div>
    );
};

export default WooConnectionCard;
