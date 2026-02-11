-- SYNC MISSING PROFILES
-- Run this if users signed up but don't check in the list (missing in public.profiles)

INSERT INTO public.profiles (id, email, role, status, full_name, created_at)
SELECT 
    au.id,
    au.email,
    'seller',    -- Default role
    'pending',   -- Default status (requires approval)
    COALESCE(au.raw_user_meta_data->>'full_name', au.email),
    au.created_at
FROM auth.users au
LEFT JOIN public.profiles pp ON pp.id = au.id
WHERE pp.id IS NULL;

-- Verify if fmorales appeared
SELECT * FROM public.profiles WHERE email LIKE '%fmorales%';
