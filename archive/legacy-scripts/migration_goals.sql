-- Create goals table
create table if not exists public.goals (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references public.profiles(id) not null,
    month integer not null check (month >= 1 and month <= 12),
    year integer not null,
    target_amount numeric not null default 0,
    commission_rate numeric not null default 0, -- Stored as decimal (e.g., 0.05 for 5%)
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(user_id, month, year) -- Prevent duplicate goals for same user/period
);

-- Enable RLS
alter table public.goals enable row level security;

-- Policies for goals

-- Admins/Supervisors/Jefes can manage ALL goals
create policy "Admins can manage all goals"
    on public.goals
    for all
    using (
        exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
            and profiles.role in ('admin', 'supervisor', 'jefe')
        )
    );

-- Vendedores can VIEW their own goals
create policy "Users can view own goals"
    on public.goals
    for select
    using (
        user_id = auth.uid()
    );
