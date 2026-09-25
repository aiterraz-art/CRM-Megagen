-- FORCE CREATE PROFILE FOR FMORALES
-- We have his ID from the screenshot: a54d96c7-2cf7-4f8e-aa93-4dfa119cfeb7

INSERT INTO public.profiles (id, email, role, status, full_name)
VALUES (
    'a54d96c7-2cf7-4f8e-aa93-4dfa119cfeb7', -- ID from Auth
    'fmorales@3dental.cl',
    'seller',    -- Initial role
    'pending',   -- Initial status (so you can approve him)
    'Felipe Morales'
)
ON CONFLICT (id) DO UPDATE
SET 
    email = EXCLUDED.email,
    status = 'pending',
    role = 'seller';

-- Verify immediately
SELECT * FROM public.profiles WHERE email = 'fmorales@3dental.cl';
