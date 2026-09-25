-- Add google_event_id to visits table to support 2-way sync
ALTER TABLE public.visits 
ADD COLUMN IF NOT EXISTS google_event_id text;

COMMENT ON COLUMN public.visits.google_event_id IS 'ID of the Google Calendar event for sync purposes';
