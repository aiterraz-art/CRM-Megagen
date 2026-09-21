-- Cursos comercializables de 3Dental.
-- Se modelan como servicios: no requieren stock ni generan movimientos de inventario
-- al convertir una cotización en pedido.
INSERT INTO public.inventory (
    id,
    sku,
    name,
    price,
    stock_qty,
    category,
    min_stock_alert,
    is_service_item,
    allow_sale_without_stock,
    created_at
)
VALUES
    (gen_random_uuid(), 'CURSO-PRINTSIDE', 'CURSO PRINTSIDE', 0, 0, 'Cursos', 0, true, true, timezone('utc', now())),
    (gen_random_uuid(), 'CURSO-ALINEADORES', 'CURSO DE ALINEADORES', 0, 0, 'Cursos', 0, true, true, timezone('utc', now())),
    (gen_random_uuid(), 'CURSO-EXOCAD', 'CURSO EXOCAD', 0, 0, 'Cursos', 0, true, true, timezone('utc', now())),
    (gen_random_uuid(), 'CURSO-OXIDO-NITROSO', 'CURSO OXIDO NITROSO', 0, 0, 'Cursos', 0, true, true, timezone('utc', now())),
    (gen_random_uuid(), 'CURSO-PROTESIS-TOTALES', 'CURSO PRÓTESIS TOTALES', 0, 0, 'Cursos', 0, true, true, timezone('utc', now())),
    (gen_random_uuid(), 'CURSO-ANTOFAGASTA', 'CURSO ANTOFAGASTA', 0, 0, 'Cursos', 0, true, true, timezone('utc', now())),
    (gen_random_uuid(), 'CURSO-FULL-ARCH', 'CURSO FULL ARCH', 0, 0, 'Cursos', 0, true, true, timezone('utc', now())),
    (gen_random_uuid(), 'CURSO-MASTER-MEDIT', 'CURSO MASTER MEDIT', 0, 0, 'Cursos', 0, true, true, timezone('utc', now()))
ON CONFLICT (sku)
DO UPDATE
SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    min_stock_alert = 0,
    is_service_item = true,
    allow_sale_without_stock = true,
    stock_qty = 0;
