-- Los cursos se administran en inventario como productos vendibles sin stock.
-- Esto conserva su visibilidad en el catálogo y permite convertir pedidos con
-- stock 0, siguiendo la política ya usada por CURSO EXOCAD.
UPDATE public.inventory
SET
    category = 'Cursos',
    stock_qty = 0,
    min_stock_alert = 0,
    is_service_item = false,
    allow_sale_without_stock = true
WHERE sku IN (
    'CURSO-PRINTSIDE',
    'CURSO-ALINEADORES',
    'CURSO-EXOCAD',
    'CURSO-OXIDO-NITROSO',
    'CURSO-PROTESIS-TOTALES',
    'CURSO-ANTOFAGASTA',
    'CURSO-FULL-ARCH',
    'CURSO-MASTER-MEDIT'
)
   OR name = 'CURSO EXOCAD';

-- CURSO EXOCAD ya existía con el SKU CURSO y su precio configurado.
-- Se elimina solamente el duplicado recién creado si todavía no se ha usado.
DELETE FROM public.inventory AS duplicate_course
WHERE duplicate_course.sku = 'CURSO-EXOCAD'
  AND EXISTS (
      SELECT 1
      FROM public.inventory AS existing_course
      WHERE existing_course.sku = 'CURSO'
        AND existing_course.name = 'CURSO EXOCAD'
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.order_items AS item
      WHERE item.product_id = duplicate_course.id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.quotations AS quotation
      WHERE coalesce(quotation.items::text, '') LIKE '%' || duplicate_course.id::text || '%'
  );
