CREATE OR REPLACE FUNCTION public.stage_collections_pending_rows_text(
  p_session_id uuid,
  p_rows_text text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid;
  v_base_order integer;
  v_inserted integer;
  v_rows jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
  END IF;

  IF p_rows_text IS NULL OR btrim(p_rows_text) = '' THEN
    RAISE EXCEPTION 'p_rows_text requerido';
  END IF;

  BEGIN
    v_rows := p_rows_text::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'p_rows_text inválido';
  END;

  IF jsonb_typeof(v_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows_text debe serializar un arreglo JSON';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.role_permissions rp
      ON rp.role = p.role
     AND rp.permission = 'MANAGE_COLLECTIONS'
    WHERE p.id = v_actor_id
      AND (p.role = 'admin' OR rp.permission = 'MANAGE_COLLECTIONS')
  ) THEN
    RAISE EXCEPTION 'Sin permisos para cargar cobranzas';
  END IF;

  SELECT COALESCE(MAX(row_order), 0) INTO v_base_order
  FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  INSERT INTO public.collections_import_staging_rows (session_id, row_order, row_payload)
  SELECT
    p_session_id,
    v_base_order + element.ordinality::integer,
    element.value
  FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS element(value, ordinality);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.stage_collections_pending_rows_text(uuid, text) TO authenticated;
