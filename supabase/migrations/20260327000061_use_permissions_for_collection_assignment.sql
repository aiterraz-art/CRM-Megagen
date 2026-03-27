CREATE OR REPLACE FUNCTION public.assign_collection_seller(
  p_collection_id uuid,
  p_seller_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role text;
  v_actor_can_manage_collections boolean := false;
  v_actor_can_manage_clients boolean := false;
  v_collection public.collections_pending%ROWTYPE;
  v_seller public.profiles%ROWTYPE;
  v_normalized_rut text;
  v_updated_documents integer := 0;
  v_updated_clients integer := 0;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT lower(coalesce(p.role, '')) INTO v_actor_role
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE lower(coalesce(rp.role, '')) = lower(coalesce(v_actor_role, ''))
      AND rp.permission = 'MANAGE_COLLECTIONS'
  ) INTO v_actor_can_manage_collections;

  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE lower(coalesce(rp.role, '')) = lower(coalesce(v_actor_role, ''))
      AND rp.permission = 'MANAGE_CLIENTS'
  ) INTO v_actor_can_manage_clients;

  IF NOT (
    coalesce(v_actor_role, '') = 'jefe'
    OR (v_actor_can_manage_collections AND v_actor_can_manage_clients)
  ) THEN
    RAISE EXCEPTION 'Sin permisos para asignar vendedor en cobranzas';
  END IF;

  SELECT * INTO v_collection
  FROM public.collections_pending
  WHERE id = p_collection_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento de cobranza no encontrado';
  END IF;

  SELECT * INTO v_seller
  FROM public.profiles
  WHERE id = p_seller_id
    AND lower(COALESCE(role, '')) IN ('seller', 'jefe', 'manager', 'admin')
    AND COALESCE(status, 'active') = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendedor inválido o inactivo';
  END IF;

  v_normalized_rut := regexp_replace(lower(COALESCE(v_collection.client_rut, '')), '[^0-9k]', '', 'g');

  IF v_normalized_rut <> '' THEN
    UPDATE public.collections_pending cp
    SET seller_id = v_seller.id,
        seller_email = lower(v_seller.email),
        seller_name = COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1))
    WHERE regexp_replace(lower(COALESCE(cp.client_rut, '')), '[^0-9k]', '', 'g') = v_normalized_rut;

    GET DIAGNOSTICS v_updated_documents = ROW_COUNT;

    UPDATE public.clients c
    SET created_by = v_seller.id,
        pending_seller_email = NULL,
        updated_at = now()
    WHERE regexp_replace(lower(COALESCE(c.rut, '')), '[^0-9k]', '', 'g') = v_normalized_rut;

    GET DIAGNOSTICS v_updated_clients = ROW_COUNT;
  ELSE
    UPDATE public.collections_pending cp
    SET seller_id = v_seller.id,
        seller_email = lower(v_seller.email),
        seller_name = COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1))
    WHERE cp.id = p_collection_id;

    GET DIAGNOSTICS v_updated_documents = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'seller_id', v_seller.id,
    'seller_email', lower(v_seller.email),
    'seller_name', COALESCE(NULLIF(trim(v_seller.full_name), ''), split_part(v_seller.email, '@', 1)),
    'updated_documents', v_updated_documents,
    'updated_clients', v_updated_clients
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assign_collection_seller(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
