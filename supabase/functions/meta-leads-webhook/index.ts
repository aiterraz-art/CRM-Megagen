// Recepción automática de leads de Meta Lead Ads.
//
// Meta llama aquí en cuanto alguien envía un formulario. El aviso solo trae el
// identificador del lead, así que hay que ir a buscar los datos a la Graph API.
//
// Dos reglas mandan sobre el diseño de esta función:
//   1. Responder 200 rápido y siempre. Meta reintenta ante demora o error y
//      termina desactivando la suscripción si el endpoint falla seguido.
//   2. Nunca perder un aviso. Lo primero que se hace es guardarlo crudo; la
//      consulta a la Graph API y el alta del cliente vienen después y, si algo
//      falla, el aviso queda pendiente para el reintento.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const encoder = new TextEncoder();

const log = (message: string, detail?: unknown) => {
  if (detail === undefined) {
    console.log(`[meta-leads] ${message}`);
  } else {
    console.log(`[meta-leads] ${message}`, JSON.stringify(detail));
  }
};

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

type MetaConfig = {
  appSecret: string;
  verifyToken: string;
  pageAccessToken: string;
  graphVersion: string;
  retrySecret: string;
};

const serviceClient = (): SupabaseClient => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan las credenciales de Supabase");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
};

// Las credenciales de Meta viven en la tabla meta_lead_credentials para poder
// rotarlas desde el CRM sin reiniciar el contenedor; el token de página caduca
// a los 60 días salvo que sea de usuario de sistema. Las variables de entorno
// quedan como respaldo por si se prefiere configurarlas en Coolify.
let configCache: { value: MetaConfig; expiresAt: number } | null = null;

const loadConfig = async (): Promise<MetaConfig> => {
  if (configCache && configCache.expiresAt > Date.now()) {
    return configCache.value;
  }

  let stored: Record<string, string> = {};
  try {
    const { data, error } = await serviceClient().rpc("get_meta_lead_credentials");
    if (error) throw new Error(error.message);
    stored = (data ?? {}) as Record<string, string>;
  } catch (error) {
    log("no se pudieron leer las credenciales guardadas", { error: String(error) });
  }

  const pick = (key: string, envKey: string, fallback = "") =>
    stored[key] || Deno.env.get(envKey) || fallback;

  const value: MetaConfig = {
    appSecret: pick("app_secret", "META_APP_SECRET"),
    verifyToken: pick("verify_token", "META_VERIFY_TOKEN"),
    pageAccessToken: pick("page_access_token", "META_PAGE_ACCESS_TOKEN"),
    graphVersion: pick("graph_version", "META_GRAPH_VERSION", "v21.0"),
    retrySecret: pick("retry_secret", "META_RETRY_SECRET"),
  };

  // Caché corta: suficiente para no consultar en cada aviso de una ráfaga, y
  // lo bastante breve para que una rotación de token surta efecto sola.
  configCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
};

// ---------------------------------------------------------------------------
// Firma del aviso
// ---------------------------------------------------------------------------

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

// Comparación de tiempo constante: comparar con === filtra información sobre
// cuántos caracteres de la firma acertó quien la envía.
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const verifySignature = async (rawBody: string, header: string | null, appSecret: string) => {
  if (!appSecret) {
    throw new Error("Falta el secreto de la aplicación de Meta");
  }
  if (!header || !header.startsWith("sha256=")) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));

  return safeEqual(header.slice("sha256=".length).toLowerCase(), toHex(signature));
};

// ---------------------------------------------------------------------------
// Graph API
// ---------------------------------------------------------------------------

