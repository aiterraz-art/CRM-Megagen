import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createSupabaseClients, getAuthenticatedUser, refreshGoogleAccessTokenForUser, sendRawGmailMessage, encodeUtf8Base64, bytesToBase64 } from "../_shared/google-oauth.ts";

const ORDER_NOTIFICATION_SENDER_EMAIL = (Deno.env.get("ORDER_NOTIFICATION_SENDER_EMAIL") ?? "").trim().toLowerCase();
const PAYMENT_PROOFS_BUCKET = "payment-proofs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestSource = "quotation_conversion" | "manual_resend";

type OrderPdfAttachment = {
  name: string;
  mimeType: string;
  contentBase64: string;
};

const normalizeEmail = (value: string | null | undefined) => String(value || "").trim().toLowerCase();

const formatMoney = (value: number | null | undefined) => `$${Number(value || 0).toLocaleString("es-CL")}`;

const buildMimeMessage = (input: {
  senderEmail: string;
  toRecipients: string[];
  ccRecipients: string[];
  subject: string;
  message: string;
  attachments: Array<{ name: string; mimeType: string; contentBase64: string }>;
}) => {
  const boundary = `crm_boundary_${crypto.randomUUID()}`;
  const parts: Array<string | null> = [
    `From: ${input.senderEmail}`,
    `To: ${input.toRecipients.join(", ")}`,
    input.ccRecipients.length > 0 ? `Cc: ${input.ccRecipients.join(", ")}` : null,
    `Subject: =?utf-8?B?${encodeUtf8Base64(input.subject)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=\"UTF-8\"",
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
  let orderId: string | null = null;
  let requestSource: RequestSource = "quotation_conversion";
  let actorId: string | null = null;
  let senderEmail = ORDER_NOTIFICATION_SENDER_EMAIL;
  let toRecipients: string[] = [];
  let ccRecipients: string[] = [];
  let subject = "";
  let bodyPreview = "";
  let attachmentsMeta: Array<Record<string, string>> = [];

  const recordFailure = async (message: string) => {
    if (!serviceClient || !orderId || !actorId) return;

    await serviceClient.from("order_notification_logs").insert({
      order_id: orderId,
      triggered_by: actorId,
      sender_email: senderEmail || "",
      to_recipients: toRecipients,
      cc_recipients: ccRecipients,
      subject,
      body_preview: bodyPreview || null,
      status: "failed",
      error_message: message,
      request_source: requestSource,
      attachments: attachmentsMeta,
      sent_at: null,
    });

    await serviceClient
      .from("orders")
      .update({
        payment_email_status: "failed",
        payment_email_error: message,
        payment_email_sent_at: null,
      })
      .eq("id", orderId);
  };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const clients = createSupabaseClients(authHeader);
    serviceClient = clients.serviceClient;
    const authUser = await getAuthenticatedUser(clients.userClient);
    actorId = authUser.id;

    const payload = await req.json();
    orderId = String(payload?.orderId || "").trim();
    requestSource = payload?.requestSource === "manual_resend" ? "manual_resend" : "quotation_conversion";
    const orderPdfAttachment = payload?.orderPdfAttachment as OrderPdfAttachment | undefined;

    if (!orderId) {
      throw new Error("Missing orderId");
    }
    if (!orderPdfAttachment?.name || !orderPdfAttachment?.mimeType || !orderPdfAttachment?.contentBase64) {
      throw new Error("Missing orderPdfAttachment");
    }
    if (!ORDER_NOTIFICATION_SENDER_EMAIL) {
      throw new Error("ORDER_NOTIFICATION_SENDER_EMAIL is missing");
    }

    const { data: actorProfile, error: actorError } = await serviceClient
      .from("profiles")
      .select("id, role, email, full_name")
      .eq("id", authUser.id)
      .single();
    if (actorError || !actorProfile) throw actorError || new Error("Actor profile not found");

    const { data: order, error: orderError } = await serviceClient
      .from("orders")
      .select("id, folio, quotation_id, client_id, user_id, total_amount, payment_proof_path, payment_proof_name, payment_proof_mime_type")
      .eq("id", orderId)
      .single();
    if (orderError || !order) throw orderError || new Error("Order not found");

    const actorRole = normalizeEmail(actorProfile.role).replace(/[^a-z_]/g, "") || String(actorProfile.role || "").trim().toLowerCase();
    const isAllowedActor = order.user_id === authUser.id || actorRole === "admin" || actorRole === "facturador";
    if (!isAllowedActor) {
      throw new Error("No tienes permisos para enviar este pedido a facturación");
    }

    const [clientRes, sellerRes, quotationRes, recipientsRes, senderRes] = await Promise.all([
      serviceClient.from("clients").select("id, name, rut, credit_days").eq("id", order.client_id).single(),
      serviceClient.from("profiles").select("id, full_name, email").eq("id", order.user_id).single(),
      order.quotation_id
        ? serviceClient.from("quotations").select("id, folio").eq("id", order.quotation_id).single()
        : Promise.resolve({ data: null, error: null } as const),
      serviceClient.from("profiles").select("id, full_name, email").eq("status", "active").eq("role", "facturador"),
      serviceClient.from("profiles").select("id, full_name, email, status").eq("email", ORDER_NOTIFICATION_SENDER_EMAIL).maybeSingle(),
    ]);

    if (clientRes.error || !clientRes.data) throw clientRes.error || new Error("Client not found");
    if (sellerRes.error || !sellerRes.data) throw sellerRes.error || new Error("Seller not found");
    if (quotationRes.error) throw quotationRes.error;
    if (recipientsRes.error) throw recipientsRes.error;
    if (senderRes.error) throw senderRes.error;
    if (!senderRes.data) throw new Error(`No existe un profile para ${ORDER_NOTIFICATION_SENDER_EMAIL}`);
    if (String(senderRes.data.status || "").toLowerCase() !== "active") {
      throw new Error(`La cuenta emisora ${ORDER_NOTIFICATION_SENDER_EMAIL} no está activa`);
    }

    const recipientEmails = Array.from(new Set((recipientsRes.data || [])
      .map((row) => normalizeEmail(row.email))
      .filter(Boolean)));

    toRecipients = recipientEmails;
    if (toRecipients.length === 0) {
      throw new Error("No hay usuarios facturadores activos configurados");
    }

    const sellerEmail = normalizeEmail(sellerRes.data.email);
    ccRecipients = sellerEmail ? [sellerEmail] : [];
    senderEmail = ORDER_NOTIFICATION_SENDER_EMAIL;

    const client = clientRes.data;
    const seller = sellerRes.data;
    const orderFolio = order.folio || order.id.slice(0, 8);
    const quotationFolio = quotationRes.data?.folio || null;
    const creditDays = Number(client.credit_days || 0);
    const paymentTerms = creditDays > 0 ? `${creditDays} días` : "Contado";

    subject = `Pedido #${orderFolio} - ${client.name}`;
    const message = [
      "Equipo,",
      "",
      `Se generó el pedido #${orderFolio}${quotationFolio ? ` desde la cotización #${quotationFolio}` : ""}.`,
      `Cliente: ${client.name}`,
      `Condición de pago: ${paymentTerms}`,
      `Total: ${formatMoney(Number(order.total_amount || 0))}`,
      `Vendedor: ${seller.full_name || seller.email || "Vendedor"}`,
      "",
      order.payment_proof_path
        ? "Adjuntos: PDF del pedido y comprobante de pago."
        : "Adjunto: PDF del pedido.",
    ].join("\n");
    bodyPreview = message.slice(0, 500);

    const attachments = [
      {
        name: orderPdfAttachment.name,
        mimeType: orderPdfAttachment.mimeType,
        contentBase64: orderPdfAttachment.contentBase64,
      },
    ];
    attachmentsMeta = [
      { name: orderPdfAttachment.name, mime_type: orderPdfAttachment.mimeType, kind: "order_pdf" },
    ];

    if (order.payment_proof_path) {
      const { data: proofBlob, error: proofError } = await serviceClient.storage
        .from(PAYMENT_PROOFS_BUCKET)
        .download(order.payment_proof_path);
      if (proofError) throw proofError;

      const proofBytes = new Uint8Array(await proofBlob.arrayBuffer());
      attachments.push({
        name: order.payment_proof_name || "comprobante_pago",
        mimeType: order.payment_proof_mime_type || proofBlob.type || "application/octet-stream",
        contentBase64: bytesToBase64(proofBytes),
      });
      attachmentsMeta.push({
        name: order.payment_proof_name || "comprobante_pago",
        mime_type: order.payment_proof_mime_type || proofBlob.type || "application/octet-stream",
        kind: "payment_proof",
      });
    }

    const { accessToken } = await refreshGoogleAccessTokenForUser(serviceClient, senderRes.data.id);
    const rawMimeMessage = buildMimeMessage({
      senderEmail,
      toRecipients,
      ccRecipients,
      subject,
      message,
      attachments,
    });
    const gmailResult = await sendRawGmailMessage(accessToken, rawMimeMessage);

    await serviceClient.from("order_notification_logs").insert({
      order_id: orderId,
      triggered_by: actorId,
      sender_profile_id: senderRes.data.id,
      sender_email: senderEmail,
      to_recipients: toRecipients,
      cc_recipients: ccRecipients,
      subject,
      body_preview: bodyPreview,
      status: "sent",
      gmail_message_id: gmailResult.messageId,
      gmail_thread_id: gmailResult.threadId,
      error_message: null,
      request_source: requestSource,
      attachments: attachmentsMeta,
      sent_at: new Date().toISOString(),
    });

    await serviceClient
      .from("orders")
      .update({
        payment_email_status: "sent",
        payment_email_error: null,
        payment_email_sent_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    const { error: emailLogError } = await serviceClient.from("email_logs").insert({
      client_id: client.id,
      user_id: seller.id,
      subject,
      snippet: `${message.substring(0, 100)}...`,
    });
    if (emailLogError) {
      console.warn("send-order-notification: email_logs insert failed", emailLogError.message);
    }

    return jsonResponse({
      status: "sent",
      senderEmail,
      toRecipients,
      ccRecipients,
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
      ccRecipients,
    }, 400);
  }
});
