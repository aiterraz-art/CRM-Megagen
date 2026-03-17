-- ============================================================================
-- CRM Health Check (read-only diagnostics)
-- Fecha: 2026-02-28
-- Uso: ejecutar completo en SQL Editor de cada instancia (megagen / 3dental)
-- Salida: check_name | severity | affected_rows | details | sample_ids
-- ============================================================================

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS tmp_health_checks (
  check_name TEXT NOT NULL,
  severity TEXT NOT NULL, -- critical | warning | info
  affected_rows BIGINT NOT NULL DEFAULT 0,
  details TEXT,
  sample_ids TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.add_check(
  p_check_name TEXT,
  p_severity TEXT,
  p_affected_rows BIGINT,
  p_details TEXT,
  p_sample_ids TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tmp_health_checks (check_name, severity, affected_rows, details, sample_ids)
  VALUES (p_check_name, p_severity, COALESCE(p_affected_rows, 0), p_details, p_sample_ids);
END;
$$;

-- ----------------------------------------------------------------------------
-- 1) Folios: quotations / orders
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_sample TEXT;
  v_max BIGINT;
  v_seq_last BIGINT;
BEGIN
  -- quotations without folio
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'quotations' AND column_name = 'folio'
  ) THEN
    SELECT COUNT(*), STRING_AGG(id::text, ', ' ORDER BY created_at DESC NULLS LAST)
    INTO v_count, v_sample
    FROM (
      SELECT id, created_at
      FROM public.quotations
      WHERE folio IS NULL OR folio <= 0
      LIMIT 10
    ) s;
    PERFORM pg_temp.add_check(
      'quotations_folio_missing_or_invalid',
      CASE WHEN v_count > 0 THEN 'critical' ELSE 'info' END,
      v_count,
      'Cotizaciones sin folio o folio <= 0',
      v_sample
    );

    -- quotations duplicate folio
    SELECT COUNT(*) INTO v_count
    FROM (
      SELECT folio
      FROM public.quotations
      GROUP BY folio
      HAVING COUNT(*) > 1
    ) d;

    SELECT STRING_AGG(folio::text, ', ' ORDER BY folio DESC)
    INTO v_sample
    FROM (
      SELECT folio
      FROM public.quotations
      GROUP BY folio
      HAVING COUNT(*) > 1
      ORDER BY folio DESC
      LIMIT 10
    ) ds;

    PERFORM pg_temp.add_check(
      'quotations_folio_duplicates',
      CASE WHEN v_count > 0 THEN 'critical' ELSE 'info' END,
      v_count,
      'Folios duplicados en cotizaciones',
      v_sample
    );

    -- sequence drift quotations
    SELECT COALESCE(MAX(folio), 0) INTO v_max FROM public.quotations;
    IF to_regclass('public.quotations_folio_seq') IS NOT NULL THEN
      EXECUTE 'SELECT last_value::bigint FROM public.quotations_folio_seq' INTO v_seq_last;
      PERFORM pg_temp.add_check(
        'quotations_folio_sequence_drift',
        CASE WHEN v_seq_last <= v_max THEN 'warning' ELSE 'info' END,
        CASE WHEN v_seq_last <= v_max THEN 1 ELSE 0 END,
        format('last_value=%s, max_folio=%s (debe ser > max_folio)', v_seq_last, v_max),
        NULL
      );
    ELSE
      PERFORM pg_temp.add_check(
        'quotations_folio_sequence_missing',
        'warning',
        1,
        'No existe public.quotations_folio_seq',
        NULL
      );
    END IF;
  ELSE
    PERFORM pg_temp.add_check(
      'quotations_folio_column_missing',
      'critical',
      1,
      'No existe columna public.quotations.folio',
      NULL
    );
  END IF;

  -- orders without folio
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'folio'
  ) THEN
    SELECT COUNT(*), STRING_AGG(id::text, ', ' ORDER BY created_at DESC NULLS LAST)
    INTO v_count, v_sample
    FROM (
      SELECT id, created_at
      FROM public.orders
      WHERE folio IS NULL OR folio <= 0
      LIMIT 10
    ) s;
    PERFORM pg_temp.add_check(
      'orders_folio_missing_or_invalid',
      CASE WHEN v_count > 0 THEN 'critical' ELSE 'info' END,
      v_count,
      'Pedidos sin folio o folio <= 0',
      v_sample
    );

    -- orders duplicate folio
    SELECT COUNT(*) INTO v_count
    FROM (
      SELECT folio
      FROM public.orders
      GROUP BY folio
      HAVING COUNT(*) > 1
    ) d;

    SELECT STRING_AGG(folio::text, ', ' ORDER BY folio DESC)
    INTO v_sample
    FROM (
      SELECT folio
      FROM public.orders
      GROUP BY folio
      HAVING COUNT(*) > 1
      ORDER BY folio DESC
      LIMIT 10
    ) ds;

    PERFORM pg_temp.add_check(
      'orders_folio_duplicates',
      CASE WHEN v_count > 0 THEN 'critical' ELSE 'info' END,
      v_count,
      'Folios duplicados en pedidos',
      v_sample
    );

    -- sequence drift orders
    SELECT COALESCE(MAX(folio), 0) INTO v_max FROM public.orders;
    IF to_regclass('public.orders_folio_seq') IS NOT NULL THEN
      EXECUTE 'SELECT last_value::bigint FROM public.orders_folio_seq' INTO v_seq_last;
      PERFORM pg_temp.add_check(
        'orders_folio_sequence_drift',
        CASE WHEN v_seq_last <= v_max THEN 'warning' ELSE 'info' END,
        CASE WHEN v_seq_last <= v_max THEN 1 ELSE 0 END,
        format('last_value=%s, max_folio=%s (debe ser > max_folio)', v_seq_last, v_max),
        NULL
      );
    ELSE
      PERFORM pg_temp.add_check(
        'orders_folio_sequence_missing',
        'warning',
        1,
        'No existe public.orders_folio_seq',
        NULL
      );
    END IF;
  ELSE
    PERFORM pg_temp.add_check(
      'orders_folio_column_missing',
      'warning',
      1,
      'No existe columna public.orders.folio',
      NULL
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Integridad comercial base
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_sample TEXT;
BEGIN
  IF to_regclass('public.quotations') IS NOT NULL THEN
    SELECT COUNT(*), STRING_AGG(id::text, ', ')
    INTO v_count, v_sample
    FROM (
      SELECT id
      FROM public.quotations
      WHERE client_id IS NULL OR seller_id IS NULL
      LIMIT 10
    ) s;
    PERFORM pg_temp.add_check(
      'quotations_missing_client_or_seller',
      CASE WHEN v_count > 0 THEN 'critical' ELSE 'info' END,
      v_count,
      'Cotizaciones sin client_id o seller_id',
      v_sample
    );

    -- total_amount vs suma de items.total (neto) o neto+IVA 19% (bruto)
    SELECT COUNT(*), STRING_AGG(id::text, ', ')
    INTO v_count, v_sample
    FROM (
      SELECT q.id
      FROM public.quotations q
      WHERE q.items IS NOT NULL
        AND jsonb_typeof(q.items::jsonb) = 'array'
        AND (
          WITH net AS (
            SELECT COALESCE((
              SELECT SUM(
                CASE
                  WHEN (e->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e->>'total')::numeric
                  ELSE 0
                END
              )
              FROM jsonb_array_elements(q.items::jsonb) e
            ), 0) AS net_total
          )
          SELECT
            ABS(net_total - COALESCE(q.total_amount, 0)) > 1
            AND ABS(ROUND(net_total * 1.19) - COALESCE(q.total_amount, 0)) > 1
          FROM net
        )
      LIMIT 10
    ) t;
    PERFORM pg_temp.add_check(
      'quotations_total_mismatch_items',
      CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
      v_count,
      'total_amount no coincide ni con neto(items.total) ni con neto+IVA(19%)',
      v_sample
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Aprobaciones de descuento
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_sample TEXT;
BEGIN
  IF to_regclass('public.approval_requests') IS NOT NULL AND to_regclass('public.quotations') IS NOT NULL THEN
    SELECT COUNT(*), STRING_AGG(z.id::text, ', ')
    INTO v_count, v_sample
    FROM (
      SELECT ar.id
      FROM public.approval_requests ar
      LEFT JOIN public.quotations q ON q.id = ar.entity_id
      WHERE ar.module = 'sales'
        AND ar.approval_type = 'extra_discount'
        AND q.id IS NULL
      LIMIT 10
    ) z;
    PERFORM pg_temp.add_check(
      'approval_requests_orphan_sales',
      CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
      v_count,
      'Solicitudes de aprobacion (sales/extra_discount) sin cotizacion existente',
      v_sample
    );

    SELECT COUNT(*), STRING_AGG(p.id::text, ', ')
    INTO v_count, v_sample
    FROM (
      SELECT q.id
      FROM public.quotations q
      WHERE EXISTS (
        SELECT 1
        FROM public.approval_requests ar
        WHERE ar.entity_id = q.id
          AND ar.module = 'sales'
          AND ar.approval_type = 'extra_discount'
          AND ar.status = 'pending'
      )
        AND COALESCE(LOWER(q.status), '') IN ('approved', 'sent')
      LIMIT 10
    ) p;
    PERFORM pg_temp.add_check(
      'quotations_status_conflicts_pending_approval',
      CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
      v_count,
      'Cotizaciones operativas con aprobacion de descuento aun pendiente',
      v_sample
    );
  ELSE
    PERFORM pg_temp.add_check(
      'approval_requests_table_missing',
      'warning',
      1,
      'No existe public.approval_requests (se omiten checks de aprobacion)',
      NULL
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4) Embudo y estados de cotizaciones
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_sample TEXT;
BEGIN
  IF to_regclass('public.quotations') IS NOT NULL THEN
    -- status fuera de catalogo esperado
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'quotations' AND column_name = 'status'
    ) THEN
      SELECT COUNT(*), STRING_AGG(id::text, ', ')
      INTO v_count, v_sample
      FROM (
        SELECT id
        FROM public.quotations
        WHERE status IS NOT NULL
          AND LOWER(status) NOT IN ('draft', 'sent', 'approved', 'rejected', 'cancelled')
        LIMIT 10
      ) s;
      PERFORM pg_temp.add_check(
        'quotations_status_unexpected_values',
        CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
        v_count,
        'Valores de quotations.status fuera de catalogo esperado',
        v_sample
      );
    END IF;

    -- stage column opcional
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'quotations' AND column_name = 'stage'
    ) THEN
      SELECT COUNT(*), STRING_AGG(id::text, ', ')
      INTO v_count, v_sample
      FROM (
        SELECT id
        FROM public.quotations
        WHERE stage IS NOT NULL
          AND LOWER(stage) NOT IN ('new', 'contacted', 'negotiation', 'sent', 'won', 'lost')
        LIMIT 10
      ) s;
      PERFORM pg_temp.add_check(
        'quotations_stage_unexpected_values',
        CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
        v_count,
        'Valores de quotations.stage fuera de catalogo esperado',
        v_sample
      );
    ELSE
      PERFORM pg_temp.add_check(
        'quotations_stage_column_missing',
        'info',
        0,
        'No existe quotations.stage (pipeline usa fallback con status)',
        NULL
      );
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5) GPS / Visitas
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_sample TEXT;
  v_check_expr TEXT;
