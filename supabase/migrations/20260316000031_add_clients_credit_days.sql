ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS credit_days INTEGER;

UPDATE public.clients
SET credit_days = 0
WHERE credit_days IS NULL;

ALTER TABLE public.clients
ALTER COLUMN credit_days SET DEFAULT 0;

ALTER TABLE public.clients
ALTER COLUMN credit_days SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'clients_credit_days_nonnegative'
          AND conrelid = 'public.clients'::regclass
    ) THEN
        ALTER TABLE public.clients
        ADD CONSTRAINT clients_credit_days_nonnegative
        CHECK (credit_days >= 0);
    END IF;
END $$;

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
       AND COALESCE(actor_role, '') NOT IN ('admin', 'jefe') THEN
        RAISE EXCEPTION 'Solo admin o jefe pueden modificar los dias de credito.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_client_credit_permissions ON public.clients;
CREATE TRIGGER trg_enforce_client_credit_permissions
BEFORE INSERT OR UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.enforce_client_credit_permissions();
