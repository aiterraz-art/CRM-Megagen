-- ==============================================================================
-- MASTER DEPLOYMENT SCRIPT - CRM V2 (UNIVERSAL)
-- Fecha: 2026-02-20
-- Descripción: Reconstrucción completa de la base de datos para nueva instancia.
-- Incluye migraciones robustas para compatibilidad con instancias existentes.
-- Orden: Types -> Profiles -> Clients -> Inventory -> Visits -> Quotations -> Orders -> Logistics -> Logs -> Goals
-- ==============================================================================
-- ------------------------------------------------------------------------------
-- 1. SETUP INICIAL Y TIPOS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN CREATE TYPE app_role AS ENUM (
    'manager',
    'jefe',
    'administrativo',
    'seller',
    'driver'
);
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN CREATE TYPE user_status AS ENUM ('pending', 'active', 'disabled');
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN CREATE TYPE route_status AS ENUM ('draft', 'in_progress', 'completed');
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN CREATE TYPE delivery_item_status AS ENUM ('pending', 'delivered', 'failed', 'rescheduled');
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
-- ------------------------------------------------------------------------------
-- 2. USUARIOS Y PERFILES (PROFILES)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'seller' CHECK (
        role IN (
            'manager',
            'jefe',
            'administrativo',
            'seller',
            'driver'
        )
    ),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    phone TEXT,
    zone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- Migración: Añadir columna zone si no existe
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = 'zone'
) THEN
ALTER TABLE public.profiles
ADD COLUMN zone TEXT;
END IF;
END $$;
-- Trigger para crear perfil automáticamente al registrarse en Auth
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger AS $$ BEGIN
INSERT INTO public.profiles (id, email, full_name, role)
VALUES (
        new.id,
        new.email,
        new.raw_user_meta_data->>'full_name',
        'seller'
    );
RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
-- Políticas Profiles
DROP POLICY IF EXISTS "Public Read Basic Info" ON profiles;
CREATE POLICY "Public Read Basic Info" ON profiles FOR
SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR
UPDATE USING (auth.uid() = id);
-- ------------------------------------------------------------------------------
-- 2.5 LISTA BLANCA (USER_WHITELIST)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_whitelist (
    email TEXT PRIMARY KEY,
    role TEXT DEFAULT 'seller' CHECK (
        role IN (
            'manager',
            'jefe',
            'administrativo',
            'seller',
            'driver'
        )
    ),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.user_whitelist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage whitelist" ON user_whitelist;
CREATE POLICY "Admins can manage whitelist" ON user_whitelist FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe')
    )
);
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
    zone TEXT,
    giro TEXT,
    office TEXT,
    lat NUMERIC,
    lng NUMERIC,
    notes TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
-- Migraciones: Añadir columnas faltantes si no existen
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name = 'zone'
) THEN
ALTER TABLE public.clients
ADD COLUMN zone TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name = 'giro'
) THEN
ALTER TABLE public.clients
ADD COLUMN giro TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name = 'office'
) THEN
ALTER TABLE public.clients
ADD COLUMN office TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name = 'lat'
) THEN
ALTER TABLE public.clients
ADD COLUMN lat NUMERIC;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'clients'
        AND column_name = 'lng'
) THEN
ALTER TABLE public.clients
ADD COLUMN lng NUMERIC;
END IF;
END $$;
-- Políticas Clients
DROP POLICY IF EXISTS "Sellers view own clients" ON clients;
CREATE POLICY "Sellers view own clients" ON clients FOR
SELECT USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Sellers insert clients" ON clients;
CREATE POLICY "Sellers insert clients" ON clients FOR
INSERT WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "Sellers update own clients" ON clients;
CREATE POLICY "Sellers update own clients" ON clients FOR
UPDATE USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
-- ------------------------------------------------------------------------------
-- 4. INVENTARIO (INVENTORY)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    description TEXT,
    price NUMERIC NOT NULL DEFAULT 0,
    stock_qty INTEGER DEFAULT 0,
    category TEXT,
    min_stock_alert INTEGER DEFAULT 5,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone read products" ON inventory;
