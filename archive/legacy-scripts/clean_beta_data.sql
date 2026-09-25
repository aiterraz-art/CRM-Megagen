-- Clean up data for Beta Launch (Safe Mode)
-- Deletes all transactional data but KEEPS Users and Inventory
-- Uses dynamic SQL to avoid errors if specific tables (like crm_tasks) do not exist.

DO $$
DECLARE
    tables TEXT[] := ARRAY[
        'visits', 
        'quotations', 
        'order_items', 
        'orders', 
        'route_items', 
        'delivery_routes', 
        'crm_tasks', 
        'tasks', -- Try both names
        'call_logs', 
        'email_logs', 
        'visual_evidence',
        'seller_locations',
        'clients'
    ];
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT UNNEST(tables) LOOP
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
            EXECUTE 'TRUNCATE TABLE ' || quote_ident(tbl) || ' CASCADE';
            RAISE NOTICE 'Truncated table: %', tbl;
        ELSE
            RAISE NOTICE 'Table not found (skipping): %', tbl;
        END IF;
    END LOOP;
END $$;
