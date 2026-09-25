-- Create a 'driver' role if it doesn't exist (using mapping or just text in profile)
-- We will just insert orders for now.

-- 1. Insert Mock Clients with Geolocation
WITH new_clients AS (
    INSERT INTO public.clients (name, rut, address, city, comuna, phone, lat, lng) VALUES
    ('Clínica Dental Santiago Centro', '76.111.111-1', 'Alameda 1234', 'Santiago', 'Santiago', '+56911111111', -33.4430, -70.6530),
    ('Odontología Providencia', '76.222.222-2', 'Av. Providencia 2000', 'Santiago', 'Providencia', '+56922222222', -33.4260, -70.6120),
    ('Centro Médico Las Condes', '76.333.333-3', 'Av. Apoquindo 4000', 'Santiago', 'Las Condes', '+56933333333', -33.4140, -70.5850),
    ('Dental Vitacura', '76.444.444-4', 'Av. Vitacura 5000', 'Santiago', 'Vitacura', '+56944444444', -33.3980, -70.5700),
    ('Ortodoncia Ñuñoa', '76.555.555-5', 'Irarrázaval 3000', 'Santiago', 'Ñuñoa', '+56955555555', -33.4550, -70.6000),
    ('Sonrisas La Reina', '76.666.666-6', 'Av. Ossa 1000', 'Santiago', 'La Reina', '+56966666666', -33.4400, -70.5600),
    ('Implantes Recoleta', '76.777.777-7', 'Av. Recoleta 2500', 'Santiago', 'Recoleta', '+56977777777', -33.4000, -70.6400),
    ('Frenillos Independencia', '76.888.888-8', 'Independencia 1500', 'Santiago', 'Independencia', '+56988888888', -33.4100, -70.6550),
    ('Estética Huechuraba', '76.999.999-9', 'Pedro Fontova 7000', 'Santiago', 'Huechuraba', '+56999999999', -33.3600, -70.6600),
    ('Salud Oral Quilicura', '76.000.000-0', 'O Higgins 400', 'Santiago', 'Quilicura', '+56900000000', -33.3600, -70.7300)
    ON CONFLICT (rut) DO UPDATE 
    SET lat = EXCLUDED.lat, lng = EXCLUDED.lng -- Update coords if exists
    RETURNING id, rut
)

-- 2. Insert Orders for these clients
INSERT INTO public.orders (client_id, user_id, status, total_amount, folio, delivery_status, created_at)
SELECT 
    c.id, 
    (SELECT id FROM auth.users LIMIT 1), -- Assign to first found user
    'approved', 
    floor(random() * 500000 + 50000), -- Random amount
    floor(random() * 1000 + 10000), -- Random Folio
    'pending', -- Start as pending
    NOW()
FROM new_clients c;

-- 3. Ensure 'driver' role support involves checking if we need a specific row in a roles table or if it's just a string in profiles. 
-- Assuming profiles table exists and we can manually check this.
