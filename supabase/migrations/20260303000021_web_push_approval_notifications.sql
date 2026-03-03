-- Web push subscriptions for approval notifications (lockscreen/background support)

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_last_seen ON public.push_subscriptions(last_seen_at DESC);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Push subscriptions select own or manager" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions select own or manager"
ON public.push_subscriptions
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
  )
);

DROP POLICY IF EXISTS "Push subscriptions insert own" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions insert own"
ON public.push_subscriptions
FOR INSERT
WITH CHECK (
  auth.role() = 'authenticated'
  AND user_id = auth.uid()
);

DROP POLICY IF EXISTS "Push subscriptions update own" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions update own"
ON public.push_subscriptions
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Push subscriptions delete own or manager" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions delete own or manager"
ON public.push_subscriptions
FOR DELETE
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND lower(coalesce(p.role, '')) IN ('admin', 'jefe')
  )
);
