CREATE OR REPLACE FUNCTION public.enforce_client_reassignment_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_role text;
  can_manage_clients boolean := false;
BEGIN
  -- Service role / backend jobs can bypass this trigger.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    SELECT lower(COALESCE(p.role, '')) INTO actor_role
    FROM public.profiles p
    WHERE p.id = auth.uid();

    SELECT EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      JOIN public.profiles p
        ON p.role = rp.role
      WHERE p.id = auth.uid()
        AND rp.permission = 'MANAGE_CLIENTS'
    )
    INTO can_manage_clients;

    IF (
      COALESCE(actor_role, '') NOT IN ('admin', 'jefe', 'tesorero')
      AND NOT can_manage_clients
    ) THEN
      RAISE EXCEPTION 'Solo admin, jefe o tesorero pueden reasignar leads.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