BEGIN
  IF to_regclass('public.visits') IS NOT NULL THEN
    v_check_expr := NULL;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'check_in_time'
    ) THEN
      v_check_expr := 'check_in_time IS NOT NULL';
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'check_in_at'
    ) THEN
      v_check_expr := 'check_in_at IS NOT NULL';
    END IF;

    -- Caso esquema A: lat/lng
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'lat'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'lng'
    ) THEN
      IF v_check_expr IS NOT NULL THEN
        EXECUTE format(
          'SELECT COUNT(*), STRING_AGG(id::text, '', '')
           FROM (
             SELECT id
             FROM public.visits
             WHERE (%s) AND (lat IS NULL OR lng IS NULL)
             LIMIT 10
           ) s',
          v_check_expr
        )
        INTO v_count, v_sample;
      ELSE
        v_count := 0;
        v_sample := NULL;
      END IF;
      PERFORM pg_temp.add_check(
        'visits_checkin_without_gps_lat_lng',
        CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
        v_count,
        'Visitas con check-in pero sin coordenadas lat/lng',
        v_sample
      );
    END IF;

    -- Caso esquema B: location_lat/location_lng
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'location_lat'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'location_lng'
    ) THEN
      IF v_check_expr IS NOT NULL THEN
        EXECUTE format(
          'SELECT COUNT(*), STRING_AGG(id::text, '', '')
           FROM (
             SELECT id
             FROM public.visits
             WHERE (%s) AND (location_lat IS NULL OR location_lng IS NULL)
             LIMIT 10
           ) s',
          v_check_expr
        )
        INTO v_count, v_sample;
      ELSE
        v_count := 0;
        v_sample := NULL;
      END IF;
      PERFORM pg_temp.add_check(
        'visits_checkin_without_gps_location_lat_lng',
        CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
        v_count,
        'Visitas con check-in pero sin location_lat/location_lng',
        v_sample
      );
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6) Cobranzas (si existe tabla)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_sample TEXT;
BEGIN
  IF to_regclass('public.collections_pending') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'collections_pending' AND column_name = 'seller_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'collections_pending' AND column_name = 'document_number'
    ) THEN
      SELECT COUNT(*), STRING_AGG((seller_id::text || ':' || document_number::text), ', ')
      INTO v_count, v_sample
      FROM (
        SELECT seller_id, document_number
        FROM public.collections_pending
        GROUP BY seller_id, document_number
        HAVING COUNT(*) > 1
        LIMIT 10
      ) s;
      PERFORM pg_temp.add_check(
        'collections_duplicates_seller_document',
        CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
        v_count,
        'Duplicados de cobranza por seller_id + document_number',
        v_sample
      );
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'collections_pending' AND column_name = 'amount'
    ) THEN
      SELECT COUNT(*), STRING_AGG(id::text, ', ')
      INTO v_count, v_sample
      FROM (
        SELECT id
        FROM public.collections_pending
        WHERE COALESCE(amount, 0) <= 0
        LIMIT 10
      ) s;
      PERFORM pg_temp.add_check(
        'collections_non_positive_amount',
        CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
        v_count,
        'Cobranza con monto <= 0',
        v_sample
      );
    END IF;
  ELSE
    PERFORM pg_temp.add_check(
      'collections_pending_table_missing',
      'info',
      0,
      'No existe public.collections_pending en esta instancia',
      NULL
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7) Roles y perfiles
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_sample TEXT;
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    SELECT COUNT(*), STRING_AGG(id::text, ', ')
    INTO v_count, v_sample
    FROM (
      SELECT id
      FROM public.profiles
      WHERE role IS NULL OR LOWER(role) NOT IN ('admin', 'jefe', 'facturador', 'seller', 'driver')
      LIMIT 10
    ) s;
    PERFORM pg_temp.add_check(
      'profiles_invalid_role',
      CASE WHEN v_count > 0 THEN 'critical' ELSE 'info' END,
      v_count,
      'Perfiles con rol invalido o nulo',
      v_sample
    );

    SELECT COUNT(*), STRING_AGG(id::text, ', ')
    INTO v_count, v_sample
    FROM (
      SELECT id
      FROM public.profiles
      WHERE status IS NULL OR LOWER(status) NOT IN ('pending', 'active', 'disabled')
      LIMIT 10
    ) s;
    PERFORM pg_temp.add_check(
      'profiles_invalid_status',
      CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END,
      v_count,
      'Perfiles con status invalido o nulo',
      v_sample
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8) KPIs base para dashboard (sanity)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_q BIGINT := 0;
  v_o BIGINT := 0;
  v_v BIGINT := 0;
  v_c BIGINT := 0;
BEGIN
  IF to_regclass('public.quotations') IS NOT NULL THEN SELECT COUNT(*) INTO v_q FROM public.quotations; END IF;
  IF to_regclass('public.orders') IS NOT NULL THEN SELECT COUNT(*) INTO v_o FROM public.orders; END IF;
  IF to_regclass('public.visits') IS NOT NULL THEN SELECT COUNT(*) INTO v_v FROM public.visits; END IF;
  IF to_regclass('public.clients') IS NOT NULL THEN SELECT COUNT(*) INTO v_c FROM public.clients; END IF;

  PERFORM pg_temp.add_check(
    'dashboard_base_counts',
    'info',
    0,
    format('clients=%s, quotations=%s, orders=%s, visits=%s', v_c, v_q, v_o, v_v),
    NULL
  );
END $$;

-- ----------------------------------------------------------------------------
-- Resultado final
-- ----------------------------------------------------------------------------
SELECT
  check_name,
  severity,
  affected_rows,
  details,
  sample_ids,
  checked_at
FROM tmp_health_checks
ORDER BY
  CASE severity
    WHEN 'critical' THEN 1
    WHEN 'warning' THEN 2
    ELSE 3
  END,
  affected_rows DESC,
  check_name ASC;

COMMIT;
