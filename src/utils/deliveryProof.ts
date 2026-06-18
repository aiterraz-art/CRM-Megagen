import { supabase } from '../services/supabase';

type DeliveryOrderLike = {
    id: string;
    route_item_id?: string | null;
    route_id?: string | null;
};

type DeliveryPosition = {
    lat: number;
    lng: number;
};

export const completeDeliveryProof = async ({
    order,
    photoFile,
    deliveryPosition,
    bucket,
}: {
    order: DeliveryOrderLike;
    photoFile: File;
    deliveryPosition: DeliveryPosition;
    bucket: string;
}) => {
    const deliveredAtIso = new Date().toISOString();

    const fileExt = photoFile.name.split('.').pop() || 'jpg';
    const fileName = `${order.id}_${Date.now()}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, photoFile);

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

    const { error: updateError } = await supabase
        .from('orders')
        .update({
            delivery_status: 'delivered',
            delivered_at: deliveredAtIso,
            delivery_photo_url: publicUrl,
            delivered_lat: deliveryPosition.lat,
            delivered_lng: deliveryPosition.lng,
        })
        .eq('id', order.id);

    if (updateError) throw updateError;

    let routeItemUpdate: any = supabase
        .from('route_items')
        .update({
            status: 'delivered',
            delivered_at: deliveredAtIso,
            proof_photo_url: publicUrl,
            delivered_lat: deliveryPosition.lat,
            delivered_lng: deliveryPosition.lng,
        });

    if (order.route_item_id) {
        routeItemUpdate = routeItemUpdate.eq('id', order.route_item_id);
    } else {
        routeItemUpdate = routeItemUpdate.eq('order_id', order.id);
        if (order.route_id) {
            routeItemUpdate = routeItemUpdate.eq('route_id', order.route_id);
        }
    }

    const { error: itemError } = await routeItemUpdate;
    if (itemError) console.warn('Could not update route_item status:', itemError);

    if (order.route_id) {
        const { count: remainingItems, error: remainingError } = await supabase
            .from('route_items')
            .select('id', { count: 'exact', head: true })
            .eq('route_id', order.route_id)
            .in('status', ['pending', 'rescheduled', 'failed']);

        if (remainingError) {
            console.warn('Could not validate remaining items:', remainingError);
        } else if ((remainingItems || 0) === 0) {
            const { error: routeCloseError } = await supabase
                .from('delivery_routes')
                .update({ status: 'completed' })
                .eq('id', order.route_id)
                .neq('status', 'completed');

            if (routeCloseError) {
                console.warn('Could not close route automatically:', routeCloseError);
            }
        }
    }

    supabase.functions.invoke('send-delivery-notification', {
        body: { order_id: order.id }
    }).then(({ error }) => {
        if (error) console.error('Error sending email:', error);
        else console.log('Email notification sent successfully.');
    });

    return {
        deliveredAtIso,
        filePath,
        publicUrl,
    };
};
