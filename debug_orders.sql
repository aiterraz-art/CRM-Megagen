-- Check if orders exist and sum amounts
SELECT 
    count(*) as total_orders, 
    sum(total_amount) as total_sales,
    min(created_at) as first_order_date,
    max(created_at) as last_order_date
FROM orders;

-- Check latest 5 orders with details
SELECT id, user_id, total_amount, status, created_at 
FROM orders 
ORDER BY created_at DESC 
LIMIT 5;
