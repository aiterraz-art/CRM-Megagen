-- ============================================================================
-- FOLIOS AUTOMATICOS PARA COTIZACIONES Y PEDIDOS
-- Fecha: 2026-02-28
-- Objetivo:
-- 1) Asegurar folio autoincremental en quotations y orders (si existe columna).
-- 2) Completar folios faltantes en registros existentes.
-- 3) Mantener script idempotente para ejecutarlo en distintas instancias.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- QUOTATIONS: secuencia + trigger + backfill
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quotations'
      AND column_name = 'folio'
  ) THEN
    EXECUTE 'CREATE SEQUENCE IF NOT EXISTS public.quotations_folio_seq';

    EXECUTE '
      SELECT setval(
        ''public.quotations_folio_seq'',
        GREATEST(
          COALESCE((SELECT MAX(folio) FROM public.quotations), 0) + 1,
          1
        ),
        false
      )
    ';

    EXECUTE '
      ALTER TABLE public.quotations
      ALTER COLUMN folio SET DEFAULT nextval(''public.quotations_folio_seq'')
    ';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assign_quotation_folio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.folio IS NULL OR NEW.folio <= 0 THEN
    NEW.folio := nextval('public.quotations_folio_seq');
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
      AND table_name = 'quotations'
      AND column_name = 'folio'
  ) THEN
    DROP TRIGGER IF EXISTS trg_assign_quotation_folio ON public.quotations;
    CREATE TRIGGER trg_assign_quotation_folio
    BEFORE INSERT ON public.quotations
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_quotation_folio();

    -- Backfill de cotizaciones antiguas sin folio
    WITH missing AS (
      SELECT id
      FROM public.quotations
      WHERE folio IS NULL OR folio <= 0
      ORDER BY created_at NULLS LAST, id
    )
    UPDATE public.quotations q
    SET folio = nextval('public.quotations_folio_seq')
    FROM missing m
    WHERE q.id = m.id;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- ORDERS: secuencia + trigger + backfill (solo si existe columna folio)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'folio'
  ) THEN
    EXECUTE 'CREATE SEQUENCE IF NOT EXISTS public.orders_folio_seq';

    EXECUTE '
      SELECT setval(
        ''public.orders_folio_seq'',
        GREATEST(
          COALESCE((SELECT MAX(folio) FROM public.orders), 0) + 1,
          1
        ),
        false
      )
    ';

    EXECUTE '
      ALTER TABLE public.orders
      ALTER COLUMN folio SET DEFAULT nextval(''public.orders_folio_seq'')
    ';
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
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'folio'
  ) THEN
    DROP TRIGGER IF EXISTS trg_assign_order_folio ON public.orders;
    CREATE TRIGGER trg_assign_order_folio
    BEFORE INSERT ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.assign_order_folio();

    -- Backfill de pedidos antiguos sin folio
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
  END IF;
END $$;

