-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Users can manage own tasks" ON tasks;

-- Create comprehensive policy
CREATE POLICY "Users can fully manage tasks" ON tasks
    FOR ALL
    USING (
        -- User manages their own tasks
        auth.uid() = user_id 
        OR 
        -- Admins/Supervisors manage ALL tasks
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'supervisor', 'jefe')
        )
    )
    WITH CHECK (
        -- User manages their own tasks
        auth.uid() = user_id 
        OR 
        -- Admins/Supervisors manage ALL tasks
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() 
            AND role IN ('admin', 'supervisor', 'jefe')
        )
    );
