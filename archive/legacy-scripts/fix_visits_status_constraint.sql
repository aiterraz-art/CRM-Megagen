-- Fix for relation "visits" violates check constraint "visits_status_check"
-- This script drops the restrictive constraint and adds a new one that allows 'scheduled'

-- 1. Drop the existing constraint if it exists
ALTER TABLE public.visits 
DROP CONSTRAINT IF EXISTS visits_status_check;

-- 2. Add the correct constraint allowing all necessary statuses
ALTER TABLE public.visits 
ADD CONSTRAINT visits_status_check 
CHECK (status IN ('scheduled', 'completed', 'cancelled', 'in_progress'));

-- 3. Ensure the title column exists (just in case)
ALTER TABLE public.visits 
ADD COLUMN IF NOT EXISTS title text;

-- 4. Comment on the column for clarity
COMMENT ON COLUMN public.visits.status IS 'Status of the visit: scheduled, completed, cancelled, in_progress';
