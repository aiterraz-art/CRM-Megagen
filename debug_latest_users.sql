-- CHECK LATEST REGISTRATIONS
-- Use this to see WHO has actually signed up recently.
-- Often users sign up with a personal Gmail instead of the corporate one by mistake.

SELECT 
    id, 
    email, 
    raw_user_meta_data->>'full_name' as full_name, 
    created_at, 
    last_sign_in_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 10;
