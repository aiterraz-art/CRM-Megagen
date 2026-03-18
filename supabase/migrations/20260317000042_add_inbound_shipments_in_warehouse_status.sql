DO $$
DECLARE
    v_constraint_name text;
BEGIN
    IF to_regclass('public.inbound_shipments') IS NULL THEN
        RAISE NOTICE 'public.inbound_shipments no existe, se omite migración';
        RETURN;
    END IF;

    SELECT conname
    INTO v_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.inbound_shipments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%in_transit%arrived_chile%received%';

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.inbound_shipments DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.inbound_shipments'::regclass
          AND conname = 'inbound_shipments_status_check'
    ) THEN
        ALTER TABLE public.inbound_shipments
        ADD CONSTRAINT inbound_shipments_status_check
        CHECK (status IN ('in_transit', 'arrived_chile', 'received', 'in_warehouse'));
    END IF;
END $$;
