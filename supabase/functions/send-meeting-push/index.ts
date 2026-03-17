import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "https://crm.local";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials are missing");
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("VAPID keys are missing");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: authHeader },
      },
    });
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      throw new Error("Unauthorized user");
    }

    const { data: callerProfile, error: callerError } = await serviceClient
      .from("profiles")
      .select("id, role, full_name, email, status")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (callerError || !callerProfile) {
      throw new Error("Caller profile not found");
    }

    const callerRole = String(callerProfile.role || "").trim().toLowerCase();
    if (!["admin", "manager", "jefe"].includes(callerRole)) {
      return new Response(JSON.stringify({ error: "Only admin or jefe can send meeting push" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { title, body, url, icon, recipient_ids } = await req.json();
    if (!title || !body) {
      throw new Error("Missing title or body");
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    let recipientQuery = serviceClient
      .from("profiles")
      .select("id")
      .eq("status", "active");

    if (Array.isArray(recipient_ids) && recipient_ids.length > 0) {
      recipientQuery = recipientQuery.in("id", recipient_ids);
    }

    const { data: recipients, error: recipientsError } = await recipientQuery;
    if (recipientsError) throw recipientsError;
    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no_recipients" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipientIds = recipients.map((r) => r.id);
    const { data: subscriptions } = await serviceClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, user_id")
      .in("user_id", recipientIds);

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title,
      body,
      url: url || "/schedule",
      tag: `meeting-${Date.now()}`,
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
        } else {
          console.warn("send-meeting-push failed for subscription", sub.id, err?.message || err);
        }
      }
    }

    if (staleIds.length > 0) {
      await serviceClient.from("push_subscriptions").delete().in("id", staleIds);
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
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
