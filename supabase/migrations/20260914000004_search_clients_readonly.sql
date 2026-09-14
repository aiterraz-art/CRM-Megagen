-- Sellers can look up a specific client assigned to someone else without gaining
-- general SELECT access or any update permission over other portfolios.
CREATE OR REPLACE FUNCTION public.search_clients_readonly(p_search text)
RETURNS TABLE (
  id uuid,
  name text,
  rut text,
  phone text,
  email text,
  address text,
  comuna text,
  office text,
  seller_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw_search text := trim(coalesce(p_search, ''));
  v_rut_search text;
BEGIN
  -- A short minimum avoids using this endpoint as a portfolio browser.
  IF auth.uid() IS NULL OR char_length(v_raw_search) < 2 THEN
    RETURN;
  END IF;

  -- This exception is intended only for the seller workflow. Other roles retain
  -- their existing client access rules and do not need this security-definer lookup.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) = 'seller'
  ) THEN
    RETURN;
  END IF;

  v_rut_search := regexp_replace(lower(v_raw_search), '[^0-9k]', '', 'g');

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.rut,
    c.phone,
    c.email,
    c.address,
    c.comuna,
    c.office,
    coalesce(p.full_name, p.email, c.pending_seller_email, 'Sin vendedor asignado') AS seller_name
  FROM public.clients c
  LEFT JOIN public.profiles p ON p.id = c.created_by
  WHERE c.created_by IS DISTINCT FROM auth.uid()
    AND (
      strpos(lower(c.name), lower(v_raw_search)) > 0
      OR (
        v_rut_search <> ''
        AND strpos(regexp_replace(lower(coalesce(c.rut, '')), '[^0-9k]', '', 'g'), v_rut_search) > 0
      )
    )
  ORDER BY
    CASE
      WHEN regexp_replace(lower(coalesce(c.rut, '')), '[^0-9k]', '', 'g') = v_rut_search THEN 0
      ELSE 1
    END,
    c.name
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.search_clients_readonly(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_clients_readonly(text) TO authenticated;
