-- 1. Create call_logs table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id),
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    interaction_type TEXT DEFAULT 'Llamada',
    status TEXT DEFAULT 'completada',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    notes TEXT
);

-- Enable RLS for call_logs
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- RLS for Insert (Allow users to insert their own logs)
DO $$ BEGIN
    CREATE POLICY "Users can insert their own call logs" ON public.call_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- RLS for Select (Allow users to see their own logs or Admins/Managers to see all)
DO $$ BEGIN
    CREATE POLICY "Users can view call logs" ON public.call_logs FOR SELECT USING (
        auth.uid() = user_id OR 
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'jefe'))
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- 2. Allow Managers/Admins to DELETE Clients
-- First, drop existing if simplistic or just add new one
DO $$ BEGIN
    CREATE POLICY "Managers can delete clients" ON public.clients FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'jefe'))
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


-- 3. Allow Deletion of Visits
-- Drop existing visit delete policies to be safe or ensure they cover these cases
DROP POLICY IF EXISTS "Users can delete their own visits" ON public.visits;
DROP POLICY IF EXISTS "Managers can delete any visit" ON public.visits;

CREATE POLICY "Users can delete their own visits" ON public.visits FOR DELETE USING (sales_rep_id = auth.uid());

CREATE POLICY "Managers can delete any visit" ON public.visits FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'manager', 'jefe'))
);
