import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabase';

// Revisión del cruce por SKU entre el inventario del CRM y el catálogo de la
// tienda. Nada se envía a la tienda sin pasar por aquí: cada SKU se aprueba
// uno a uno o en bloque, y solo lo aprobado recibe stock.

type MatchStatus = 'match' | 'approved' | 'broken' | 'duplicate' | 'no_stock_control' | 'crm_only' | 'woo_only';

type MatchRow = {
    sku: string;
    match_status: MatchStatus;
    crm_name: string | null;
    crm_stock: number | null;
    crm_skip_reason: string | null;
    woo_product_id: number | null;
    woo_parent_id: number | null;
    woo_name: string | null;
    woo_type: string | null;
    woo_product_status: string | null;
    woo_stock: number | null;
    woo_manage_stock: boolean | null;
    woo_count: number;
    approved_at: string | null;
    sync_status: string | null;
    last_synced_at: string | null;
    last_error: string | null;
    total_count: number;
};

const TABS: Array<{ key: MatchStatus; label: string; hint: string }> = [
    { key: 'match', label: 'Por aprobar', hint: 'El SKU existe una sola vez en ambos lados. Revisa que sea el mismo producto antes de aprobar.' },
    { key: 'approved', label: 'Aprobados', hint: 'Estos SKU reciben el stock del CRM cada vez que cambia.' },
    { key: 'broken', label: 'Vínculo roto', hint: 'Estaban aprobados, pero el producto ya no aparece en la tienda. Quita la aprobación y vuelve a aprobar tras corregir.' },
    { key: 'duplicate', label: 'SKU duplicado', hint: 'El SKU está en más de un producto de la tienda. Corrígelo en WordPress y vuelve a escanear.' },
    { key: 'no_stock_control', label: 'Sin control de stock', hint: 'En el CRM son servicios o se venden sin stock (cursos). No se envían para no dejarlos agotados en la web.' },
    { key: 'crm_only', label: 'Solo en CRM', hint: 'No existen en la tienda con ese SKU. Si el producto sí está publicado, revisa que tenga el mismo SKU.' },
    { key: 'woo_only', label: 'Solo en la web', hint: 'Productos de la tienda cuyo SKU no está en el CRM (o no tienen SKU). No se tocan.' },
];

const PAGE_SIZE = 50;

type Props = {
    sendingEnabled: boolean;
    onChanged: () => void;
    runQueue: () => Promise<Record<string, any>>;
};

