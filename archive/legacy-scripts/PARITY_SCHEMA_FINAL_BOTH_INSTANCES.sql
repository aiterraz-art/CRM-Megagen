-- ============================================================================
-- PARITY_SCHEMA_FINAL_BOTH_INSTANCES.sql
-- Objetivo:
-- 1) Homologar tipos de coordenadas a double precision
-- 2) Homologar FKs de tasks con ON DELETE SET NULL
-- 3) Homologar FK de user_whitelist.created_by con ON DELETE SET NULL
--    y asegurar role NOT NULL DEFAULT 'seller'
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1) Coordenadas: normalizar tipos (double precision)
-- --------------------------------------------------------------------------
DO $$
DECLARE
    v_type text;
BEGIN
    -- clients.lat
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'clients'
          AND column_name = 'lat'
    ) THEN
        SELECT data_type INTO v_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'clients'
          AND column_name = 'lat';

        IF v_type <> 'double precision' THEN
            EXECUTE 'ALTER TABLE public.clients ALTER COLUMN lat TYPE double precision USING lat::double precision';
        END IF;
    END IF;

    -- clients.lng
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'clients'
          AND column_name = 'lng'
    ) THEN
        SELECT data_type INTO v_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'clients'
          AND column_name = 'lng';

        IF v_type <> 'double precision' THEN
            EXECUTE 'ALTER TABLE public.clients ALTER COLUMN lng TYPE double precision USING lng::double precision';
        END IF;
    END IF;

    -- visits.check_out_lat
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'visits'
          AND column_name = 'check_out_lat'
    ) THEN
        SELECT data_type INTO v_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'visits'
          AND column_name = 'check_out_lat';

        IF v_type <> 'double precision' THEN
            EXECUTE 'ALTER TABLE public.visits ALTER COLUMN check_out_lat TYPE double precision USING check_out_lat::double precision';
        END IF;
    END IF;

    -- visits.check_out_lng
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'visits'
          AND column_name = 'check_out_lng'
    ) THEN
        SELECT data_type INTO v_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'visits'
          AND column_name = 'check_out_lng';

        IF v_type <> 'double precision' THEN
            EXECUTE 'ALTER TABLE public.visits ALTER COLUMN check_out_lng TYPE double precision USING check_out_lng::double precision';
        END IF;
    END IF;
END $$;

-- --------------------------------------------------------------------------
-- 2) user_whitelist: FK created_by y role consistente
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.user_whitelist') IS NOT NULL THEN
        ALTER TABLE public.user_whitelist
            ADD COLUMN IF NOT EXISTS created_by uuid;

        ALTER TABLE public.user_whitelist
            DROP CONSTRAINT IF EXISTS user_whitelist_created_by_fkey;

        ALTER TABLE public.user_whitelist
            ADD CONSTRAINT user_whitelist_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

        ALTER TABLE public.user_whitelist
            ALTER COLUMN role SET DEFAULT 'seller';

        UPDATE public.user_whitelist
        SET role = 'seller'
        WHERE role IS NULL;

        ALTER TABLE public.user_whitelist
            ALTER COLUMN role SET NOT NULL;
    END IF;
END $$;

-- --------------------------------------------------------------------------
-- 3) tasks: FKs seguras y homogéneas (ON DELETE SET NULL)
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regclass('public.tasks') IS NOT NULL THEN
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_assigned_by_fkey;
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_assigned_to_fkey;
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_client_id_fkey;
        ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_user_id_fkey;

        ALTER TABLE public.tasks
            ADD CONSTRAINT tasks_assigned_by_fkey
            FOREIGN KEY (assigned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

        ALTER TABLE public.tasks
            ADD CONSTRAINT tasks_assigned_to_fkey
            FOREIGN KEY (assigned_to) REFERENCES public.profiles(id) ON DELETE SET NULL;

        ALTER TABLE public.tasks
            ADD CONSTRAINT tasks_client_id_fkey
            FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;

        ALTER TABLE public.tasks
            ADD CONSTRAINT tasks_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
    END IF;
END $$;

COMMIT;

