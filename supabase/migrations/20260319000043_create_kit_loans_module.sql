CREATE TABLE IF NOT EXISTS public.loan_kits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kit_name text NOT NULL,
    kit_number text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'loaned', 'inactive')),
    notes text,
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kit_loan_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kit_id uuid NOT NULL REFERENCES public.loan_kits(id) ON DELETE RESTRICT,
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
    requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'pending_dispatch' CHECK (status IN ('pending_dispatch', 'delivered', 'returned', 'cancelled')),
    requested_days integer NOT NULL CHECK (requested_days > 0),
    request_note text,
    delivery_note text,
    return_note text,
    delivery_address_snapshot text NOT NULL,
    delivery_lat_snapshot double precision NOT NULL,
    delivery_lng_snapshot double precision NOT NULL,
    client_name_snapshot text NOT NULL,
    kit_name_snapshot text NOT NULL,
    kit_number_snapshot text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    due_at timestamptz,
    returned_at timestamptz,
    cancelled_at timestamptz,
    delivered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    returned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_kits_status ON public.loan_kits(status);
CREATE INDEX IF NOT EXISTS idx_loan_kits_created_by ON public.loan_kits(created_by);
CREATE INDEX IF NOT EXISTS idx_kit_loan_requests_status ON public.kit_loan_requests(status);
CREATE INDEX IF NOT EXISTS idx_kit_loan_requests_kit_id ON public.kit_loan_requests(kit_id);
CREATE INDEX IF NOT EXISTS idx_kit_loan_requests_client_id ON public.kit_loan_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_kit_loan_requests_requester_id ON public.kit_loan_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_kit_loan_requests_due_at ON public.kit_loan_requests(due_at);

CREATE OR REPLACE FUNCTION public.loan_kits_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_kit_loan_request_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_kit_status text;
    v_kit_name text;
    v_kit_number text;
    v_client_name text;
    v_delivered_at timestamptz;
BEGIN
    IF NEW.requested_days IS NULL OR NEW.requested_days <= 0 THEN
        RAISE EXCEPTION 'La cantidad de días de préstamo debe ser mayor a cero';
    END IF;

    IF NEW.delivery_lat_snapshot IS NULL OR NEW.delivery_lng_snapshot IS NULL THEN
        RAISE EXCEPTION 'Debes confirmar una ubicación GPS válida para el préstamo';
    END IF;

    IF NEW.delivery_lat_snapshot < -90 OR NEW.delivery_lat_snapshot > 90 OR NEW.delivery_lng_snapshot < -180 OR NEW.delivery_lng_snapshot > 180 THEN
        RAISE EXCEPTION 'Las coordenadas GPS del préstamo están fuera de rango';
    END IF;

    SELECT k.status, k.kit_name, k.kit_number
    INTO v_kit_status, v_kit_name, v_kit_number
    FROM public.loan_kits k
    WHERE k.id = NEW.kit_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El kit solicitado no existe';
    END IF;

    SELECT c.name
    INTO v_client_name
    FROM public.clients c
    WHERE c.id = NEW.client_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El cliente seleccionado no existe';
    END IF;

    NEW.kit_name_snapshot = COALESCE(NULLIF(trim(COALESCE(NEW.kit_name_snapshot, '')), ''), v_kit_name);
    NEW.kit_number_snapshot = COALESCE(NULLIF(trim(COALESCE(NEW.kit_number_snapshot, '')), ''), v_kit_number);
    NEW.client_name_snapshot = COALESCE(NULLIF(trim(COALESCE(NEW.client_name_snapshot, '')), ''), v_client_name);
    NEW.updated_at = now();

    IF TG_OP = 'INSERT' THEN
        NEW.status = COALESCE(NEW.status, 'pending_dispatch');
        NEW.requested_at = COALESCE(NEW.requested_at, now());

        IF NEW.status <> 'pending_dispatch' THEN
            RAISE EXCEPTION 'Las solicitudes nuevas deben iniciar como pendientes de despacho';
        END IF;

        IF v_kit_status <> 'available' THEN
            RAISE EXCEPTION 'El kit % no está disponible para préstamo', v_kit_number;
        END IF;

        UPDATE public.loan_kits
        SET status = 'reserved', updated_at = now()
        WHERE id = NEW.kit_id;

        RETURN NEW;
    END IF;

    IF NEW.kit_id <> OLD.kit_id THEN
        RAISE EXCEPTION 'No se puede cambiar el kit de una solicitud existente';
    END IF;

    IF OLD.status IN ('returned', 'cancelled') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'No se puede reabrir una solicitud cerrada';
    END IF;

    IF NEW.status = OLD.status THEN
        IF NEW.status = 'pending_dispatch' AND v_kit_status <> 'reserved' THEN
            UPDATE public.loan_kits SET status = 'reserved', updated_at = now() WHERE id = NEW.kit_id;
        ELSIF NEW.status = 'delivered' AND v_kit_status <> 'loaned' THEN
            UPDATE public.loan_kits SET status = 'loaned', updated_at = now() WHERE id = NEW.kit_id;
        ELSIF NEW.status IN ('returned', 'cancelled') AND v_kit_status <> 'available' THEN
            UPDATE public.loan_kits SET status = 'available', updated_at = now() WHERE id = NEW.kit_id;
        END IF;

        IF NEW.status = 'delivered' AND NEW.due_at IS NULL THEN
            v_delivered_at := COALESCE(NEW.delivered_at, OLD.delivered_at, now());
            NEW.delivered_at = COALESCE(NEW.delivered_at, v_delivered_at);
            NEW.due_at = v_delivered_at + make_interval(days => NEW.requested_days);
        END IF;

        RETURN NEW;
    END IF;

    CASE OLD.status
        WHEN 'pending_dispatch' THEN
            IF NEW.status = 'delivered' THEN
                v_delivered_at := COALESCE(NEW.delivered_at, now());
                NEW.delivered_at = v_delivered_at;
                NEW.due_at = COALESCE(NEW.due_at, v_delivered_at + make_interval(days => NEW.requested_days));
                NEW.delivered_by = COALESCE(NEW.delivered_by, auth.uid());
                NEW.cancelled_at = NULL;

                UPDATE public.loan_kits
                SET status = 'loaned', updated_at = now()
                WHERE id = NEW.kit_id;
            ELSIF NEW.status = 'cancelled' THEN
                NEW.cancelled_at = COALESCE(NEW.cancelled_at, now());

                UPDATE public.loan_kits
                SET status = 'available', updated_at = now()
                WHERE id = NEW.kit_id;
            ELSE
                RAISE EXCEPTION 'Transición inválida desde pendiente de despacho a %', NEW.status;
            END IF;
        WHEN 'delivered' THEN
            IF NEW.status = 'returned' THEN
                NEW.returned_at = COALESCE(NEW.returned_at, now());
                NEW.returned_by = COALESCE(NEW.returned_by, auth.uid());

                UPDATE public.loan_kits
                SET status = 'available', updated_at = now()
                WHERE id = NEW.kit_id;
            ELSE
                RAISE EXCEPTION 'Transición inválida desde entregado a %', NEW.status;
            END IF;
        ELSE
            RAISE EXCEPTION 'Transición inválida desde % a %', OLD.status, NEW.status;
    END CASE;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loan_kits_touch_updated_at ON public.loan_kits;
