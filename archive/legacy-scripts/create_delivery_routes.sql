-- MODULE: DELIVERY ROUTES & DISPATCH
-- Creates tables to manage daily delivery routes assigned to drivers

-- 1. Create Status Enums (if they don't exist)
DO $$ BEGIN
    CREATE TYPE route_status AS ENUM ('draft', 'in_progress', 'completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE delivery_item_status AS ENUM ('pending', 'delivered', 'failed', 'rescheduled');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Create Delivery Routes Table
CREATE TABLE IF NOT EXISTS public.delivery_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    driver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.profiles(id),
    status route_status DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Create Route Items Table (Links Orders to Routes)
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

-- 4. Enable RLS
ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_items ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for Delivery Routes

-- Managers/Admins: Full Access
CREATE POLICY "Managers manage all routes"
ON public.delivery_routes
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND role IN ('manager', 'admin', 'supervisor')
    )
);

-- Drivers: View their own routes
CREATE POLICY "Drivers view assigned routes"
ON public.delivery_routes
FOR SELECT
TO authenticated
USING (
    driver_id = auth.uid()
);

-- Drivers: Update status of their own routes (e.g. start/complete)
CREATE POLICY "Drivers update their own route status"
ON public.delivery_routes
FOR UPDATE
TO authenticated
USING (
    driver_id = auth.uid()
);

-- 6. RLS Policies for Route Items

-- Managers/Admins: Full Access
CREATE POLICY "Managers manage all route items"
ON public.route_items
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() 
        AND role IN ('manager', 'admin', 'supervisor')
    )
);

-- Drivers: View items of their assigned routes
CREATE POLICY "Drivers view own route items"
ON public.route_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.delivery_routes
        WHERE id = public.route_items.route_id
        AND driver_id = auth.uid()
    )
);

-- Drivers: Update items (mark delivered, add photo)
CREATE POLICY "Drivers update own route items"
ON public.route_items
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.delivery_routes
        WHERE id = public.route_items.route_id
        AND driver_id = auth.uid()
    )
);

-- 7. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_delivery_routes_driver ON public.delivery_routes(driver_id);
CREATE INDEX IF NOT EXISTS idx_delivery_routes_date ON public.delivery_routes(dispatch_date);
CREATE INDEX IF NOT EXISTS idx_route_items_route ON public.route_items(route_id);
CREATE INDEX IF NOT EXISTS idx_route_items_order ON public.route_items(order_id);
