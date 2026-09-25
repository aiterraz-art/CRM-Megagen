-- Attempt to sync jmena if he exists in auth.users
-- This queries the auth.users table for the specific email and inserts into profiles
-- If the profile already exists, it forces the role to 'driver' and status to 'active'

INSERT INTO public.profiles (id, email, role, status, full_name)
SELECT 
    id, 
    email, 
    'driver', 
    'active', 
    'Juan Mena'
FROM auth.users 
WHERE email = 'jmena@3dental.cl'
ON CONFLICT (id) DO UPDATE
SET role = 'driver', status = 'active';

-- Output the result to verify
SELECT * FROM public.profiles WHERE email = 'jmena@3dental.cl';
