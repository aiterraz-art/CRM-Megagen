-- FORCE CREATE PROFILE FOR FTERRAZA
-- ID obtained from screenshot: 410e7b1c-2d3c-4cc7-b365-1f5ae784eef3

INSERT INTO public.profiles (id, email, role, status, full_name)
VALUES (
    '410e7b1c-2d3c-4cc7-b365-1f5ae784eef3', -- ID from Auth
    'fterraza@3dental.cl',
    'seller',    -- Initial role
    'pending',   -- Initial status
    'Fabiola Terraza'
)
ON CONFLICT (id) DO UPDATE
SET 
    email = EXCLUDED.email,
    status = 'pending',
    role = 'seller';

-- Verify immediately
SELECT * FROM public.profiles WHERE email = 'fterraza@3dental.cl';
