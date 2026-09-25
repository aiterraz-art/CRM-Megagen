-- Create email_logs table to track communication history
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    user_id UUID REFERENCES profiles(id),
    subject TEXT,
    snippet TEXT, -- Short preview of the message
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Users can see emails for their clients" ON email_logs;
CREATE POLICY "Users can see emails for their clients" ON email_logs FOR SELECT USING (
    -- Users can see logs if they own the client or are admins
    EXISTS (
        SELECT 1 FROM clients c 
        WHERE c.id = email_logs.client_id 
        AND (c.created_by = auth.uid() OR EXISTS (
            SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'jefe')
        ))
    )
);

DROP POLICY IF EXISTS "Users can insert email logs" ON email_logs;
CREATE POLICY "Users can insert email logs" ON email_logs FOR INSERT WITH CHECK (
    user_id = auth.uid()
);

-- Index for faster timeline lookups
CREATE INDEX IF NOT EXISTS idx_email_logs_client_id ON email_logs(client_id);
