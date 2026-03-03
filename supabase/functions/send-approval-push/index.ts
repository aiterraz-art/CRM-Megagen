import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:soporte@crm.local";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase service credentials are missing");
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("VAPID keys are missing");
    }

    const { approval_id, icon } = await req.json();
    if (!approval_id) {
      throw new Error("Missing approval_id");
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: approval, error: approvalError } = await supabase
      .from("approval_requests")
      .select("id, requester_id, entity_id, status, approval_type")
      .eq("id", approval_id)
      .maybeSingle();

    if (approvalError || !approval) {
      throw new Error("Approval request not found");
    }
    if (approval.status !== "pending") {
      return new Response(JSON.stringify({ sent: 0, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: requester }, { data: quotation }, { data: recipients, error: recipientsError }] = await Promise.all([
      supabase.from("profiles").select("full_name, email").eq("id", approval.requester_id).maybeSingle(),
      supabase.from("quotations").select("clients(name)").eq("id", approval.entity_id).maybeSingle(),
      supabase
        .from("profiles")
        .select("id")
        .in("role", ["admin", "jefe"])
        .eq("status", "active"),
    ]);

    if (recipientsError) throw recipientsError;
    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no_recipients" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientIds = recipients.map((r) => r.id);
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id")
      .in("user_id", recipientIds);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientJoined = Array.isArray((quotation as any)?.clients)
      ? (quotation as any)?.clients?.[0]
      : (quotation as any)?.clients;
    const clientName = clientJoined?.name || "cliente";
    const sellerName = requester?.full_name || requester?.email?.split("@")[0] || "vendedor";

    const payload = JSON.stringify({
      title: "Nueva aprobación pendiente",
      body: `${sellerName} solicita aprobación para ${clientName}.`,
      url: "/operations",
      tag: `approval-${approval.id}`,
      icon: icon || "/logo_megagen.png",
      badge: icon || "/logo_megagen.png",
    });

    let sent = 0;
    const staleIds: string[] = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payload
        );
        sent += 1;
      } catch (err: any) {
        const statusCode = Number(err?.statusCode || err?.status || 0);
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(sub.id);
        }
      }
    }

    if (staleIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", staleIds);
    }

    return new Response(
      JSON.stringify({
        sent,
        totalSubscriptions: subscriptions.length,
        staleRemoved: staleIds.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