const WooStockReview: React.FC<Props> = ({ sendingEnabled, onChanged, runQueue }) => {
    const [tab, setTab] = useState<MatchStatus>('match');
    const [summary, setSummary] = useState<Record<string, number>>({});
    const [rows, setRows] = useState<MatchRow[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [working, setWorking] = useState(false);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        setPage(0);
        setSelected(new Set());
    }, [tab, debouncedSearch]);

    const fetchSummary = async () => {
        const { data, error } = await supabase.rpc('woo_stock_match_summary');
        if (!error) setSummary((data ?? {}) as Record<string, number>);
    };

    const fetchRows = async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('woo_stock_match_review', {
            p_status: tab,
            p_search: debouncedSearch || null,
            p_limit: PAGE_SIZE,
            p_offset: page * PAGE_SIZE,
        });
        setLoading(false);
        if (error) {
            setMessage({ tone: 'error', text: `No se pudo cargar la revisión: ${error.message}` });
            return;
        }
        const list = (data ?? []) as MatchRow[];
        setRows(list);
        setTotal(list[0]?.total_count ?? 0);
    };

    useEffect(() => {
        void fetchSummary();
    }, []);

    useEffect(() => {
        void fetchRows();
    }, [tab, debouncedSearch, page]);

    const refresh = async () => {
        setSelected(new Set());
        await Promise.all([fetchRows(), fetchSummary()]);
        onChanged();
    };

    const selectable = tab === 'match' || tab === 'approved' || tab === 'broken';
    const allOnPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.sku));

    const toggleRow = (sku: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(sku)) next.delete(sku); else next.add(sku);
            return next;
        });
    };

    const togglePage = () => {
        setSelected((current) => {
            const next = new Set(current);
            if (allOnPageSelected) rows.forEach((row) => next.delete(row.sku));
            else rows.forEach((row) => next.add(row.sku));
            return next;
        });
    };

    const afterApproval = async (approved: number) => {
        if (approved === 0) return 'No se aprobó ningún SKU.';
        if (!sendingEnabled) {
            return `${approved} SKU aprobados. El envío está apagado: recibirán stock cuando lo enciendas.`;
        }
        const result = await runQueue();
        return `${approved} SKU aprobados. Enviados a la tienda: ${result.synced ?? 0}${result.failed ? ` · con error: ${result.failed}` : ''}.`;
    };

    const act = async (action: () => Promise<string>) => {
        setWorking(true);
        setMessage(null);
        try {
            setMessage({ tone: 'ok', text: await action() });
        } catch (error) {
            setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
        } finally {
            setWorking(false);
            await refresh();
        }
    };

    const approveSelected = () => act(async () => {
        const { data, error } = await supabase.rpc('approve_woo_stock_links', { p_skus: Array.from(selected), p_all: false });
        if (error) throw new Error(error.message);
        const text = await afterApproval(Number(data?.aprobados ?? 0));
        return data?.rechazados ? `${text} ${data.rechazados} no se aprobaron porque ya no coinciden.` : text;
    });

    const approveAll = () => {
        const count = summary.match ?? 0;
        const warning = sendingEnabled
            ? `Se aprobarán ${count} SKU y la tienda recibirá de inmediato el stock del CRM para todos ellos. ¿Continuar?`
            : `Se aprobarán ${count} SKU. Recibirán stock cuando enciendas el envío. ¿Continuar?`;
        if (!window.confirm(warning)) return;

        void act(async () => {
            const { data, error } = await supabase.rpc('approve_woo_stock_links', { p_skus: null, p_all: true });
            if (error) throw new Error(error.message);
            return afterApproval(Number(data?.aprobados ?? 0));
        });
    };

    const revokeSelected = () => {
        if (!window.confirm(`¿Quitar la aprobación de ${selected.size} SKU? Dejarán de recibir stock; la tienda conserva el valor que tenga.`)) return;
        void act(async () => {
            const { data, error } = await supabase.rpc('revoke_woo_stock_links', { p_skus: Array.from(selected) });
            if (error) throw new Error(error.message);
            return `Se quitó la aprobación de ${data?.quitados ?? 0} SKU.`;
        });
    };

    const currentTab = useMemo(() => TABS.find((t) => t.key === tab)!, [tab]);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const diffBadge = (row: MatchRow) => {
        if (row.crm_stock === null || row.crm_stock === undefined) return null;
        if (row.woo_stock === null || row.woo_stock === undefined || !row.woo_manage_stock) {
            return <span className="text-[10px] font-bold text-amber-600">La web no controla stock</span>;
        }
        const diff = row.crm_stock - row.woo_stock;
        if (diff === 0) return <span className="text-[10px] font-bold text-emerald-600">Igual</span>;
        return <span className="text-[10px] font-bold text-amber-600">{diff > 0 ? `+${diff}` : diff} al enviar</span>;
    };

    return (
        <div className="mt-6 rounded-3xl border border-gray-100 bg-gray-50/50 p-6 space-y-4">
            <div className="flex flex-wrap gap-2">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-3 py-2 rounded-xl text-xs font-black transition-all ${tab === t.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        {t.label} <span className="ml-1 text-gray-400">{summary[t.key] ?? 0}</span>
                    </button>
                ))}
            </div>

            <p className="text-xs text-gray-500 font-medium">{currentTab.hint}</p>

            <div className="flex flex-col md:flex-row gap-3 md:items-center">
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por SKU o nombre"
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium focus:border-indigo-400 focus:outline-none bg-white"
                />
                {tab === 'match' && (
                    <>
                        <button
                            onClick={approveSelected}
                            disabled={working || selected.size === 0}
                            className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest disabled:opacity-40"
                        >
                            Aprobar seleccionados ({selected.size})
                        </button>
                        <button
                            onClick={approveAll}
                            disabled={working || !(summary.match > 0)}
                            className="px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-600 text-xs font-black uppercase tracking-widest disabled:opacity-40"
                        >
                            Aprobar todos ({summary.match ?? 0})
                        </button>
                    </>
                )}
                {(tab === 'approved' || tab === 'broken') && (
                    <button
                        onClick={revokeSelected}
                        disabled={working || selected.size === 0}
                        className="px-4 py-2.5 rounded-xl border border-rose-200 text-rose-600 text-xs font-black uppercase tracking-widest disabled:opacity-40"
                    >
                        Quitar aprobación ({selected.size})
                    </button>
                )}
            </div>

            {message && (
                <p className={`text-sm font-bold ${message.tone === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{message.text}</p>
            )}

            <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-400">
                        <tr>
                            {selectable && (
                                <th className="px-3 py-3 w-8">
                                    <input type="checkbox" checked={allOnPageSelected} onChange={togglePage} />
                                </th>
                            )}
                            <th className="px-3 py-3 text-left">SKU</th>
                            <th className="px-3 py-3 text-left">Producto en el CRM</th>
                            <th className="px-3 py-3 text-right">Stock CRM</th>
                            <th className="px-3 py-3 text-left">Producto en la web</th>
                            <th className="px-3 py-3 text-right">Stock web</th>
                            <th className="px-3 py-3 text-left">{tab === 'approved' ? 'Último envío' : 'Diferencia'}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {loading ? (
                            <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 font-bold">Cargando...</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400 font-bold">Sin productos en esta categoría.</td></tr>
                        ) : rows.map((row) => (
                            <tr key={row.sku} className={selected.has(row.sku) ? 'bg-indigo-50/40' : ''}>
                                {selectable && (
                                    <td className="px-3 py-2">
                                        <input type="checkbox" checked={selected.has(row.sku)} onChange={() => toggleRow(row.sku)} />
                                    </td>
                                )}
                                <td className="px-3 py-2 font-mono text-xs text-gray-700">{row.sku}</td>
                                <td className="px-3 py-2 text-gray-800">
                                    {row.crm_name ?? <span className="text-gray-300">—</span>}
                                    {row.crm_skip_reason && <span className="ml-2 text-[10px] font-bold text-gray-400">({row.crm_skip_reason})</span>}
                                </td>
                                <td className="px-3 py-2 text-right font-bold text-gray-800">{row.crm_stock ?? '—'}</td>
                                <td className="px-3 py-2 text-gray-800">
                                    {row.woo_name ?? <span className="text-gray-300">—</span>}
                                    <div className="flex gap-2 text-[10px] font-bold text-gray-400">
                                        {row.woo_product_id && <span>#{row.woo_product_id}</span>}
                                        {row.woo_type === 'variation' && <span>variación</span>}
                                        {row.woo_type === 'variable' && <span className="text-amber-600">producto variable (el stock suele ir en las variaciones)</span>}
                                        {row.woo_product_status && row.woo_product_status !== 'publish' && <span>{row.woo_product_status}</span>}
                                        {row.woo_count > 1 && <span className="text-rose-600">{row.woo_count} productos con este SKU</span>}
                                    </div>
                                </td>
                                <td className="px-3 py-2 text-right text-gray-600">{row.woo_manage_stock ? row.woo_stock ?? '—' : '—'}</td>
                                <td className="px-3 py-2">
                                    {tab === 'approved' ? (
                                        row.sync_status === 'failed' ? (
                                            <span className="text-[10px] font-bold text-rose-600">{row.last_error}</span>
                                        ) : row.last_synced_at ? (
                                            <span className="text-[10px] font-bold text-gray-500">{new Date(row.last_synced_at).toLocaleString('es-CL')}</span>
                                        ) : (
                                            <span className="text-[10px] font-bold text-amber-600">Pendiente</span>
                                        )
                                    ) : diffBadge(row)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {total > PAGE_SIZE && (
                <div className="flex items-center justify-between text-xs font-bold text-gray-500">
                    <span>{total} SKU · página {page + 1} de {pages}</span>
                    <div className="flex gap-2">
                        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Anterior</button>
                        <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Siguiente</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WooStockReview;
