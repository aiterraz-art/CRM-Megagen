-- Add daily visits goal so admin/jefe can centrally configure seller visit targets.
ALTER TABLE IF EXISTS public.goals
ADD COLUMN IF NOT EXISTS daily_visits_goal integer NOT NULL DEFAULT 8;

-- Keep values sane.
ALTER TABLE IF EXISTS public.goals
DROP CONSTRAINT IF EXISTS goals_daily_visits_goal_positive;

ALTER TABLE IF EXISTS public.goals
ADD CONSTRAINT goals_daily_visits_goal_positive
CHECK (daily_visits_goal >= 0);
