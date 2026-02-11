-- FORCE CREATE MOCK DRIVER 'JUAN'
-- This inserts the mock user defined in UserContext.tsx into the database
-- so that he appears in the Dispatch dropdown and routes can be assigned to him.
-- ID: 33333333-3333-3333-3333-333333333333 (Must match UserContext.tsx)

INSERT INTO public.profiles (id, email, role, status, full_name, zone)
VALUES (
    '33333333-3333-3333-3333-333333333333', 
    'jmena@3dental.cl', 
    'driver', 
    'active', 
    'Juan Mena (Mock)',
    'Logística'
)
ON CONFLICT (id) DO UPDATE
SET role = 'driver', status = 'active', email = 'jmena@3dental.cl';

-- Verify
SELECT * FROM public.profiles WHERE id = '33333333-3333-3333-3333-333333333333';
