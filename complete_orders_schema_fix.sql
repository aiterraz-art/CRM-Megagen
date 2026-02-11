-- COMPLETE ORDERS SCHEMA FOR DELIVERY
-- Adds all missing columns required by the Dispatch and Delivery modules

-- 1. Add route_id (Foreign Key to delivery_routes)
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS route_id UUID REFERENCES public.delivery_routes(id) ON DELETE SET NULL;

-- 2. Add delivery columns (for Driver App)
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT;

-- 3. Create index for route_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_route_id ON public.orders(route_id);

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'orders' 
AND column_name IN ('route_id', 'delivered_at', 'delivery_photo_url');
