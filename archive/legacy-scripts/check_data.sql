-- SCRIPT DE DIAGNÓSTICO
-- Ejecuta esto para ver si tus cotizaciones siguen ahí
SELECT id, folio, client_id, seller_id, total_amount, "comments"
FROM public.quotations
ORDER BY created_at DESC;
