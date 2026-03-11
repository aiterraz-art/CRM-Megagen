-- Enforce business rule: every order must come from a quotation conversion.
-- This prevents manual/direct order creation from arbitrary clients or visits.

CREATE OR REPLACE FUNCTION public.enforce_orders_from_quotation_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_quotation_id uuid;
BEGIN
  v_quotation_id := NULLIF((to_jsonb(NEW)->>'quotation_id'), '')::uuid;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'Los pedidos deben originarse desde una cotización (quotation_id requerido).';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.quotations q
    WHERE q.id = v_quotation_id
  ) THEN
    RAISE EXCEPTION 'La cotización asociada al pedido no existe (%).', v_quotation_id;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'quotation_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_enforce_orders_from_quotation_only ON public.orders;

    CREATE TRIGGER trg_enforce_orders_from_quotation_only
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_orders_from_quotation_only();
  ELSE
    RAISE NOTICE 'No se creó trigger orders-from-quotation: columna public.orders.quotation_id no existe.';
  END IF;
END;
$$;