CREATE POLICY "Everyone read products" ON inventory FOR
SELECT USING (true);
DROP POLICY IF EXISTS "Staff edit products" ON inventory;
CREATE POLICY "Staff edit products" ON inventory FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
-- Seed Data (Ejemplo Inicial)
INSERT INTO inventory (name, sku, price, stock_qty, category)
VALUES (
        'Implante Titanio Tipo A',
        'IMP-001',
        150000,
        50,
        'Implantes'
    ),
    (
        'Hueso Sintético 0.5g',
        'BIO-001',
        85000,
        100,
        'Biomateriales'
    ) ON CONFLICT (sku) DO NOTHING;
-- ------------------------------------------------------------------------------
-- 5. VISITAS (VISITS)
-- ------------------------------------------------------------------------------
-- MIGRACIÓN ROBUSTA: Renombrar columnas antiguas si existen
DO $$ BEGIN -- Renombrar user_id a sales_rep_id
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'user_id'
) THEN
ALTER TABLE public.visits
    RENAME COLUMN user_id TO sales_rep_id;
END IF;
-- Renombrar check_in_at a check_in_time
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'check_in_at'
) THEN
ALTER TABLE public.visits
    RENAME COLUMN check_in_at TO check_in_time;
END IF;
-- Renombrar check_out_at a check_out_time
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'check_out_at'
) THEN
ALTER TABLE public.visits
    RENAME COLUMN check_out_at TO check_out_time;
END IF;
-- Renombrar location_lat a lat
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'location_lat'
) THEN
ALTER TABLE public.visits
    RENAME COLUMN location_lat TO lat;
END IF;
-- Renombrar location_lng a lng
IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'location_lng'
) THEN
ALTER TABLE public.visits
    RENAME COLUMN location_lng TO lng;
END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.visits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    sales_rep_id UUID REFERENCES public.profiles(id),
    scheduled_at TIMESTAMP WITH TIME ZONE,
    title TEXT,
    purpose TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'in_progress',
            'completed',
            'cancelled',
            'rescheduled',
            'scheduled'
        )
    ),
    check_in_time TIMESTAMP WITH TIME ZONE,
    check_out_time TIMESTAMP WITH TIME ZONE,
    lat NUMERIC,
    lng NUMERIC,
    check_out_lat NUMERIC,
    check_out_lng NUMERIC,
    outcome TEXT,
    type TEXT,
    google_event_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
-- Migraciones: Añadir columnas faltantes si la tabla ya existía
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'google_event_id'
) THEN
ALTER TABLE public.visits
ADD COLUMN google_event_id TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'purpose'
) THEN
ALTER TABLE public.visits
ADD COLUMN purpose TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'check_out_lat'
) THEN
ALTER TABLE public.visits
ADD COLUMN check_out_lat NUMERIC;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'check_out_lng'
) THEN
ALTER TABLE public.visits
ADD COLUMN check_out_lng NUMERIC;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'outcome'
) THEN
ALTER TABLE public.visits
ADD COLUMN outcome TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'type'
) THEN
ALTER TABLE public.visits
ADD COLUMN type TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'lat'
) THEN
ALTER TABLE public.visits
ADD COLUMN lat NUMERIC;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'visits'
        AND column_name = 'lng'
) THEN
ALTER TABLE public.visits
ADD COLUMN lng NUMERIC;
END IF;
END $$;
-- Migración: Ampliar CHECK constraint de status si la tabla ya existía
-- (DROP + ADD para actualizar constraint existente)
DO $$ BEGIN
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_status_check;
ALTER TABLE public.visits
ADD CONSTRAINT visits_status_check CHECK (
        status IN (
            'pending',
            'in_progress',
            'completed',
            'cancelled',
            'rescheduled',
            'scheduled'
        )
    );
