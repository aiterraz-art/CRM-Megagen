-- Remove legacy "manager" role and consolidate it into "admin"

BEGIN;

-- 1) Data migration
UPDATE public.profiles
SET role = 'admin'
WHERE role = 'manager';

UPDATE public.user_whitelist
SET role = 'admin'
WHERE role = 'manager';

INSERT INTO public.role_permissions (role, permission)
SELECT 'admin', rp.permission
FROM public.role_permissions rp
WHERE rp.role = 'manager'
AND NOT EXISTS (
    SELECT 1
    FROM public.role_permissions ap
    WHERE ap.role = 'admin'
      AND ap.permission = rp.permission
);

DELETE FROM public.role_permissions
WHERE role = 'manager';

-- 2) app_role enum compatibility (if used in this instance)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_type t
            JOIN pg_enum e ON e.enumtypid = t.oid
            WHERE t.typname = 'app_role'
              AND e.enumlabel = 'admin'
        ) THEN
            ALTER TYPE app_role ADD VALUE 'admin';
        END IF;
    END IF;
END $$;

-- 3) Rebuild CHECK constraints for profiles.role (drop old role constraints with manager)
DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'profiles'
          AND con.contype = 'c'
          AND pg_get_constraintdef(con.oid) ILIKE '%role%manager%'
    LOOP
        EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'profiles'
          AND con.conname = 'profiles_role_check'
    ) THEN
        ALTER TABLE public.profiles
        ADD CONSTRAINT profiles_role_check
        CHECK (role IN ('admin', 'jefe', 'administrativo', 'seller', 'driver'));
    END IF;
END $$;

-- 4) Rebuild CHECK constraints for user_whitelist.role (if table exists)
DO $$
DECLARE
    c RECORD;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_whitelist'
    ) THEN
        FOR c IN
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
              AND rel.relname = 'user_whitelist'
              AND con.contype = 'c'
              AND pg_get_constraintdef(con.oid) ILIKE '%role%manager%'
        LOOP
            EXECUTE format('ALTER TABLE public.user_whitelist DROP CONSTRAINT %I', c.conname);
        END LOOP;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
              AND rel.relname = 'user_whitelist'
              AND con.conname = 'user_whitelist_role_check'
        ) THEN
            ALTER TABLE public.user_whitelist
            ADD CONSTRAINT user_whitelist_role_check
            CHECK (role IN ('admin', 'jefe', 'administrativo', 'seller', 'driver'));
        END IF;
    END IF;
END $$;

COMMIT;
