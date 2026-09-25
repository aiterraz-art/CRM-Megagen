-- Global Fix for User Deletion Cascade (Final Robust)
-- This script safely attempts to update foreign keys on all major tables.

BEGIN;

-- 1. Fix Orders (Confirmed: user_id)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_user_id_fkey;
ALTER TABLE orders 
    ADD CONSTRAINT orders_user_id_fkey 
    FOREIGN KEY (user_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- 2. Fix Visits (Confirmed: sales_rep_id)
ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_sales_rep_id_fkey;
ALTER TABLE visits 
    ADD CONSTRAINT visits_sales_rep_id_fkey 
    FOREIGN KEY (sales_rep_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- 3. Fix Quotations (Confirmed: seller_id)
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_seller_id_fkey;
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_created_by_fkey;
ALTER TABLE quotations 
    ADD CONSTRAINT quotations_seller_id_fkey 
    FOREIGN KEY (seller_id) 
    REFERENCES profiles(id) 
    ON DELETE CASCADE;

-- 4. Fix CRM Tasks / Tasks (Handle both possibilities safely)
DO $$
BEGIN
    -- Check if 'crm_tasks' exists
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'crm_tasks') THEN
        ALTER TABLE crm_tasks DROP CONSTRAINT IF EXISTS crm_tasks_assigned_to_fkey;
        ALTER TABLE crm_tasks 
            ADD CONSTRAINT crm_tasks_assigned_to_fkey 
            FOREIGN KEY (assigned_to) 
            REFERENCES profiles(id) 
            ON DELETE CASCADE;
    END IF;

    -- Check if 'tasks' exists (as fallback or alternative)
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tasks') THEN
        ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_user_id_fkey;
        ALTER TABLE tasks 
            ADD CONSTRAINT tasks_user_id_fkey 
            FOREIGN KEY (user_id) 
            REFERENCES profiles(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

COMMIT;
