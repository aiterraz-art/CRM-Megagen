CREATE TABLE IF NOT EXISTS public.supplier_payables (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
    reference_number text,
    description text NOT NULL,
    issue_date date NOT NULL DEFAULT CURRENT_DATE,
    due_date date NOT NULL,
    currency text NOT NULL DEFAULT 'CLP',
    total_amount numeric(14,2) NOT NULL DEFAULT 0,
    paid_amount numeric(14,2) NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending',
    notes text,
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT supplier_payables_status_ck CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
    CONSTRAINT supplier_payables_currency_ck CHECK (currency IN ('CLP', 'USD')),
    CONSTRAINT supplier_payables_total_amount_ck CHECK (total_amount >= 0),
    CONSTRAINT supplier_payables_paid_amount_ck CHECK (paid_amount >= 0 AND paid_amount <= total_amount),
    CONSTRAINT supplier_payables_due_date_ck CHECK (due_date >= issue_date)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payables_supplier_id
    ON public.supplier_payables (supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_payables_due_date
    ON public.supplier_payables (due_date);

CREATE INDEX IF NOT EXISTS idx_supplier_payables_status
    ON public.supplier_payables (status);

CREATE INDEX IF NOT EXISTS idx_supplier_payables_created_at
    ON public.supplier_payables (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payables TO authenticated;

INSERT INTO public.role_permissions (role, permission)
SELECT v.role, v.permission
FROM (
    VALUES
        ('admin', 'VIEW_SUPPLIER_PAYABLES'),
        ('admin', 'MANAGE_SUPPLIER_PAYABLES'),
        ('jefe', 'VIEW_SUPPLIER_PAYABLES'),
        ('jefe', 'MANAGE_SUPPLIER_PAYABLES')
) AS v(role, permission)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = v.role
      AND rp.permission = v.permission
);

ALTER TABLE public.supplier_payables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Suppliers read purchase orders" ON public.suppliers;
CREATE POLICY "Suppliers read purchase orders"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_permission('VIEW_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('VIEW_SUPPLIER_PAYABLES')
    OR public.auth_user_has_permission('MANAGE_SUPPLIER_PAYABLES')
);

DROP POLICY IF EXISTS "Supplier payables read access" ON public.supplier_payables;
CREATE POLICY "Supplier payables read access"
ON public.supplier_payables
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_permission('VIEW_SUPPLIER_PAYABLES')
    OR public.auth_user_has_permission('MANAGE_SUPPLIER_PAYABLES')
);

DROP POLICY IF EXISTS "Supplier payables manage access" ON public.supplier_payables;
CREATE POLICY "Supplier payables manage access"
ON public.supplier_payables
FOR ALL
TO authenticated
USING (
    public.auth_user_has_permission('MANAGE_SUPPLIER_PAYABLES')
)
WITH CHECK (
    public.auth_user_has_permission('MANAGE_SUPPLIER_PAYABLES')
);
