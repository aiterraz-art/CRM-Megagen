-- WARNING: This script fixes a mismatch where order_items references a 'products' table
-- but the application uses 'inventory'.

BEGIN;

-- 1. Drop the incorrect foreign key constraint
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;

-- 2. Add the correct foreign key constraint pointing to 'inventory'
-- We assume 'inventory' table exists and has a UUID primary key 'id'
ALTER TABLE order_items 
  ADD CONSTRAINT order_items_product_id_fkey 
  FOREIGN KEY (product_id) 
  REFERENCES inventory(id);

COMMIT;
