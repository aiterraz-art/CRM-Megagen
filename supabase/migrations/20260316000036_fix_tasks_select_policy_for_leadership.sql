DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;

CREATE POLICY "Users can view own tasks or leadership"
ON public.tasks
FOR SELECT
USING (
    auth.uid() = COALESCE(user_id, assigned_to)
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND lower(coalesce(p.role, '')) IN ('manager', 'jefe', 'administrativo', 'admin', 'supervisor')
    )
);
