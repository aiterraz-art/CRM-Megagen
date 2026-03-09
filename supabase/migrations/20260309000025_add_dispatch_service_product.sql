-- Adds a canonical dispatch service product for quotations.
-- Sellers can set this product's price manually in the UI.

INSERT INTO public.inventory (
    name,
    sku,
    description,
    price,
    stock_qty,
    category,
    min_stock_alert
)
VALUES (
    'SERVICIO DE DESPACHO',
    'SERV-DESPACHO',
    'Servicio logístico de despacho al cliente.',
    0,
    1000000,
    'Servicios',
    0
)
ON CONFLICT (sku)
DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    min_stock_alert = EXCLUDED.min_stock_alert,
    stock_qty = GREATEST(COALESCE(inventory.stock_qty, 0), EXCLUDED.stock_qty);

