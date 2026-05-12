CREATE OR REPLACE FUNCTION public.sync_dispatch_queue_from_route_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.order_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF lower(coalesce(NEW.status::text, '')) = 'delivered' THEN
        UPDATE public.dispatch_queue_items
        SET status = 'delivered',
            delivered_at = coalesce(NEW.delivered_at, now()),
            route_id = coalesce(NEW.route_id, route_id)
        WHERE order_id = NEW.order_id;
    END IF;

    RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