CREATE TRIGGER trg_loan_kits_touch_updated_at
BEFORE UPDATE ON public.loan_kits
FOR EACH ROW
EXECUTE FUNCTION public.loan_kits_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kit_loan_requests_state ON public.kit_loan_requests;
CREATE TRIGGER trg_kit_loan_requests_state
BEFORE INSERT OR UPDATE ON public.kit_loan_requests
FOR EACH ROW
EXECUTE FUNCTION public.sync_kit_loan_request_state();

ALTER TABLE public.loan_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_loan_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.loan_kits TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.kit_loan_requests TO authenticated;

DROP POLICY IF EXISTS "Loan kits read" ON public.loan_kits;
CREATE POLICY "Loan kits read"
ON public.loan_kits
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller', 'facturador')
    )
);

DROP POLICY IF EXISTS "Loan kits manage insert" ON public.loan_kits;
CREATE POLICY "Loan kits manage insert"
ON public.loan_kits
FOR INSERT
TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
    )
);

DROP POLICY IF EXISTS "Loan kits manage update" ON public.loan_kits;
CREATE POLICY "Loan kits manage update"
ON public.loan_kits
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
    )
);

DROP POLICY IF EXISTS "Kit loan requests read" ON public.kit_loan_requests;
CREATE POLICY "Kit loan requests read"
ON public.kit_loan_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller', 'facturador')
    )
);

DROP POLICY IF EXISTS "Kit loan requests insert" ON public.kit_loan_requests;
CREATE POLICY "Kit loan requests insert"
ON public.kit_loan_requests
FOR INSERT
TO authenticated
WITH CHECK (
    requester_id = auth.uid()
    AND status = 'pending_dispatch'
    AND EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'jefe', 'seller')
    )
);

DROP POLICY IF EXISTS "Kit loan requests manage update" ON public.kit_loan_requests;
CREATE POLICY "Kit loan requests manage update"
ON public.kit_loan_requests
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('admin', 'facturador')
    )
);

INSERT INTO public.role_permissions (role, permission)
SELECT v.role, v.permission
FROM (
    VALUES
        ('admin', 'VIEW_KIT_LOANS'),
        ('admin', 'REQUEST_KIT_LOANS'),
        ('admin', 'MANAGE_KIT_LOANS'),
        ('jefe', 'VIEW_KIT_LOANS'),
        ('jefe', 'REQUEST_KIT_LOANS'),
        ('seller', 'VIEW_KIT_LOANS'),
        ('seller', 'REQUEST_KIT_LOANS'),
        ('facturador', 'VIEW_KIT_LOANS'),
        ('facturador', 'MANAGE_KIT_LOANS')
) AS v(role, permission)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = v.role
      AND rp.permission = v.permission
);
