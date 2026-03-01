-- Production compatibility patch (run in each Supabase instance)
-- Date: 2026-02-26

-- 1) Profiles compatibility
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS supervisor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2) Whitelist compatibility (optional metadata used by admin UI)
ALTER TABLE public.user_whitelist
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3) Role permissions table used by UserContext/Settings
CREATE TABLE IF NOT EXISTS public.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL,
    permission TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(role, permission)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read role_permissions" ON public.role_permissions;
CREATE POLICY "Public read role_permissions"
ON public.role_permissions FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Managers can manage role_permissions" ON public.role_permissions;
CREATE POLICY "Managers can manage role_permissions"
ON public.role_permissions FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('manager', 'jefe')
    )
);

-- Seed base permissions (idempotent)
INSERT INTO public.role_permissions (role, permission) VALUES
('manager', 'UPLOAD_EXCEL'),
('manager', 'MANAGE_INVENTORY'),
('manager', 'MANAGE_PRICING'),
('manager', 'VIEW_METAS'),
('manager', 'MANAGE_METAS'),
('manager', 'MANAGE_DISPATCH'),
('manager', 'EXECUTE_DELIVERY'),
('manager', 'MANAGE_USERS'),
('manager', 'MANAGE_PERMISSIONS'),
('manager', 'VIEW_ALL_CLIENTS'),
('manager', 'MANAGE_CLIENTS'),
('manager', 'IMPORT_CLIENTS'),
('manager', 'VIEW_TEAM_STATS'),
('manager', 'VIEW_ALL_TEAM_STATS'),

('admin', 'UPLOAD_EXCEL'),
('admin', 'MANAGE_INVENTORY'),
('admin', 'MANAGE_PRICING'),
('admin', 'VIEW_METAS'),
('admin', 'MANAGE_METAS'),
('admin', 'MANAGE_DISPATCH'),
('admin', 'EXECUTE_DELIVERY'),
('admin', 'MANAGE_USERS'),
('admin', 'MANAGE_PERMISSIONS'),
('admin', 'VIEW_ALL_CLIENTS'),
('admin', 'MANAGE_CLIENTS'),
('admin', 'IMPORT_CLIENTS'),
('admin', 'VIEW_TEAM_STATS'),
('admin', 'VIEW_ALL_TEAM_STATS'),

('jefe', 'MANAGE_INVENTORY'),
('jefe', 'VIEW_METAS'),
('jefe', 'MANAGE_DISPATCH'),
('jefe', 'VIEW_ALL_CLIENTS'),
('jefe', 'VIEW_TEAM_STATS'),

('administrativo', 'UPLOAD_EXCEL'),
('administrativo', 'MANAGE_INVENTORY'),
('administrativo', 'MANAGE_PRICING'),
('administrativo', 'MANAGE_DISPATCH'),

('seller', 'VIEW_METAS'),
('driver', 'EXECUTE_DELIVERY')
ON CONFLICT (role, permission) DO NOTHING;

-- 4) Tasks compatibility (supports old/new frontend paths)
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_date TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'medium',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS due_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Backfill where possible
UPDATE public.tasks
SET user_id = assigned_to
WHERE user_id IS NULL AND assigned_to IS NOT NULL;

UPDATE public.tasks
SET assigned_to = user_id
WHERE assigned_to IS NULL AND user_id IS NOT NULL;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
CREATE POLICY "Users can view their own tasks"
ON public.tasks FOR SELECT
USING (auth.uid() = COALESCE(user_id, assigned_to));

DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
CREATE POLICY "Users can insert their own tasks"
ON public.tasks FOR INSERT
WITH CHECK (
    auth.uid() = COALESCE(user_id, assigned_to)
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('manager', 'jefe', 'administrativo')
    )
);

DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
CREATE POLICY "Users can update their own tasks"
ON public.tasks FOR UPDATE
USING (
    auth.uid() = COALESCE(user_id, assigned_to)
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('manager', 'jefe', 'administrativo')
    )
);

DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;
CREATE POLICY "Users can delete their own tasks"
ON public.tasks FOR DELETE
USING (
    auth.uid() = COALESCE(user_id, assigned_to)
    OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('manager', 'jefe', 'administrativo')
    )
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
