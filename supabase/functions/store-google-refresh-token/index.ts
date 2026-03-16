import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_TOKEN_ENCRYPTION_KEY = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();

const toBase64 = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value));

const normalizeScopes = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(" ").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const getEncryptionKey = async () => {
  if (!GOOGLE_TOKEN_ENCRYPTION_KEY) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is missing");
  }

  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(GOOGLE_TOKEN_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const encryptValue = async (plainText: string) => {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plainText),
  );

  return {
    encrypted: toBase64(new Uint8Array(cipherBuffer)),
    iv: toBase64(iv),
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials are missing");
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

    const { provider_refresh_token, google_email, scopes } = await req.json();
    if (!provider_refresh_token || typeof provider_refresh_token !== "string") {
      throw new Error("Missing provider_refresh_token");
    }

    const normalizedEmail = String(google_email || authData.user.email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      throw new Error("Missing google_email");
    }

    const encrypted = await encryptValue(provider_refresh_token);
    const tokenHint = provider_refresh_token.slice(-4);

    const { error: upsertError } = await serviceClient
      .from("google_oauth_credentials")
      .upsert({
        user_id: authData.user.id,
        google_email: normalizedEmail,
        encrypted_refresh_token: encrypted.encrypted,
        encryption_iv: encrypted.iv,
        token_hint_last4: tokenHint,
        scopes: normalizeScopes(scopes),
        last_error: null,
        updated_at: new Date().toISOString(),
      });

    if (upsertError) {
      throw upsertError;
    }

    return new Response(JSON.stringify({ stored: true, google_email: normalizedEmail }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
