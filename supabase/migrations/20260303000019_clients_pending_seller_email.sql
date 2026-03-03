-- Allow importing clients assigned to seller emails that do not exist yet.
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS pending_seller_email text;

CREATE INDEX IF NOT EXISTS idx_clients_pending_seller_email
ON public.clients (lower(pending_seller_email))
WHERE pending_seller_email IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_clients_owner_from_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.clients c
  SET
    created_by = NEW.id,
    pending_seller_email = NULL,
    updated_at = now()
  WHERE c.created_by IS NULL
    AND c.pending_seller_email IS NOT NULL
    AND lower(c.pending_seller_email) = lower(NEW.email);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clients_owner_on_profile_upsert ON public.profiles;
CREATE TRIGGER trg_sync_clients_owner_on_profile_upsert
AFTER INSERT OR UPDATE OF email ON public.profiles
FOR EACH ROW
WHEN (NEW.email IS NOT NULL)
EXECUTE FUNCTION public.sync_clients_owner_from_profile_email();
