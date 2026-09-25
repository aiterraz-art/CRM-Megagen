-- ADD FOLIO COLUMN TO ORDERS
-- The Driver App specifically requests 'folio', causing a crash if missing.

-- 1. Add folio column
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS folio TEXT;

-- 2. Backfill for existing orders (using first 8 chars of UUID)
UPDATE public.orders 
SET folio = substring(id::text from 1 for 8) 
WHERE folio IS NULL;

-- 3. Verify
SELECT id, folio FROM public.orders LIMIT 10;
