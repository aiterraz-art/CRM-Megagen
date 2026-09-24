-- Credenciales de la integración con Meta.
--
-- Viven en la base y no en las variables de entorno del contenedor por dos
-- razones: cambiar una variable en Coolify obliga a reiniciar el servicio, y
-- el token de página de Meta caduca cada 60 días salvo que sea de usuario de
-- sistema. Guardarlas aquí permite rotarlas desde el CRM sin tocar el servidor.
--
-- Solo el service_role las lee. Un administrador puede escribirlas y consultar
-- si están puestas, pero nunca recuperar su valor.

CREATE TABLE IF NOT EXISTS public.meta_lead_credentials (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT meta_lead_credentials_key_check
        CHECK (key IN ('app_secret', 'verify_token', 'page_access_token', 'graph_version', 'retry_secret'))
);

ALTER TABLE public.meta_lead_credentials ENABLE ROW LEVEL SECURITY;

-- Sin políticas: ni anon ni authenticated llegan nunca a las filas.
REVOKE ALL ON public.meta_lead_credentials FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_meta_lead_credentials()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM public.meta_lead_credentials
$$;

CREATE OR REPLACE FUNCTION public.set_meta_lead_credential(p_key TEXT, p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT lower(coalesce(role, '')) INTO v_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF coalesce(v_role, '') <> 'admin' THEN
        RAISE EXCEPTION 'Solo un administrador puede configurar la integración con Meta.'
            USING ERRCODE = '42501';
    END IF;

    IF nullif(btrim(coalesce(p_value, '')), '') IS NULL THEN
        DELETE FROM public.meta_lead_credentials WHERE key = p_key;
        RETURN jsonb_build_object('key', p_key, 'configurado', false);
    END IF;

    INSERT INTO public.meta_lead_credentials (key, value, updated_by)
    VALUES (p_key, btrim(p_value), auth.uid())
    ON CONFLICT (key) DO UPDATE
    SET value = excluded.value,
        updated_at = timezone('utc', now()),
        updated_by = excluded.updated_by;

    RETURN jsonb_build_object('key', p_key, 'configurado', true);
END;
$$;

-- Para la pantalla: qué falta por configurar, sin exponer ningún valor.
CREATE OR REPLACE FUNCTION public.meta_lead_credentials_status()
RETURNS TABLE (key TEXT, configurado BOOLEAN, updated_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT esperado.key,
           c.key IS NOT NULL AS configurado,
           c.updated_at
    FROM (VALUES ('app_secret'), ('verify_token'), ('page_access_token'), ('retry_secret')) AS esperado(key)
    LEFT JOIN public.meta_lead_credentials c ON c.key = esperado.key
    WHERE public.auth_user_has_permission('IMPORT_CLIENTS')
$$;

REVOKE ALL ON FUNCTION public.get_meta_lead_credentials() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_lead_credentials() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_meta_lead_credential(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_lead_credentials_status() TO authenticated;
