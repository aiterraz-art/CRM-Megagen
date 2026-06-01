import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createSupabaseClients,
  getAuthenticatedUser,
  refreshGoogleAccessTokenForUser,
  sendRawGmailMessage,
  encodeUtf8Base64,
} from "../_shared/google-oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestSource = "creation" | "manual_resend";

type PdfAttachment = {
  name: string;
  mimeType: string;
  contentBase64: string;
};

const normalizeEmail = (value: string | null | undefined) => String(value || "").trim().toLowerCase();
const formatMoney = (value: number | null | undefined, currency: "CLP" | "USD") =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "CLP" ? 0 : 2,
    maximumFractionDigits: currency === "CLP" ? 0 : 2,
  }).format(Number(value || 0));

const buildMimeMessage = (input: {
  senderEmail: string;
  toRecipients: string[];
  subject: string;
  message: string;
  attachments: Array<{ name: string; mimeType: string; contentBase64: string }>;
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
  ];

  for (const attachment of input.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType || "application/octet-stream"}; name="${attachment.name}"`,
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      attachment.contentBase64,
      "",
    );
  }

  parts.push(`--${boundary}--`);
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

  let serviceClient: ReturnType<typeof createSupabaseClients>["serviceClient"] | null = null;
  let purchaseOrderId: string | null = null;
  let actorId: string | null = null;
  let requestSource: RequestSource = "creation";
  let senderEmail = "";
  let toRecipients: string[] = [];
  let subject = "";

  const recordFailure = async (message: string) => {
    if (!serviceClient || !purchaseOrderId || !actorId) return;

    await serviceClient.from("purchase_order_email_logs").insert({
      purchase_order_id: purchaseOrderId,
      triggered_by: actorId,
      sender_email: senderEmail || "",
      to_recipients: toRecipients,
      status: "failed",
      error_message: message,
      sent_at: null,
    });

    await serviceClient
      .from("purchase_orders")
      .update({
        status: "send_failed",
        email_status: "failed",
        email_error: message,
        sent_at: null,
        sent_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseOrderId);
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const clients = createSupabaseClients(authHeader);
    serviceClient = clients.serviceClient;
    const authUser = await getAuthenticatedUser(clients.userClient);
    actorId = authUser.id;

    const payload = await req.json();
    purchaseOrderId = String(payload?.purchaseOrderId || "").trim();
    requestSource = payload?.requestSource === "manual_resend" ? "manual_resend" : "creation";
    const pdfAttachment = payload?.pdfAttachment as PdfAttachment | undefined;

    if (!purchaseOrderId) throw new Error("Missing purchaseOrderId");
    if (!pdfAttachment?.name || !pdfAttachment?.mimeType || !pdfAttachment?.contentBase64) {
      throw new Error("Missing pdfAttachment");
    }

    const { data: actorProfile, error: actorError } = await serviceClient
      .from("profiles")
      .select("id, role, email, full_name")
      .eq("id", actorId)
      .single();
    if (actorError || !actorProfile) throw actorError || new Error("Actor profile not found");

    const normalizedRole = String(actorProfile.role || "").trim().toLowerCase();
    const isAllowedActor = normalizedRole === "admin" || normalizedRole === "bodega";
    if (!isAllowedActor) {
      throw new Error("No tienes permisos para enviar órdenes de compra");
    }

    const { data: purchaseOrder, error: purchaseOrderError } = await serviceClient
      .from("purchase_orders")
      .select("id, folio, supplier_name_snapshot, supplier_email_snapshot, currency, total_amount, general_notes, created_by, needed_by_date, status")
      .eq("id", purchaseOrderId)
      .single();
    if (purchaseOrderError || !purchaseOrder) throw purchaseOrderError || new Error("Purchase order not found");

    if (purchaseOrder.status === "cancelled") {
      throw new Error("No se puede reenviar una OC cancelada");
    }

    const { data: poItems, error: itemsError } = await serviceClient
      .from("purchase_order_items")
      .select("sku_snapshot, product_name_snapshot, qty, unit_price, discount_amount, line_total")
      .eq("purchase_order_id", purchaseOrderId)
      .order("id", { ascending: true });
    if (itemsError) throw itemsError;

    const supplierEmail = normalizeEmail(purchaseOrder.supplier_email_snapshot);
    if (!supplierEmail) throw new Error("El proveedor no tiene correo configurado");

    toRecipients = [supplierEmail];

    const { accessToken, googleEmail } = await refreshGoogleAccessTokenForUser(serviceClient, actorId);
    senderEmail = googleEmail || normalizeEmail(actorProfile.email);
    if (!senderEmail) {
      throw new Error("No se pudo resolver el correo emisor de Google");
    }

    const formattedFolio = `OC-${String(purchaseOrder.folio).padStart(6, "0")}`;
    subject = `Orden de Compra ${formattedFolio} - ${purchaseOrder.supplier_name_snapshot}`;

    const itemsPreview = (poItems || [])
      .slice(0, 6)
      .map((item) => `- ${item.product_name_snapshot} (${item.qty} x ${formatMoney(Number(item.unit_price || 0), purchaseOrder.currency as "CLP" | "USD")})`)
      .join("\n");

    const message = [
      `Hola ${purchaseOrder.supplier_name_snapshot},`,
      "",
      `Adjuntamos la Orden de Compra ${formattedFolio}.`,
      `Moneda: ${purchaseOrder.currency}`,
      `Total: ${formatMoney(Number(purchaseOrder.total_amount || 0), purchaseOrder.currency as "CLP" | "USD")}`,
      purchaseOrder.needed_by_date ? `Fecha requerida: ${purchaseOrder.needed_by_date}` : null,
      "",
      itemsPreview ? `Resumen:\n${itemsPreview}` : null,
      purchaseOrder.general_notes ? `\nObservaciones:\n${purchaseOrder.general_notes}` : null,
      "",
      "El detalle completo se encuentra en el PDF adjunto.",
      "",
      "Saludos,",
      actorProfile.full_name || actorProfile.email || "Equipo de logística",
    ]
      .filter(Boolean)
      .join("\n");

    const rawMimeMessage = buildMimeMessage({
      senderEmail,
      toRecipients,
      subject,
      message,
      attachments: [
        {
          name: pdfAttachment.name,
          mimeType: pdfAttachment.mimeType,
          contentBase64: pdfAttachment.contentBase64,
        },
      ],
    });

    const gmailResult = await sendRawGmailMessage(accessToken, rawMimeMessage);

    await serviceClient.from("purchase_order_email_logs").insert({
      purchase_order_id: purchaseOrderId,
      triggered_by: actorId,
      sender_email: senderEmail,
      to_recipients: toRecipients,
      status: "sent",
      error_message: null,
      gmail_message_id: gmailResult.messageId,
      gmail_thread_id: gmailResult.threadId,
      sent_at: new Date().toISOString(),
    });

    await serviceClient
      .from("purchase_orders")
      .update({
        status: "sent",
        email_status: "sent",
        email_error: null,
        sent_at: new Date().toISOString(),
        sent_by: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", purchaseOrderId);

    return jsonResponse({
      status: "sent",
      senderEmail,
      toRecipients,
      gmailMessageId: gmailResult.messageId,
      gmailThreadId: gmailResult.threadId,
    });
  } catch (error: any) {
    const message = error?.message || "Unknown error";
    await recordFailure(message);
    return jsonResponse({
      error: message,
      senderEmail,
      toRecipients,
    }, 400);
  }
});
