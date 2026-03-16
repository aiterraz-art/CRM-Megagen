CREATE TABLE IF NOT EXISTS public.google_oauth_credentials (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    google_email TEXT,
    encrypted_refresh_token TEXT NOT NULL,
    encryption_iv TEXT NOT NULL,
    token_hint_last4 TEXT,
    scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    last_refresh_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.google_oauth_credentials ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_google_oauth_status()
RETURNS TABLE (
    google_email TEXT,
    has_refresh_token BOOLEAN,
    last_refresh_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        c.google_email,
        true AS has_refresh_token,
        c.last_refresh_at,
        c.last_error,
        c.updated_at
    FROM public.google_oauth_credentials c
    WHERE c.user_id = auth.uid()
$$;

REVOKE ALL ON public.google_oauth_credentials FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_oauth_status() TO authenticated;

INSERT INTO public.role_permissions (role, permission)
SELECT roles.role, 'VIEW_TEAM_CALENDARS'
FROM (VALUES ('admin'), ('jefe')) AS roles(role)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = roles.role
      AND rp.permission = 'VIEW_TEAM_CALENDARS'
);
