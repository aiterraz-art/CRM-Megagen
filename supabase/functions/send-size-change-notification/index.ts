import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createSupabaseClients,
  encodeUtf8Base64,
  getAuthenticatedUser,
  refreshGoogleAccessTokenForUser,
  sendRawGmailMessage,
} from "../_shared/google-oauth.ts";

const SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL = (
  Deno.env.get("SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL") ??
  Deno.env.get("ORDER_NOTIFICATION_SENDER_EMAIL") ??
  ""
).trim().toLowerCase();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizeEmail = (value: string | null | undefined) => String(value || "").trim().toLowerCase();
const formatMoney = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString("es-CL")}`;
const formatDateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Santiago",
    }).format(new Date(value))
    : "Sin registro";

const buildMimeMessage = (input: {
  senderEmail: string;
  toRecipients: string[];
  subject: string;
  message: string;
}) => {
  const boundary = `crm_boundary_${crypto.randomUUID()}`;
  const parts: Array<string | null> = [
    `From: ${input.senderEmail}`,
    `To: ${input.toRecipients.join(", ")}`,
    `Subject: =?utf-8?B?${encodeUtf8Base64(input.subject)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    input.message,
    "",
    `--${boundary}--`,
  ];

  return parts.filter(Boolean).join("\r\n");
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    if (!SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL) {
      throw new Error("SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL is missing");
    }

    const clients = createSupabaseClients(authHeader);
    const { userClient, serviceClient } = clients;
    const authUser = await getAuthenticatedUser(userClient);

    const payload = await req.json();
    const requestId = String(payload?.requestId || "").trim();
    if (!requestId) {
      throw new Error("Missing requestId");
    }

    const { data: actorProfile, error: actorError } = await serviceClient
      .from("profiles")
      .select("id, role")
      .eq("id", authUser.id)
      .single();
    if (actorError || !actorProfile) throw actorError || new Error("Actor profile not found");

    const { data: request, error: requestError } = await serviceClient
      .from("size_change_requests")
      .select("id, folio, client_id, seller_id, created_by, status, client_name_snapshot, seller_name_snapshot, request_comment, created_at")
      .eq("id", requestId)
      .single();
    if (requestError || !request) throw requestError || new Error("Size change request not found");

    const actorRole = String(actorProfile.role || "").trim().toLowerCase();
    const isAllowedActor = request.seller_id === authUser.id
      || request.created_by === authUser.id
      || actorRole === "admin"
      || actorRole === "facturador"
      || actorRole === "tesorero";
    if (!isAllowedActor) {
      throw new Error("No tienes permisos para notificar este cambio de medida");
    }

    const [clientRes, sellerRes, itemsRes, recipientsRes, senderRes] = await Promise.all([
      serviceClient.from("clients").select("id, name, rut").eq("id", request.client_id).single(),
      serviceClient.from("profiles").select("id, full_name, email").eq("id", request.seller_id).single(),
      serviceClient
        .from("size_change_request_items")
        .select("sku_snapshot, product_name_snapshot, qty, unit_price, line_total")
        .eq("request_id", request.id)
        .order("created_at", { ascending: true }),
      serviceClient
        .from("profiles")
        .select("email")
        .eq("status", "active")
        .eq("role", "facturador"),
      serviceClient
        .from("profiles")
        .select("id, full_name, email, status")
        .eq("email", SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL)
        .maybeSingle(),
    ]);

    if (clientRes.error || !clientRes.data) throw clientRes.error || new Error("Client not found");
    if (sellerRes.error || !sellerRes.data) throw sellerRes.error || new Error("Seller not found");
    if (itemsRes.error) throw itemsRes.error;
    if (recipientsRes.error) throw recipientsRes.error;
    if (senderRes.error) throw senderRes.error;
    if (!senderRes.data) throw new Error(`No existe un profile para ${SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL}`);
    if (String(senderRes.data.status || "").toLowerCase() !== "active") {
      throw new Error(`La cuenta emisora ${SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL} no está activa`);
    }

    const toRecipients = Array.from(
      new Set((recipientsRes.data || []).map((row) => normalizeEmail(row.email)).filter(Boolean)),
    );
    if (toRecipients.length === 0) {
      throw new Error("No hay usuarios facturador activos configurados");
    }

    const subject = `Cambio de medida #${request.folio} - ${request.client_name_snapshot}`;
    const lines = (itemsRes.data || []).map((item) =>
      `- ${item.sku_snapshot || "Sin SKU"} | ${item.product_name_snapshot} | Cant: ${Number(item.qty || 0).toLocaleString("es-CL")} | Valor: ${formatMoney(Number(item.unit_price || 0))} | Total: ${formatMoney(Number(item.line_total || 0))}`,
    );
    const totalAmount = (itemsRes.data || []).reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    const sellerName = sellerRes.data.full_name?.trim() || sellerRes.data.email || request.seller_name_snapshot || "Vendedor";
    const message = [
      "Equipo de facturación,",
      "",
      `Ingresó una nueva solicitud de cambio de medida #${request.folio}.`,
      `Cliente: ${clientRes.data.name}`,
      `RUT: ${clientRes.data.rut || "Sin RUT"}`,
      `Vendedor: ${sellerName}`,
      `Fecha de creación: ${formatDateTime(request.created_at)}`,
      `Monto total: ${formatMoney(totalAmount)}`,
      "",
      "Detalle:",
      ...(lines.length > 0 ? lines : ["- Sin líneas registradas"]),
      "",
      `Comentarios: ${request.request_comment?.trim() || "Sin comentarios."}`,
      "",
      "Revisa el módulo Cambios de Medida para gestionar el envío.",
    ].join("\n");

    const { accessToken } = await refreshGoogleAccessTokenForUser(serviceClient, senderRes.data.id);
    const gmailResult = await sendRawGmailMessage(accessToken, buildMimeMessage({
      senderEmail: SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL,
      toRecipients,
      subject,
      message,
    }));

    const { error: emailLogError } = await serviceClient.from("email_logs").insert({
      client_id: clientRes.data.id,
      user_id: request.seller_id,
      subject,
      snippet: message.slice(0, 500),
    });
    if (emailLogError) {
      console.warn("send-size-change-notification: email_logs insert failed", emailLogError.message);
    }

    return jsonResponse({
      status: "sent",
      senderEmail: SIZE_CHANGE_NOTIFICATION_SENDER_EMAIL,
      toRecipients,
      gmailMessageId: gmailResult.messageId,
      gmailThreadId: gmailResult.threadId,
    });
  } catch (error: any) {
    return jsonResponse({
      error: error?.message || "Unknown error",
    }, 400);
  }
});