EXCEPTION
WHEN OTHERS THEN NULL;
END $$;
-- Políticas Visits
DROP POLICY IF EXISTS "Users view own visits" ON visits;
CREATE POLICY "Users view own visits" ON visits FOR
SELECT USING (
        sales_rep_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Users create visits" ON visits;
CREATE POLICY "Users create visits" ON visits FOR
INSERT WITH CHECK (auth.uid() = sales_rep_id);
DROP POLICY IF EXISTS "Users update visits" ON visits;
CREATE POLICY "Users update visits" ON visits FOR
UPDATE USING (
        sales_rep_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Users delete visits" ON visits;
CREATE POLICY "Users delete visits" ON visits FOR DELETE USING (
    sales_rep_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
-- ------------------------------------------------------------------------------
-- 5.5 COTIZACIONES (QUOTATIONS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quotations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    folio INTEGER,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    seller_id UUID REFERENCES public.profiles(id),
    items JSONB DEFAULT '[]'::JSONB,
    total_amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'draft' CHECK (
        status IN ('draft', 'sent', 'approved', 'rejected')
    ),
    comments TEXT,
    payment_terms JSONB,
    interaction_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Sellers manage own quotations" ON quotations;
CREATE POLICY "Sellers manage own quotations" ON quotations FOR ALL USING (
    seller_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
-- ------------------------------------------------------------------------------
-- 5.6 UBICACIONES DE VENDEDORES (SELLER_LOCATIONS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seller_locations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    seller_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    quotation_id UUID REFERENCES public.quotations(id) ON DELETE CASCADE,
    lat NUMERIC NOT NULL,
    lng NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.seller_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public manage locations" ON seller_locations;
CREATE POLICY "Public manage locations" ON seller_locations FOR ALL USING (
    seller_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
-- ------------------------------------------------------------------------------
-- 6. ÓRDENES Y VENTAS (ORDERS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id),
    user_id UUID REFERENCES public.profiles(id),
    visit_id UUID REFERENCES public.visits(id),
    quotation_id UUID REFERENCES public.quotations(id),
    status TEXT DEFAULT 'completed' CHECK (
        status IN ('draft', 'pending', 'completed', 'cancelled')
    ),
    total_amount NUMERIC DEFAULT 0,
    notes TEXT,
    payment_method TEXT,
    interaction_type TEXT,
    delivery_status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- Migraciones Orders
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'quotation_id'
) THEN
ALTER TABLE public.orders
ADD COLUMN quotation_id UUID REFERENCES public.quotations(id);
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'interaction_type'
) THEN
ALTER TABLE public.orders
ADD COLUMN interaction_type TEXT;
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'delivery_status'
) THEN
ALTER TABLE public.orders
ADD COLUMN delivery_status TEXT;
END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.inventory(id),
    quantity INTEGER DEFAULT 1,
    unit_price NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
-- Políticas Orders
DROP POLICY IF EXISTS "View orders" ON orders;
CREATE POLICY "View orders" ON orders FOR
SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Create orders" ON orders;
CREATE POLICY "Create orders" ON orders FOR
INSERT WITH CHECK (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Update orders" ON orders;
CREATE POLICY "Update orders" ON orders FOR
UPDATE USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Delete orders" ON orders;
CREATE POLICY "Delete orders" ON orders FOR DELETE USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
DROP POLICY IF EXISTS "View items" ON order_items;
CREATE POLICY "View items" ON order_items FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM orders
            WHERE orders.id = order_items.order_id
                AND (
                    orders.user_id = auth.uid()
                    OR EXISTS (
                        SELECT 1
                        FROM profiles
                        WHERE id = auth.uid()
                            AND role IN ('manager', 'jefe', 'administrativo')
                    )
                )
        )
    );
-- ------------------------------------------------------------------------------
-- 7. LOGÍSTICA Y RUTAS (DELIVERY)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT,
    dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    driver_id UUID REFERENCES public.profiles(id) ON DELETE
    SET NULL,
        created_by UUID REFERENCES public.profiles(id),
        status route_status DEFAULT 'draft',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;
-- Migración: Añadir columna name si no existe
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'delivery_routes'
        AND column_name = 'name'
) THEN
ALTER TABLE public.delivery_routes
ADD COLUMN name TEXT;
END IF;
END $$;
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
DROP POLICY IF EXISTS "Managers all routes" ON delivery_routes;
CREATE POLICY "Managers all routes" ON delivery_routes FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
DROP POLICY IF EXISTS "Drivers view assigned" ON delivery_routes;
CREATE POLICY "Drivers view assigned" ON delivery_routes FOR
SELECT USING (driver_id = auth.uid());
DROP POLICY IF EXISTS "Drivers update status" ON delivery_routes;
CREATE POLICY "Drivers update status" ON delivery_routes FOR
UPDATE USING (driver_id = auth.uid());
DROP POLICY IF EXISTS "Managers all items" ON route_items;
CREATE POLICY "Managers all items" ON route_items FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
DROP POLICY IF EXISTS "Drivers view items" ON route_items;
CREATE POLICY "Drivers view items" ON route_items FOR
SELECT USING (
        EXISTS (
            SELECT 1
            FROM delivery_routes
            WHERE id = route_items.route_id
                AND driver_id = auth.uid()
        )
    );
DROP POLICY IF EXISTS "Drivers update items" ON route_items;
CREATE POLICY "Drivers update items" ON route_items FOR
UPDATE USING (
        EXISTS (
            SELECT 1
            FROM delivery_routes
            WHERE id = route_items.route_id
                AND driver_id = auth.uid()
        )
    );
-- ------------------------------------------------------------------------------
-- 8. REGISTROS DE LLAMADAS (CALL_LOGS)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT CHECK (
        status IN (
            'contestada',
            'no_contesto',
            'ocupado',
            'equivocado',
            'buzon',
            'iniciada'
        )
    ),
    interaction_type TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
-- Migraciones Call Logs
DO $$ BEGIN IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
        AND table_name = 'call_logs'
        AND column_name = 'interaction_type'
) THEN
ALTER TABLE public.call_logs
ADD COLUMN interaction_type TEXT;
END IF;
END $$;
-- Migración: Ampliar CHECK de status para incluir 'iniciada'
DO $$ BEGIN
ALTER TABLE public.call_logs DROP CONSTRAINT IF EXISTS call_logs_status_check;
ALTER TABLE public.call_logs
ADD CONSTRAINT call_logs_status_check CHECK (
        status IN (
            'contestada',
            'no_contesto',
            'ocupado',
            'equivocado',
            'buzon',
            'iniciada'
        )
    );
EXCEPTION
WHEN OTHERS THEN NULL;
END $$;
DROP POLICY IF EXISTS "View logs" ON call_logs;
CREATE POLICY "View logs" ON call_logs FOR
SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Insert logs" ON call_logs;
CREATE POLICY "Insert logs" ON call_logs FOR
INSERT WITH CHECK (auth.uid() = user_id);
-- ------------------------------------------------------------------------------
-- 9. REGISTROS DE CORREOS (EMAIL_LOGS) - NUEVA
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    subject TEXT,
    snippet TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View email logs" ON email_logs;
CREATE POLICY "View email logs" ON email_logs FOR
SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Insert email logs" ON email_logs;
CREATE POLICY "Insert email logs" ON email_logs FOR
INSERT WITH CHECK (auth.uid() = user_id);
-- ------------------------------------------------------------------------------
-- 10. METAS DE VENTAS (GOALS) - NUEVA
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_amount NUMERIC NOT NULL DEFAULT 0,
    commission_rate NUMERIC DEFAULT 0.01,
    month INTEGER NOT NULL CHECK (
        month BETWEEN 1 AND 12
    ),
    year INTEGER NOT NULL CHECK (year >= 2024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, month, year)
);
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View goals" ON goals;
CREATE POLICY "View goals" ON goals FOR
SELECT USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM profiles
            WHERE id = auth.uid()
                AND role IN ('manager', 'jefe', 'administrativo')
        )
    );
