-- FIX: Ensure 'jmena@3dental.cl' has the 'driver' role
-- This is necessary for him to appear in the Dispatch dropdown.

UPDATE public.profiles
SET role = 'driver'
WHERE email = 'jmena@3dental.cl';

-- Verify (user can check output)
SELECT * FROM public.profiles WHERE email = 'jmena@3dental.cl';
