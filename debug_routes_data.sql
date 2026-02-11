-- DEBUG ROUTES DATA
-- Lists all routes and their items to verify references

SELECT 
    r.id as route_id, 
    r.name as route_name, 
    r.status as route_status, 
    r.driver_id, 
    p.email as driver_email,
    count(ri.id) as item_count
FROM public.delivery_routes r
LEFT JOIN public.profiles p ON r.driver_id = p.id
LEFT JOIN public.route_items ri ON r.id = ri.route_id
GROUP BY r.id, r.name, r.status, r.driver_id, p.email;

-- List all items for detail
SELECT 
    ri.id as item_id, 
    ri.route_id, 
    ri.status as item_status, 
    ri.order_id,
    o.delivery_status as order_delivery_status
FROM public.route_items ri
LEFT JOIN public.orders o ON ri.order_id = o.id;

-- Check specifically for the mock ID
SELECT * FROM public.delivery_routes WHERE driver_id = '33333333-3333-3333-3333-333333333333';
