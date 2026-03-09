-- Ensure sales orders reference inventory products (not legacy products table).
-- Current quotation flow stores product_id from public.inventory.id.

DO $$
DECLARE
    v_ref_table regclass;
BEGIN
    SELECT confrelid
    INTO v_ref_table
    FROM pg_constraint
    WHERE conname = 'order_items_product_id_fkey'
      AND conrelid = 'public.order_items'::regclass
    LIMIT 1;

    -- If the FK is missing or points to a legacy table, recreate it against inventory(id).
    IF v_ref_table IS NULL OR v_ref_table::text <> 'inventory' THEN
        ALTER TABLE public.order_items
            DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;

        ALTER TABLE public.order_items
            ADD CONSTRAINT order_items_product_id_fkey
            FOREIGN KEY (product_id)
            REFERENCES public.inventory(id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END $$;

