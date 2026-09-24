// Stock del CRM hacia la tienda WooCommerce.
//
// Dos trabajos distintos:
//   - scan: lee el catálogo completo de la tienda (productos y variaciones) y
//     lo guarda en woo_catalog_snapshot para que un administrador revise el
//     cruce por SKU. Solo lee: no modifica nada en la tienda.
//   - run: vacía woo_stock_sync_queue. Solo contiene SKU aprobados, y cada
//     uno se escribe en el producto que se fijó al aprobarlo.
//
// Formas de llegar:
//   - El aviso del trigger y el barrido periódico: POST ?task=run con la
//     cabecera x-dispatch-secret.
//   - La pantalla de Configuración: POST ?task=test, ?task=scan o ?task=run
//     con la sesión de un administrador.
//
// La tienda nunca es fuente de stock para el CRM: lo que se lee en el escaneo
// solo sirve para comparar.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSupabaseClients, getAuthenticatedUser } from "../_shared/google-oauth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatch-secret",
};

const BATCH_SIZE = 100;
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 20_000;
// El aviso del trigger llega con cada importación; con este presupuesto una
// ejecución no se queda colgada y lo que falte lo toma la siguiente.
const RUN_BUDGET_MS = 50_000;

const log = (message: string, detail?: unknown) => {
  if (detail === undefined) {
    console.log(`[woo-stock] ${message}`);
  } else {
    console.log(`[woo-stock] ${message}`, JSON.stringify(detail));
  }
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

const serviceClient = (): SupabaseClient => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan las credenciales de Supabase");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
};

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

type WooConfig = {
  enabled: boolean;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  dispatchSecret: string;
};

const loadConfig = async (supabase: SupabaseClient): Promise<WooConfig> => {
  const { data, error } = await supabase.rpc("get_woo_stock_credentials");
  if (error) throw new Error(`No se pudo leer la configuración: ${error.message}`);
  const stored = (data ?? {}) as Record<string, string>;

  return {
    enabled: stored.enabled === "true",
    storeUrl: String(stored.store_url ?? "").trim().replace(/\/+$/, ""),
    consumerKey: String(stored.consumer_key ?? "").trim(),
    consumerSecret: String(stored.consumer_secret ?? "").trim(),
    dispatchSecret: String(stored.dispatch_secret ?? "").trim(),
  };
};

const assertStoreConfig = (config: WooConfig) => {
  if (!config.storeUrl || !config.consumerKey || !config.consumerSecret) {
    throw new Error("Falta la URL de la tienda o las claves de la API de WooCommerce");
  }
  // Las claves viajan en la URL: sin HTTPS quedarían expuestas en la red.
  if (!config.storeUrl.startsWith("https://")) {
    throw new Error("La URL de la tienda debe comenzar con https://");
  }
};

// ---------------------------------------------------------------------------
// API REST de WooCommerce
// ---------------------------------------------------------------------------

