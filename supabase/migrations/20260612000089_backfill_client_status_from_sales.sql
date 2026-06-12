UPDATE public.clients c
SET status = 'active'
WHERE (
    c.status = 'prospect'
    OR c.status LIKE 'prospect\_%' ESCAPE '\'
)
AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.client_id = c.id
);

UPDATE public.clients c
SET status = 'prospect_evaluating'
WHERE (
    c.status = 'prospect'
    OR c.status = 'prospect_new'
    OR c.status = 'prospect_contacted'
)
AND NOT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.client_id = c.id
)
AND EXISTS (
    SELECT 1
    FROM public.quotations q
    WHERE q.client_id = c.id
);

NOTIFY pgrst, 'reload schema';
