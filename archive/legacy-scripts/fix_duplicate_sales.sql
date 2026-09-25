-- 1. Delete orders that came from quotations but have No Items (Failed attempts due to RLS error)
DELETE FROM orders
WHERE quotation_id IS NOT NULL
AND id NOT IN (SELECT DISTINCT order_id FROM order_items);

-- 2. If valid duplicates still exist (multiple orders for same quotation), keep only the LATEST one.
DELETE FROM orders
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY quotation_id ORDER BY created_at DESC) as rnum
    FROM orders
    WHERE quotation_id IS NOT NULL
  ) t
  WHERE t.rnum > 1
);
