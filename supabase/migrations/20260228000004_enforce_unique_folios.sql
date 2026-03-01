-- ============================================================================
-- ENFORCE: FOLIOS UNICOS Y OBLIGATORIOS
-- Fecha: 2026-02-28
-- Requiere: 20260228000003_folio_autonumbering.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- QUOTATIONS
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

    -- Completa nulos o invalidos
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

    -- Resuelve duplicados reasignando folio a repeticiones (dejando una)
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY folio ORDER BY created_at NULLS LAST, id) AS rn
      FROM public.quotations
      WHERE folio IS NOT NULL
    )
    UPDATE public.quotations q
    SET folio = nextval('public.quotations_folio_seq')
    FROM ranked r
    WHERE q.id = r.id
      AND r.rn > 1;

    -- Reajusta secuencia al maximo actual
    PERFORM setval(
      'public.quotations_folio_seq',
      GREATEST(COALESCE((SELECT MAX(folio) FROM public.quotations), 0) + 1, 1),
      false
    );

    EXECUTE 'ALTER TABLE public.quotations ALTER COLUMN folio SET NOT NULL';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'quotations_folio_unique'
        AND conrelid = 'public.quotations'::regclass
    ) THEN
      EXECUTE 'ALTER TABLE public.quotations ADD CONSTRAINT quotations_folio_unique UNIQUE (folio)';
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- ORDERS
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

    -- Completa nulos o invalidos
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

    -- Resuelve duplicados reasignando folio a repeticiones (dejando una)
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

    -- Reajusta secuencia al maximo actual
    PERFORM setval(
      'public.orders_folio_seq',
      GREATEST(COALESCE((SELECT MAX(folio) FROM public.orders), 0) + 1, 1),
      false
    );

    EXECUTE 'ALTER TABLE public.orders ALTER COLUMN folio SET NOT NULL';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'orders_folio_unique'
        AND conrelid = 'public.orders'::regclass
    ) THEN
      EXECUTE 'ALTER TABLE public.orders ADD CONSTRAINT orders_folio_unique UNIQUE (folio)';
    END IF;
  END IF;
END $$;

