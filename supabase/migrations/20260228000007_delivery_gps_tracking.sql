-- ============================================================================
-- DELIVERY GPS TRACKING
-- Fecha: 2026-02-28
-- Objetivo: registrar coordenadas de entrega al marcar pedido entregado.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.route_items') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'route_items'
        AND column_name = 'delivered_lat'
    ) THEN
      ALTER TABLE public.route_items ADD COLUMN delivered_lat NUMERIC;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'route_items'
        AND column_name = 'delivered_lng'
    ) THEN
      ALTER TABLE public.route_items ADD COLUMN delivered_lng NUMERIC;
    END IF;
  END IF;

  IF to_regclass('public.orders') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'delivered_lat'
    ) THEN
      ALTER TABLE public.orders ADD COLUMN delivered_lat NUMERIC;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'delivered_lng'
    ) THEN
      ALTER TABLE public.orders ADD COLUMN delivered_lng NUMERIC;
    END IF;
  END IF;
END $$;

