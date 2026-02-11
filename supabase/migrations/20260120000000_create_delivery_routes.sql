-- Create delivery_routes table
CREATE TABLE IF NOT EXISTS public.delivery_routes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    driver_id UUID REFERENCES public.profiles(id),
    status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add route_id to orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.delivery_routes(id);

-- Enable RLS
ALTER TABLE public.delivery_routes ENABLE ROW LEVEL SECURITY;

-- Policies for delivery_routes
CREATE POLICY "Enable read access for all users" ON public.delivery_routes
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users" ON public.delivery_routes
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enable update for authenticated users" ON public.delivery_routes
    FOR UPDATE USING (auth.role() = 'authenticated');
