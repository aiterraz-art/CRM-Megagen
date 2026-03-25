import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GOOGLE_TOKEN_ENCRYPTION_KEY = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY") ?? "";

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

export const createSupabaseClients = (authHeader: string) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase credentials are missing");
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  return { userClient, serviceClient };
};

export const getAuthenticatedUser = async (userClient: SupabaseClient) => {
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    throw new Error("Unauthorized user");
  }
  return authData.user;
};

export const refreshGoogleAccessTokenForUser = async (serviceClient: SupabaseClient, userId: string) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials are missing");
  }

  const { data: credentials, error: credentialsError } = await serviceClient
    .from("google_oauth_credentials")
    .select("encrypted_refresh_token, encryption_iv, google_email")
    .eq("user_id", userId)
    .maybeSingle();

  if (credentialsError) {
    throw credentialsError;
  }
  if (!credentials?.encrypted_refresh_token || !credentials?.encryption_iv) {
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
      .eq("user_id", userId);
    throw new Error(errorMessage);
  }

  await serviceClient
    .from("google_oauth_credentials")
    .update({
      last_refresh_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return {
    accessToken: tokenPayload.access_token as string,
    googleEmail: credentials.google_email || null,
  };
};

export const toWebSafeBase64 = (value: string) =>
  btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const encodeUtf8Base64 = (value: string) => {
  const bytes = encoder.encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const sendRawGmailMessage = async (accessToken: string, rawMimeMessage: string) => {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: toWebSafeBase64(rawMimeMessage) }),
  });

  const payload = await response.json();
  if (!response.ok || !payload?.id) {
    const errorMessage = payload?.error?.message || payload?.error_description || `Gmail API ${response.status}`;
    throw new Error(errorMessage);
  }

  return {
    messageId: payload.id as string,
    threadId: (payload.threadId as string | undefined) ?? null,
  };
};
