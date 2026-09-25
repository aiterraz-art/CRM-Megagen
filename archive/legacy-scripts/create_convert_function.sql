-- Create a stored procedure to handle the entire "Quotation -> Order" flow atomically
-- This ensures that stock is deducted ONLY if the order is successfully created.

CREATE OR REPLACE FUNCTION convert_quotation_to_order(
  p_quotation_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator (to update stock/orders even if RLS is tricky)
AS $$
DECLARE
  v_quotation RECORD;
  v_order_id UUID;
  v_item JSONB;
  v_product_id UUID;
  v_qty INTEGER;
  v_total_amount NUMERIC;
BEGIN
  -- 1. Fetch and Lock Quotation (Prevent double clicks)
  SELECT * INTO v_quotation 
  FROM quotations 
  WHERE id = p_quotation_id 
  FOR UPDATE; -- Lock row

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada.';
  END IF;

  IF v_quotation.status = 'approved' THEN
    RAISE EXCEPTION 'Esta cotización ya fue convertida en venta.';
  END IF;

  -- 2. Create Order
  INSERT INTO orders (user_id, client_id, total_amount, status, quotation_id, created_at)
  VALUES (p_user_id, v_quotation.client_id, v_quotation.total_amount, 'completed', p_quotation_id, NOW())
  RETURNING id INTO v_order_id;

  -- 3. Process Items (from the JSONB 'items' column in quotation)
  -- Expected Item format: { "code": "SKU", "qty": 1, "price": 100, ... }
  
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_quotation.items)
  LOOP
    v_qty := (v_item->>'qty')::INTEGER;
    
    -- Try to find product by SKU (code) first, then Name (detail)
    -- Ideally we should store product_id in items, but for legacy support we match by SKU
    SELECT id INTO v_product_id 
    FROM inventory 
    WHERE sku = (v_item->>'code') 
    LIMIT 1;

    -- Update Order Items
    INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
    VALUES (
      v_order_id,
      v_product_id, -- Can be NULL if not found in inventory
      v_qty,
      (v_item->>'price')::NUMERIC,
      (v_item->>'total')::NUMERIC
    );

    -- DEDUCT STOCK if product exists
    IF v_product_id IS NOT NULL THEN
      UPDATE inventory
      SET stock_qty = stock_qty - v_qty
      WHERE id = v_product_id;
    END IF;

  END LOOP;

  -- 4. Mark Quotation as Approved
  UPDATE quotations 
  SET status = 'approved' 
  WHERE id = p_quotation_id;

  RETURN jsonb_build_object('success', true, 'order_id', v_order_id);

EXCEPTION WHEN OTHERS THEN
  -- Transaction will automatically rollback on exception
  RAISE;
END;
$$;
