-- Add status and title to visits for scheduling
ALTER TABLE public.visits 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed',
ADD COLUMN IF NOT EXISTS title text;

-- Update existing visits to have 'completed' status
UPDATE public.visits SET status = 'completed' WHERE status IS NULL;

-- Index for faster querying by status
CREATE INDEX IF NOT EXISTS idx_visits_status ON public.visits(status);
