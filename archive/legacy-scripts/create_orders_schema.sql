-- 1. Create PRODUCTS table (Inventory) if not exists
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    sku TEXT,
    description TEXT,
    price NUMERIC NOT NULL DEFAULT 0,
    stock_quantity INTEGER DEFAULT 0,
    category TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for Products
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read products" ON products;
CREATE POLICY "Everyone can read products" ON products FOR SELECT USING (true);
DROP POLICY IF EXISTS "Staff can edit products" ON products;
CREATE POLICY "Staff can edit products" ON products FOR ALL USING (
  auth.uid() IN (SELECT id FROM profiles WHERE role IN ('admin', 'jefe'))
);

-- 2. Ensure ORDERS table has necessary columns
-- Because the table already exists, we must add columns explicitly if they are missing.
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Safe Alter Table Commands (Postgres 9.6+)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES visits(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';

-- 3. Create ORDER_ITEMS table (Detail)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    quantity INTEGER DEFAULT 1,
    unit_price NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for Order Items
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can see own order items" ON order_items;
CREATE POLICY "Users can see own order items" ON order_items FOR SELECT USING (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "Users can insert own order items" ON order_items;
CREATE POLICY "Users can insert own order items" ON order_items FOR INSERT WITH CHECK (
    order_id IN (SELECT id FROM orders WHERE user_id = auth.uid())
);

-- 4. Insert Seed Data
INSERT INTO products (name, sku, price, stock_quantity, category)
VALUES 
('Implante Titanio Tipo A', 'IMP-001', 150000, 50, 'Implantes'),
('Implante Zirconio Premium', 'IMP-002', 250000, 30, 'Implantes'),
('Hueso Sintético 0.5g', 'BIO-001', 85000, 100, 'Biomateriales'),
('Membrana Colágeno', 'BIO-002', 120000, 20, 'Biomateriales'),
('Kit Quirúrgico Básico', 'INS-001', 450000, 5, 'Instrumental')
ON CONFLICT DO NOTHING;