// Las claves van como parámetros y no en la cabecera Authorization porque
// muchos hostings de WordPress la descartan antes de que llegue a PHP. Es la
// forma que WooCommerce documenta para conexiones HTTPS.
const wooRequest = async (
  config: WooConfig,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string> = {},
  body?: unknown,
) => {
  const url = new URL(`${config.storeUrl}/wp-json/wc/v3/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("consumer_key", config.consumerKey);
  url.searchParams.set("consumer_secret", config.consumerSecret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method,
      headers: { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail = payload?.message || payload?.code || "sin detalle";
      throw new Error(`WooCommerce ${path} (HTTP ${response.status}): ${detail}`);
    }
    return { payload, headers: response.headers };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`WooCommerce ${path}: sin respuesta en ${REQUEST_TIMEOUT_MS / 1000} s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

// Recorre todas las páginas de un listado de la tienda.
const fetchAllPages = async (config: WooConfig, path: string) => {
  const items: any[] = [];
  for (let page = 1; ; page += 1) {
    const { payload, headers } = await wooRequest(config, "GET", path, {
      per_page: String(PAGE_SIZE),
      page: String(page),
      status: "any",
      orderby: "id",
      order: "asc",
    });
    const rows = Array.isArray(payload) ? payload : [];
    items.push(...rows);

    const totalPages = Number(headers.get("x-wp-totalpages") ?? 0);
    if (rows.length < PAGE_SIZE || (totalPages > 0 && page >= totalPages)) break;
  }
  return items;
};

// ---------------------------------------------------------------------------
// Escaneo del catálogo (solo lectura)
// ---------------------------------------------------------------------------

type SnapshotItem = {
  woo_id: number;
  parent_id: number | null;
  sku: string | null;
  name: string | null;
  product_type: string | null;
  product_status: string | null;
  manage_stock: boolean | null;
  stock_quantity: number | null;
};

const toSnapshotItem = (item: any, parent?: any): SnapshotItem => {
  // El nombre de una variación viene sin el del padre ni sus atributos en
  // algunas versiones; se arma uno legible para la revisión.
  const attributes = Array.isArray(item?.attributes)
    ? item.attributes.map((a: any) => a?.option).filter(Boolean).join(" / ")
    : "";
  const name = parent
    ? [parent?.name, attributes].filter(Boolean).join(" — ") || item?.name || null
    : item?.name ?? null;

  return {
    woo_id: Number(item.id),
    parent_id: parent ? Number(parent.id) : null,
    sku: item?.sku ? String(item.sku) : null,
    name,
    product_type: parent ? "variation" : item?.type ?? null,
    product_status: item?.status ?? parent?.status ?? null,
    // En una variación, "parent" significa que hereda el stock del padre.
    manage_stock: item?.manage_stock === true,
    stock_quantity: item?.stock_quantity === null || item?.stock_quantity === undefined
      ? null
      : Number(item.stock_quantity),
  };
};

const handleScan = async (supabase: SupabaseClient, config: WooConfig) => {
  assertStoreConfig(config);
  const scanId = crypto.randomUUID();

  const stage = async (items: SnapshotItem[]) => {
    for (let i = 0; i < items.length; i += 500) {
      const { error } = await supabase.rpc("stage_woo_catalog_snapshot", {
        p_scan_id: scanId,
        p_items: items.slice(i, i + 500),
      });
      if (error) throw new Error(`No se pudo guardar el catálogo: ${error.message}`);
    }
  };

  const products = await fetchAllPages(config, "products");
  await stage(products.map((p) => toSnapshotItem(p)));

  let variations = 0;
  for (const product of products.filter((p) => p?.type === "variable")) {
    const rows = await fetchAllPages(config, `products/${product.id}/variations`);
    variations += rows.length;
    await stage(rows.map((v) => toSnapshotItem(v, product)));
  }

  // Recién con el escaneo completo se reemplaza la foto anterior.
  const { data, error } = await supabase.rpc("finalize_woo_catalog_snapshot", { p_scan_id: scanId });
  if (error) throw new Error(`No se pudo cerrar el escaneo: ${error.message}`);

  // Un escaneo completo también demuestra que la conexión funciona.
  await recordConnection(supabase, true, { storeName: await fetchStoreName(config), productsCount: products.length });

  log("escaneo terminado", { productos: products.length, variaciones: variations });
  return json({ ok: true, productos: products.length, variaciones: variations, ...(data ?? {}) });
};

// ---------------------------------------------------------------------------
// Envío de stock
// ---------------------------------------------------------------------------

type BatchItemResult = { ok: true } | { ok: false; error: string };

// Escribe el stock de varios productos del mismo padre (o simples) en una
// sola llamada. manage_stock se fuerza: sin él WooCommerce ignora la cantidad.
const writeStock = async (
  config: WooConfig,
  parentId: number | null,
  updates: Array<{ id: number; qty: number }>,
) => {
  const results = new Map<number, BatchItemResult>();
  const path = parentId ? `products/${parentId}/variations/batch` : "products/batch";

  const { payload } = await wooRequest(config, "POST", path, {}, {
    update: updates.map((u) => ({ id: u.id, manage_stock: true, stock_quantity: u.qty })),
  });

  const returned = Array.isArray(payload?.update) ? payload.update : [];
  for (const item of returned) {
    const id = Number(item?.id);
    if (item?.error) {
      const code = String(item.error.code ?? "");
      const missing = code.includes("invalid_id") || Number(item.error.data?.status) === 404;
      results.set(id, {
        ok: false,
        error: missing
          ? "El producto ya no existe en la tienda. Vuelve a escanear y revisa el vínculo."
          : String(item.error.message ?? code ?? "error desconocido"),
      });
    } else {
      results.set(id, { ok: true });
    }
  }

  // Lo que la tienda no devolvió no se puede dar por escrito.
  for (const u of updates) {
    if (!results.has(u.id)) {
      results.set(u.id, { ok: false, error: "La tienda no confirmó la actualización" });
    }
  }

  return results;
};

type ClaimedRow = {
  sku: string;
  stock_qty: number;
  skip_reason: string | null;
  woo_product_id: number | null;
  woo_parent_id: number | null;
  attempts: number;
};

type RowResult = {
  sku: string;
  status: "synced" | "failed" | "skipped";
  qty?: number;
  error?: string;
};

const processBatch = async (config: WooConfig, rows: ClaimedRow[]): Promise<RowResult[]> => {
  const results: RowResult[] = [];
  const groups = new Map<string, ClaimedRow[]>();

  for (const row of rows) {
    if (row.skip_reason || !row.woo_product_id) {
      results.push({ sku: row.sku, status: "skipped", error: `No se envía: ${row.skip_reason ?? "sin vínculo"}` });
      continue;
    }
    const key = String(row.woo_parent_id ?? "simple");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const group of groups.values()) {
    const parentId = group[0].woo_parent_id;
    try {
      const written = await writeStock(
        config,
        parentId,
        group.map((row) => ({ id: Number(row.woo_product_id), qty: row.stock_qty })),
      );

      for (const row of group) {
        const outcome = written.get(Number(row.woo_product_id));
        if (outcome?.ok) {
          results.push({ sku: row.sku, status: "synced", qty: row.stock_qty });
        } else {
          results.push({
            sku: row.sku,
            status: "failed",
            error: outcome && !outcome.ok ? outcome.error : "error desconocido",
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of group) {
        results.push({ sku: row.sku, status: "failed", error: message });
      }
    }
  }

  return results;
};

const runQueue = async (supabase: SupabaseClient, config: WooConfig) => {
  const startedAt = Date.now();
  const totals = { synced: 0, failed: 0, skipped: 0, lotes: 0 };

  while (Date.now() - startedAt < RUN_BUDGET_MS) {
    const { data, error } = await supabase.rpc("claim_woo_stock_sync_batch", { p_limit: BATCH_SIZE });
    if (error) throw new Error(`No se pudo tomar la cola: ${error.message}`);

    const rows = (data ?? []) as ClaimedRow[];
    if (rows.length === 0) break;

    let results: RowResult[];
    try {
      results = await processBatch(config, rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results = rows.map((row) => ({ sku: row.sku, status: "failed" as const, error: message }));
    }

    const { error: completeError } = await supabase.rpc("complete_woo_stock_sync_batch", {
      p_results: results,
    });
    if (completeError) throw new Error(`No se pudo registrar el resultado: ${completeError.message}`);

    totals.lotes += 1;
    for (const result of results) totals[result.status] += 1;

    // Si todo el lote falló, la tienda probablemente está caída: insistir
    // ahora solo consume el presupuesto. El reintento con espera lo retoma.
    if (results.every((r) => r.status === "failed")) break;
  }

  log("ejecución terminada", totals);
  return totals;
};

// ---------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------

// Comparación de tiempo constante, igual que la firma de Meta.
const safeEqual = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const isAdminRequest = async (req: Request) => {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return false;

  try {
    const { userClient, serviceClient: service } = createSupabaseClients(authHeader);
    const user = await getAuthenticatedUser(userClient);
    const { data } = await service.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return String(data?.role ?? "").toLowerCase() === "admin";
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

// El nombre del sitio sale del índice público de WordPress. Es un dato de
// cortesía para reconocer la tienda: si no responde, la conexión sigue siendo
// válida.
const fetchStoreName = async (config: WooConfig) => {
  try {
    const response = await fetch(`${config.storeUrl}/wp-json/`, { headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    return payload?.name ? String(payload.name) : null;
  } catch {
    return null;
  }
};

const recordConnection = async (
  supabase: SupabaseClient,
  ok: boolean,
  detail: { storeName?: string | null; productsCount?: number | null; error?: string } = {},
) => {
  const { error } = await supabase.rpc("record_woo_connection_status", {
    p_ok: ok,
    p_store_name: detail.storeName ?? null,
    p_products_count: detail.productsCount ?? null,
    p_error: detail.error ?? null,
  });
  if (error) log("no se pudo registrar el estado de la conexión", { error: error.message });
};

const handleTest = async (supabase: SupabaseClient, config: WooConfig) => {
  assertStoreConfig(config);
  try {
    const { headers } = await wooRequest(config, "GET", "products", { per_page: "1", status: "any" });
    const productsCount = Number(headers.get("x-wp-total") ?? 0);
    const storeName = await fetchStoreName(config);
    await recordConnection(supabase, true, { storeName, productsCount });
    return json({ ok: true, tienda: storeName, productos_en_tienda: productsCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordConnection(supabase, false, { error: message });
    throw error;
  }
};

const handleRun = async (supabase: SupabaseClient, config: WooConfig, fromDispatch: boolean) => {
  if (!config.enabled) {
    return json({ ok: false, error: "El envío a la tienda web está apagado" }, 409);
  }
  assertStoreConfig(config);

  const trabajo = runQueue(supabase, config);

  // pg_net espera la respuesta solo cinco segundos. Para el aviso del trigger
  // se responde de inmediato y se sigue trabajando; la pantalla sí espera el
  // resultado para mostrarlo.
  const runtime = (globalThis as any).EdgeRuntime;
  if (fromDispatch && runtime?.waitUntil) {
    runtime.waitUntil(trabajo.catch((error) => log("fallo en la ejecución", { error: String(error) })));
    return json({ ok: true, en_curso: true }, 202);
  }

  return json({ ok: true, ...(await trabajo) });
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const url = new URL(req.url);
  const task = url.searchParams.get("task") ?? "run";

  try {
    const supabase = serviceClient();
    const config = await loadConfig(supabase);

    const dispatchHeader = req.headers.get("x-dispatch-secret") ?? "";
    const fromDispatch = safeEqual(dispatchHeader, config.dispatchSecret);
    const fromAdmin = !fromDispatch && await isAdminRequest(req);

    if (!fromDispatch && !fromAdmin) {
      return json({ error: "forbidden" }, 403);
    }

    // Probar y escanear son acciones de la pantalla; el aviso automático
    // solo puede enviar lo que ya está aprobado.
    if (task === "test" || task === "scan") {
      if (!fromAdmin) return json({ error: "forbidden" }, 403);
      return task === "test" ? await handleTest(supabase, config) : await handleScan(supabase, config);
    }

    if (task === "run") {
      return await handleRun(supabase, config, fromDispatch);
    }

    return json({ error: "tarea desconocida" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", { task, error: message });
    return json({ ok: false, error: message }, 500);
  }
});
