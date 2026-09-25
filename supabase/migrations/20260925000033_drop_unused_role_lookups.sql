-- Limpieza tras la Fase 3: assign_collection_seller y enforce_client_reassignment_permissions
-- seguian calculando el rol y consultando role_permissions en variables que ya no se usaban,
-- porque la decision la toma auth_user_has_permission('ASSIGN_CLIENTS'). Mismo comportamiento.

CREATE OR REPLACE FUNCTION public.assign_collection_seller(p_collection_id uuid, p_seller_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
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

  IF NOT public.auth_user_has_permission('ASSIGN_CLIENTS') THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_client_reassignment_permissions()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
BEGIN
  -- Service role / backend jobs can bypass this trigger.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    IF NOT public.auth_user_has_permission('ASSIGN_CLIENTS') THEN
      RAISE EXCEPTION 'No tienes permiso para reasignar clientes.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

NOTIFY pgrst, 'reload schema';
