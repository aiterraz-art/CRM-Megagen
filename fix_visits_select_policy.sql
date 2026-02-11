-- Ensure Users can SEE their own visits (Crucial for active visit banner)
DROP POLICY IF EXISTS "Users can view their own visits" ON public.visits;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.visits;

CREATE POLICY "Users can view their own visits" ON public.visits
    FOR SELECT
    USING (
        sales_rep_id = auth.uid() OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'jefe', 'supervisor'))
    );

-- Also ensure they can see visits they created if sales_rep_id might differ (rare but safe)
-- OR just generic read if desired, but better strict.