const graphGet = async (config: MetaConfig, path: string, params: Record<string, string>) => {
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("access_token", config.pageAccessToken);

  const response = await fetch(url.toString(), { headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Graph API ${path}: ${detail}`);
  }
  return payload;
};

// Los nombres de campaña, anuncio y formulario son un lujo, no un requisito:
// si Meta no los entrega, el lead entra igual sin ellos.
const fetchCampaignContext = async (config: MetaConfig, lead: Record<string, any>) => {
  const context: Record<string, string> = {};

  if (lead?.ad_id) {
    try {
      const ad = await graphGet(config, String(lead.ad_id), { fields: "name,adset{name},campaign{name}" });
      if (ad?.name) context.ad_name = String(ad.name);
      if (ad?.adset?.name) context.adset_name = String(ad.adset.name);
      if (ad?.campaign?.name) context.campaign_name = String(ad.campaign.name);
    } catch (error) {
      log("no se pudo leer el anuncio", { ad_id: lead.ad_id, error: String(error) });
    }
  }

  if (lead?.form_id) {
    try {
      const form = await graphGet(config, String(lead.form_id), { fields: "name" });
      if (form?.name) context.form_name = String(form.name);
    } catch (error) {
      log("no se pudo leer el formulario", { form_id: lead.form_id, error: String(error) });
    }
  }

  return context;
};

// ---------------------------------------------------------------------------
// Procesamiento
// ---------------------------------------------------------------------------

const processLead = async (config: MetaConfig, leadgenId: string) => {
  const supabase = serviceClient();

  try {
    if (!config.pageAccessToken) {
      throw new Error("Falta el token de página de Meta");
    }

    const lead = await graphGet(config, leadgenId, {
      fields: "id,created_time,field_data,ad_id,adgroup_id,campaign_id,form_id,platform,is_organic",
    });

    const context = await fetchCampaignContext(config, lead);

    const { data, error } = await supabase.rpc("process_meta_lead", {
      p_leadgen_id: leadgenId,
      p_field_data: lead?.field_data ?? [],
      p_context: context,
    });

    if (error) throw new Error(error.message);

    log("lead procesado", { leadgenId, resultado: data });
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("fallo procesando el lead", { leadgenId, error: message });
    await supabase.rpc("fail_meta_lead_event", { p_leadgen_id: leadgenId, p_error: message });
    return null;
  }
};

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

// Suscripción del webhook: Meta pide confirmar que el endpoint es nuestro.
const handleVerification = async (url: URL) => {
  const config = await loadConfig();
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && config.verifyToken && token === config.verifyToken) {
    log("verificación de webhook aceptada");
    return new Response(challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  log("verificación de webhook rechazada", { mode, tokenRecibido: Boolean(token) });
  return new Response("forbidden", { status: 403 });
};

// Barrido de pendientes: cubre los avisos cuya consulta a la Graph API falló.
const handleRetry = async (req: Request) => {
  const config = await loadConfig();
  if (!config.retrySecret || req.headers.get("x-retry-secret") !== config.retrySecret) {
    return new Response("forbidden", { status: 403 });
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("pending_meta_lead_events", { p_limit: 25 });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const pending = (data ?? []) as Array<{ leadgen_id: string }>;
  for (const item of pending) {
    await processLead(config, item.leadgen_id);
  }

  return new Response(JSON.stringify({ reintentados: pending.length }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const handleNotification = async (req: Request) => {
  const config = await loadConfig();

  // La firma se calcula sobre el cuerpo exacto: hay que leerlo como texto antes
  // de parsearlo, porque volver a serializar el JSON cambia los bytes.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  let valid = false;
  try {
    valid = await verifySignature(rawBody, signature, config.appSecret);
  } catch (error) {
    log("no se pudo validar la firma", { error: String(error) });
    return new Response("server not configured", { status: 500 });
  }

  if (!valid) {
    log("firma inválida, aviso descartado");
    return new Response("invalid signature", { status: 401 });
  }

  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  const supabase = serviceClient();
  const pendientes: string[] = [];

  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== "leadgen") continue;

      const value = change?.value ?? {};
      const leadgenId = value?.leadgen_id ? String(value.leadgen_id) : "";
      if (!leadgenId) continue;

      const { data, error } = await supabase.rpc("record_meta_lead_event", {
        p_leadgen_id: leadgenId,
        p_page_id: value?.page_id ? String(value.page_id) : null,
        p_form_id: value?.form_id ? String(value.form_id) : null,
        p_ad_id: value?.ad_id ? String(value.ad_id) : null,
        p_adgroup_id: value?.adgroup_id ? String(value.adgroup_id) : null,
        p_campaign_id: value?.campaign_id ? String(value.campaign_id) : null,
        p_created_time: value?.created_time
          ? new Date(Number(value.created_time) * 1000).toISOString()
          : null,
        p_raw_payload: change,
      });

      if (error) {
        // Si ni siquiera se pudo guardar el aviso, devolver un error hace que
        // Meta reintente, que es exactamente lo que se quiere aquí.
        log("no se pudo guardar el aviso", { leadgenId, error: error.message });
        return new Response("storage error", { status: 500 });
      }

      log("aviso recibido", { leadgenId, resultado: data });
      if (data?.needs_processing) {
        pendientes.push(leadgenId);
      }
    }
  }

  const trabajo = (async () => {
    for (const leadgenId of pendientes) {
      await processLead(config, leadgenId);
    }
  })();

  // El runtime de Supabase permite seguir trabajando después de responder. Si
  // no está disponible se espera al procesamiento, que sigue siendo correcto
  // aunque la respuesta a Meta tarde un poco más.
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(trabajo);
  } else {
    await trabajo;
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
};

serve(async (req) => {
  const url = new URL(req.url);

  try {
    if (url.searchParams.get("task") === "retry") {
      return await handleRetry(req);
    }

    if (req.method === "GET") {
      return await handleVerification(url);
    }

    if (req.method === "POST") {
      return await handleNotification(req);
    }

    return new Response("method not allowed", { status: 405 });
  } catch (error) {
    log("error no controlado", { error: String(error) });
    // Ante la duda se responde 200: un 500 repetido hace que Meta desactive la
    // suscripción, y perder la suscripción es peor que perder un aviso.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
});
