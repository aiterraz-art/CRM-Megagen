-- Add new columns to clients table if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'rut') THEN
        ALTER TABLE clients ADD COLUMN rut text;
        ALTER TABLE clients ADD CONSTRAINT clients_rut_key UNIQUE (rut);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'phone') THEN
        ALTER TABLE clients ADD COLUMN phone text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'email') THEN
        ALTER TABLE clients ADD COLUMN email text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'notes') THEN
        ALTER TABLE clients ADD COLUMN notes text;
    END IF;
END $$;

-- Create function to check client ownership
CREATE OR REPLACE FUNCTION check_client_ownership(check_rut text)
RETURNS TABLE (exists_already boolean, owner_name text) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        true,
        COALESCE(p.full_name, p.email)
    FROM clients c
    JOIN profiles p ON c.created_by = p.id
    WHERE c.rut = check_rut;
END;
$$;

-- Enable RLS on clients if not already enabled
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them cleanly
DROP POLICY IF EXISTS "Clients are viewable by everyone" ON clients;
DROP POLICY IF EXISTS "Users can insert their own clients" ON clients;
DROP POLICY IF EXISTS "Users can update their own clients" ON clients;
DROP POLICY IF EXISTS "Users can delete their own clients" ON clients;
DROP POLICY IF EXISTS "Admins can do everything on clients" ON clients;

-- RLS Policies
-- 1. Admins can do everything
CREATE POLICY "Admins can do everything on clients"
ON clients
FOR ALL
TO authenticated
USING (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
    and profiles.role = 'admin'
  )
);

-- 2. Sellers can view ONLY their own clients
CREATE POLICY "Sellers can view own clients"
ON clients
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid() OR 
  exists ( -- Or allow if they are admin (redundant but safe)
    select 1 from profiles
    where profiles.id = auth.uid()
    and profiles.role = 'admin'
  )
);

-- 3. Sellers can insert clients (ownership is checked via logic, but RLS allows insert)
CREATE POLICY "Sellers can insert clients"
ON clients
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
);

-- 4. Sellers can update OWN clients
CREATE POLICY "Sellers can update own clients"
ON clients
FOR UPDATE
TO authenticated
USING (created_by = auth.uid());

-- 5. Sellers can delete OWN clients
CREATE POLICY "Sellers can delete own clients"
ON clients
FOR DELETE
TO authenticated
USING (created_by = auth.uid());
