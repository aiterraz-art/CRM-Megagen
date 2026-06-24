CREATE OR REPLACE FUNCTION public.enforce_client_credit_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    actor_role text;
BEGIN
    IF auth.uid() IS NULL THEN
        NEW.credit_days := COALESCE(NEW.credit_days, 0);
        IF TG_OP = 'INSERT' THEN
            NEW.credit_days := 0;
        END IF;
        RETURN NEW;
    END IF;

    SELECT lower(coalesce(p.role, ''))
    INTO actor_role
    FROM public.profiles p
    WHERE p.id = auth.uid();

    NEW.credit_days := COALESCE(NEW.credit_days, 0);

    IF TG_OP = 'INSERT' THEN
        NEW.credit_days := 0;
        RETURN NEW;
    END IF;

    IF NEW.credit_days IS DISTINCT FROM OLD.credit_days
       AND COALESCE(actor_role, '') NOT IN ('admin', 'jefe', 'facturador') THEN
        RAISE EXCEPTION 'Solo admin, jefe o facturador pueden modificar los dias de credito.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;
