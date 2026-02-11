-- Permissions Fix for Order Items
-- The previous policy only allowed inserting items if the order belonged exactly to the logged-in user.
-- This fails if an Admin/Supervisor converts a quotation for another seller.

DROP POLICY IF EXISTS "Users can insert own order items" ON order_items;

CREATE POLICY "Users and Admins can insert order items" ON order_items FOR INSERT WITH CHECK (
    order_id IN (
        SELECT id FROM orders 
        WHERE user_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'jefe', 'superadmin', 'supervisor')
        )
    )
);

-- Also ensure Select policy is broad enough
DROP POLICY IF EXISTS "Users can see own order items" ON order_items;

CREATE POLICY "Users and Admins can see order items" ON order_items FOR SELECT USING (
    order_id IN (
        SELECT id FROM orders 
        WHERE user_id = auth.uid() 
        OR EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role IN ('admin', 'jefe', 'superadmin', 'supervisor')
        )
    )
);
