-- ============================================================================
-- ADD orders.folio + AUTONUMERACION + CONSTRAINTS
-- Fecha: 2026-02-28
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'folio'
  ) THEN
    ALTER TABLE public.orders ADD COLUMN folio INTEGER;
  END IF;

  CREATE SEQUENCE IF NOT EXISTS public.orders_folio_seq;

  PERFORM setval(
    'public.orders_folio_seq',
    GREATEST(COALESCE((SELECT MAX(folio) FROM public.orders), 0) + 1, 1),
    false
  );

  ALTER TABLE public.orders
    ALTER COLUMN folio SET DEFAULT nextval('public.orders_folio_seq');

  -- Completa faltantes
  WITH missing AS (
    SELECT id
    FROM public.orders
    WHERE folio IS NULL OR folio <= 0
    ORDER BY created_at NULLS LAST, id
  )
  UPDATE public.orders o
  SET folio = nextval('public.orders_folio_seq')
  FROM missing m
  WHERE o.id = m.id;

  -- Resuelve duplicados
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (PARTITION BY folio ORDER BY created_at NULLS LAST, id) AS rn
    FROM public.orders
    WHERE folio IS NOT NULL
  )
  UPDATE public.orders o
  SET folio = nextval('public.orders_folio_seq')
  FROM ranked r
  WHERE o.id = r.id
    AND r.rn > 1;

  PERFORM setval(
    'public.orders_folio_seq',
    GREATEST(COALESCE((SELECT MAX(folio) FROM public.orders), 0) + 1, 1),
    false
  );

  ALTER TABLE public.orders ALTER COLUMN folio SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_folio_unique'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_folio_unique UNIQUE (folio);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assign_order_folio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.folio IS NULL OR NEW.folio <= 0 THEN
    NEW.folio := nextval('public.orders_folio_seq');
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_assign_order_folio ON public.orders;
  CREATE TRIGGER trg_assign_order_folio
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_order_folio();
END $$;

