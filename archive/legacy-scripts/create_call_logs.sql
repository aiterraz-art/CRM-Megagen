-- Create call_logs table
CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT CHECK (status IN ('contestada', 'no_contesto', 'ocupado', 'equivocado', 'buzon')),
    notes TEXT
);

-- Enable RLS
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can insert their own call logs"
    ON public.call_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view call logs for clients they have access to"
    ON public.call_logs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.clients c
            WHERE c.id = call_logs.client_id
            -- Add logic here if clients have specific access rules, otherwise generally users can see logs if they can see the client
            -- For simplicity, if they can see the client (which usually means they own it or are admin), they can see the logs.
            -- A simpler approach if we trust client access:
            -- auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'jefe'))
        )
    );

-- Simpler policy matching email_logs pattern:
-- Users can see logs if they created them OR if they are admin/jefe
CREATE POLICY "Users can view their own or all if admin"
    ON public.call_logs FOR SELECT
    USING (
        auth.uid() = user_id 
        OR 
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'jefe')
        )
    );
