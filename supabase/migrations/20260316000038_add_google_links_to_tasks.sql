ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS google_event_id TEXT,
ADD COLUMN IF NOT EXISTS google_calendar_id TEXT,
ADD COLUMN IF NOT EXISTS google_html_link TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_google_event_id
ON public.tasks (google_event_id)
WHERE google_event_id IS NOT NULL;
