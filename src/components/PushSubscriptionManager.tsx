import { useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

export default function PushSubscriptionManager() {
    const { profile, realRole } = useUser();
    const initializedRef = useRef(false);
    const canReceivePush = realRole === 'admin' || realRole === 'jefe';

    useEffect(() => {
        if (!canReceivePush || !profile?.id) return;
        if (initializedRef.current) return;
        initializedRef.current = true;

        const init = async () => {
            try {
                if (!VAPID_PUBLIC_KEY) return;
                if (!('serviceWorker' in navigator) || !('PushManager' in window) || !window.isSecureContext) return;

                const registration = await navigator.serviceWorker.register('/sw.js');

                let permission = Notification.permission;
                if (permission === 'default') {
                    permission = await Notification.requestPermission();
                }
                if (permission !== 'granted') return;

                let subscription = await registration.pushManager.getSubscription();
                if (!subscription) {
                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource
                    });
                }

                const json = subscription.toJSON();
                const endpoint = json.endpoint;
                const p256dh = json.keys?.p256dh;
                const auth = json.keys?.auth;

                if (!endpoint || !p256dh || !auth) return;

                const payload = {
                    user_id: profile.id,
                    endpoint,
                    p256dh,
                    auth,
                    user_agent: navigator.userAgent,
                    last_seen_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                const { error: upsertError } = await supabase
                    .from('push_subscriptions')
                    .upsert(payload as any, { onConflict: 'endpoint' });

                if (upsertError) {
                    console.warn('No se pudo registrar suscripción push:', upsertError.message);
                }
            } catch (error: any) {
                console.warn('Push subscription setup error:', error?.message || error);
            }
        };

        init();
    }, [canReceivePush, profile?.id]);

    return null;
}
