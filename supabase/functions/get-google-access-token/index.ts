import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GOOGLE_TOKEN_ENCRYPTION_KEY = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const getEncryptionKey = async () => {
  if (!GOOGLE_TOKEN_ENCRYPTION_KEY) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is missing");
  }

  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(GOOGLE_TOKEN_ENCRYPTION_KEY));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const decryptValue = async (encryptedValue: string, ivValue: string) => {
  const key = await getEncryptionKey();
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    key,
    fromBase64(encryptedValue),
  );
  return decoder.decode(plainBuffer);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase credentials are missing");
    }
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error("Google OAuth credentials are missing");
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

    const { data: credentials, error: credentialsError } = await serviceClient
      .from("google_oauth_credentials")
      .select("encrypted_refresh_token, encryption_iv, google_email")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (credentialsError) {
      throw credentialsError;
    }
    if (!credentials?.encrypted_refresh_token || !credentials.encryption_iv) {
      throw new Error("Google reconnect required");
    }

    const refreshToken = await decryptValue(credentials.encrypted_refresh_token, credentials.encryption_iv);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      const errorMessage = tokenPayload?.error_description || tokenPayload?.error || "Google token refresh failed";
      await serviceClient
        .from("google_oauth_credentials")
        .update({
          last_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", authData.user.id);
      throw new Error(errorMessage);
    }

    await serviceClient
      .from("google_oauth_credentials")
      .update({
        last_refresh_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", authData.user.id);

    return new Response(JSON.stringify({
      access_token: tokenPayload.access_token,
      expires_in: tokenPayload.expires_in ?? 3600,
      google_email: credentials.google_email,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
