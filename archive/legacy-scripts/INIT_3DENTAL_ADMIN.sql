-- 1. Asegurar que el dominio 3dental.cl esté en la whitelist con rol manager
INSERT INTO user_whitelist (email, role)
VALUES ('aterraza@3dental.cl', 'manager') ON CONFLICT (email) DO
UPDATE
SET role = 'manager';
-- 2. (Opcional) Si el usuario ya se logueó pero entró como seller, forzar el rol en profiles
UPDATE profiles
SET role = 'manager',
    status = 'active'
WHERE email = 'aterraza@3dental.cl';