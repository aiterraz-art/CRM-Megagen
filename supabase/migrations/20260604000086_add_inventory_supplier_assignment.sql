ALTER TABLE public.inventory
ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_supplier_id
    ON public.inventory (supplier_id);

DROP POLICY IF EXISTS "Suppliers read purchase orders" ON public.suppliers;
CREATE POLICY "Suppliers read purchase orders"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
    public.auth_user_has_permission('VIEW_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('MANAGE_PURCHASE_ORDERS')
    OR public.auth_user_has_permission('MANAGE_INVENTORY')
);
