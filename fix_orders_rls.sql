-- Enable RLS on orders if not already enabled
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 1. Allow Users to View their own orders (and Admins to view all)
DROP POLICY IF EXISTS "Users can view own orders" ON orders;
CREATE POLICY "Users can view own orders" ON orders FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'jefe', 'superadmin', 'supervisor'))
);

-- 2. Allow Users to Insert their own orders (and Admins can create for others)
DROP POLICY IF EXISTS "Users can insert own orders" ON orders;
CREATE POLICY "Users can insert own orders" ON orders FOR INSERT WITH CHECK (
    user_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'jefe', 'superadmin', 'supervisor'))
);

-- 3. Allow Updates (e.g. status changes)
DROP POLICY IF EXISTS "Users can update own orders" ON orders;
CREATE POLICY "Users can update own orders" ON orders FOR UPDATE USING (
    user_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'jefe', 'superadmin', 'supervisor'))
);
