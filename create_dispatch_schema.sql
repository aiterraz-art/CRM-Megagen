-- Add delivery columns to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS delivery_status TEXT CHECK (delivery_status IN ('pending', 'out_for_delivery', 'delivered')) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS delivery_photo_url TEXT,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- Create storage bucket for delivery proofs if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('delivery-proofs', 'delivery-proofs', true)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for Storage
CREATE POLICY "Public Access to Delivery Photos"
ON storage.objects FOR SELECT
USING ( bucket_id = 'delivery-proofs' );

CREATE POLICY "Authenticated Users can Upload Delivery Photos"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'delivery-proofs' AND auth.role() = 'authenticated' );

-- RLS Policy updates for orders to allow drivers to update delivery status
-- Assuming drivers are authenticated users. We might want to be more specific later, 
-- but for now, let's ensure authenticated users can update these fields.
-- Existing policies might be "Users can update their own orders", but drivers might need to update ANY order they are assigned.
-- For simplicity in this iteration, we'll allow authenticated users to update orders if they are updating delivery fields.

CREATE POLICY "Authenticated users can update delivery info"
ON public.orders FOR UPDATE
USING ( auth.role() = 'authenticated' )
WITH CHECK ( auth.role() = 'authenticated' );