DROP POLICY IF EXISTS "Manage goals" ON goals;
CREATE POLICY "Manage goals" ON goals FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM profiles
        WHERE id = auth.uid()
            AND role IN ('manager', 'jefe', 'administrativo')
    )
);
DROP POLICY IF EXISTS "Users insert own goals" ON goals;
CREATE POLICY "Users insert own goals" ON goals FOR
INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own goals" ON goals;
CREATE POLICY "Users update own goals" ON goals FOR
UPDATE USING (auth.uid() = user_id);
-- ------------------------------------------------------------------------------
-- 11. CONFIGURACIÓN FINAL DE STORAGE (OPCIONAL)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-photos', 'evidence-photos', true) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Public Access Evidence" ON storage.objects;
CREATE POLICY "Public Access Evidence" ON storage.objects FOR
SELECT USING (bucket_id = 'evidence-photos');
DROP POLICY IF EXISTS "Drivers Upload Evidence" ON storage.objects;
CREATE POLICY "Drivers Upload Evidence" ON storage.objects FOR
INSERT WITH CHECK (
        bucket_id = 'evidence-photos'
        AND auth.role() = 'authenticated'
    );
-- ==============================================================================
-- FIN DEL SCRIPT - Todas las tablas sincronizadas con el frontend
-- ==============================================================================