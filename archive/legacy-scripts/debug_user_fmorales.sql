-- DIAGNOSTIC SCRIPT: Check fmorales status
-- Run this to see where the user is (or isn't)

-- 1. Check if he exists in the Auth system (Signed Up)
SELECT 'AUTH SYSTEM' as check_type, id, email, created_at, last_sign_in_at 
FROM auth.users 
WHERE email = 'fmorales@3dental.cl';

-- 2. Check if he exists in the Public Profiles table
SELECT 'PUBLIC PROFILE' as check_type, id, email, role, status
FROM public.profiles 
WHERE email = 'fmorales@3dental.cl';

-- 3. Check TOTAL counts to see if listing is truncated
SELECT 'COUNTS' as check_type, 
    (SELECT count(*) FROM auth.users) as total_auth_users,
    (SELECT count(*) FROM public.profiles) as total_profiles;
