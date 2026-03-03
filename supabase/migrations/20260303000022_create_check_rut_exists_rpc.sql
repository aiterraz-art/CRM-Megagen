-- Ensure check_rut_exists RPC exists in every instance (Megagen + 3Dental)

CREATE OR REPLACE FUNCTION public.check_rut_exists(queried_rut text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text;
  existing_row record;
  owner_name text;
BEGIN
  normalized := nullif(trim(coalesce(queried_rut, '')), '');

  IF normalized IS NULL THEN
    RETURN jsonb_build_object(
      'exists', false,
      'owner_name', NULL,
      'owner_id', NULL
    );
  END IF;

  SELECT c.id, c.created_by
  INTO existing_row
  FROM public.clients c
  WHERE lower(coalesce(c.rut, '')) = lower(normalized)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'exists', false,
      'owner_name', NULL,
      'owner_id', NULL
    );
  END IF;

  IF existing_row.created_by IS NOT NULL THEN
    SELECT coalesce(p.full_name, split_part(coalesce(p.email, ''), '@', 1), 'Desconocido')
    INTO owner_name
    FROM public.profiles p
    WHERE p.id = existing_row.created_by;
  END IF;

  RETURN jsonb_build_object(
    'exists', true,
    'owner_name', coalesce(owner_name, 'Desconocido'),
    'owner_id', existing_row.created_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_rut_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rut_exists(text) TO authenticated;
