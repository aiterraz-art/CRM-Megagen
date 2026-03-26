CREATE TABLE IF NOT EXISTS public.collections_import_staging_rows (
  session_id uuid NOT NULL,
  row_order integer NOT NULL,
  row_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (session_id, row_order)
);

ALTER TABLE public.collections_import_staging_rows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.collections_import_staging_rows FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.stage_collections_pending_rows(
  p_session_id uuid,
  p_rows jsonb
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
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows debe ser un arreglo JSON';
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
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS element(value, ordinality);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_collections_pending_upload(
  p_session_id uuid,
  p_file_name text,
  p_uploaded_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid;
  v_rows jsonb;
  v_batch_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
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

  SELECT jsonb_agg(row_payload ORDER BY row_order) INTO v_rows
  FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  IF v_rows IS NULL OR jsonb_array_length(v_rows) = 0 THEN
    RAISE EXCEPTION 'No hay filas staged para esta carga';
  END IF;

  v_batch_id := public.replace_collections_pending(p_file_name, p_uploaded_by, v_rows);

  DELETE FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  RETURN v_batch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.discard_collections_pending_upload(
  p_session_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid;
  v_deleted integer;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id requerido';
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

  DELETE FROM public.collections_import_staging_rows
  WHERE session_id = p_session_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.stage_collections_pending_rows(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_collections_pending_upload(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_collections_pending_upload(uuid) TO authenticated;
