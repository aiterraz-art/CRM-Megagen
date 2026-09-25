-- INSPECT EXISTING ROUTES SCHEMA
-- Check columns of delivery_routes and orders to align with plan.

SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('delivery_routes', 'orders', 'route_items')
ORDER BY table_name, ordinal_position;
