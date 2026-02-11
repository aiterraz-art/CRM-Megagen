-- ==============================================================================
-- MASTER DEPLOYMENT SCRIPT - 3DENTAL CRM V2 (REPLICA)
-- Fecha: 2026-01-31
-- Descripción: Reconstrucción completa de la base de datos para nueva instancia.
-- Orden de ejecución: Types -> Profiles -> Clients -> Products -> Visits -> Orders -> Logistics
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SETUP INICIAL Y TIPOS
-- ------------------------------------------------------------------------------
-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tipos ENUM personalizados
DO $$ BEGIN
    CREATE TYPE app_role AS ENUM ('manager', 'jefe', 'administrativo', 'seller', 'driver');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('pending', 'active', 'disabled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE route_status AS ENUM ('draft', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE delivery_item_status AS ENUM ('pending', 'delivered', 'failed', 'rescheduled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ------------------------------------------------------------------------------
-- 2. USUARIOS Y PERFILES (PROFILES)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'seller' CHECK (role IN ('manager', 'jefe', 'administrativo', 'seller', 'driver')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Trigger para crear perfil automáticamente al registrarse en Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', 'seller');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Políticas Profiles
CREATE POLICY "Public Read Basic Info" ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 3. CLIENTES (CLIENTS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    rut TEXT UNIQUE,
    email TEXT,
    phone TEXT,
    address TEXT,
    comuna TEXT,
    region TEXT,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Políticas Clients
CREATE POLICY "Sellers view own clients" ON clients FOR SELECT USING (
    created_by = auth.uid() OR 
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe', 'administrativo'))
);
CREATE POLICY "Sellers insert clients" ON clients FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Sellers update own clients" ON clients FOR UPDATE USING (created_by = auth.uid());

-- ------------------------------------------------------------------------------
-- 4. INVENTARIO (PRODUCTS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    description TEXT,
    price NUMERIC NOT NULL DEFAULT 0,
    stock_quantity INTEGER DEFAULT 0,
    category TEXT,
    min_stock_alert INTEGER DEFAULT 5,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone read products" ON products FOR SELECT USING (true);
CREATE POLICY "Staff edit products" ON products FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe', 'administrativo'))
);

-- Seed Data (Ejemplo Inicial)
INSERT INTO products (name, sku, price, stock_quantity, category) VALUES 
('Implante Titanio Tipo A', 'IMP-001', 150000, 50, 'Implantes'),
('Hueso Sintético 0.5g', 'BIO-001', 85000, 100, 'Biomateriales')
ON CONFLICT (sku) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. VISITAS (VISITS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id), -- Vendedor
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    title TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'rescheduled')),
    check_in_at TIMESTAMP WITH TIME ZONE,
    check_out_at TIMESTAMP WITH TIME ZONE,
    location_lat NUMERIC,
    location_lng NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own visits" ON visits FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe'))
);
CREATE POLICY "Users create visits" ON visits FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 6. ÓRDENES Y VENTAS (ORDERS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id),
    user_id UUID REFERENCES public.profiles(id), -- Vendedor
    visit_id UUID REFERENCES public.visits(id),
    status TEXT DEFAULT 'completed' CHECK (status IN ('draft', 'pending', 'completed', 'cancelled')),
    total_amount NUMERIC DEFAULT 0,
    notes TEXT,
    payment_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    quantity INTEGER DEFAULT 1,
    unit_price NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Políticas Orders
CREATE POLICY "View orders" ON orders FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe', 'administrativo'))
);
CREATE POLICY "Create orders" ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "View items" ON order_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND (
        orders.user_id = auth.uid() OR 
        EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe', 'administrativo'))
    ))
);

-- ------------------------------------------------------------------------------
-- 7. LOGÍSTICA Y RUTAS (DELIVERY)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id),
    status route_status DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.route_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    route_id UUID REFERENCES public.delivery_routes(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    sequence_order INTEGER NOT NULL DEFAULT 0,
    status delivery_item_status DEFAULT 'pending',
    notes TEXT,
    proof_photo_url TEXT,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(route_id, order_id)
);

ALTER TABLE public.route_items ENABLE ROW LEVEL SECURITY;

-- Políticas Delivery
CREATE POLICY "Managers all routes" ON delivery_routes FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe', 'administrativo'))
);
CREATE POLICY "Drivers view assigned" ON delivery_routes FOR SELECT USING (driver_id = auth.uid());
CREATE POLICY "Drivers update status" ON delivery_routes FOR UPDATE USING (driver_id = auth.uid());

CREATE POLICY "Managers all items" ON route_items FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe', 'administrativo'))
);
CREATE POLICY "Drivers view items" ON route_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM delivery_routes WHERE id = route_items.route_id AND driver_id = auth.uid())
);
CREATE POLICY "Drivers update items" ON route_items FOR UPDATE USING (
    EXISTS (SELECT 1 FROM delivery_routes WHERE id = route_items.route_id AND driver_id = auth.uid())
);

-- ------------------------------------------------------------------------------
-- 8. REGISTROS (LOGS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT CHECK (status IN ('contestada', 'no_contesto', 'ocupado', 'equivocado', 'buzon')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View logs" ON call_logs FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('manager', 'jefe'))
);
CREATE POLICY "Insert logs" ON call_logs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 9. CONFIGURACIÓN FINAL DE STORAGE (OPCIONAL)
-- ------------------------------------------------------------------------------
-- Intenta crear bucket para evidencia si la extensión storage está disponible
INSERT INTO storage.buckets (id, name, public) 
VALUES ('evidence-photos', 'evidence-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public Access Evidence" ON storage.objects FOR SELECT USING (bucket_id = 'evidence-photos');
CREATE POLICY "Drivers Upload Evidence" ON storage.objects FOR INSERT WITH CHECK (
    bucket_id = 'evidence-photos' AND auth.role() = 'authenticated'
);

-- ==============================================================================
-- FIN DEL SCRIPT
-- ==============================================================================
