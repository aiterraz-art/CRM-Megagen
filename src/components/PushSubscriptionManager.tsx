import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';

const FALLBACK_VAPID_PUBLIC_KEY = 'BDWGbkdR0Pri6FW4pzYeM1T3NOwKBwN87c4gpgx7Us-X1LnIBBk0e1z1Px9tQA5LRGEi5EIFuCprleT2DQOvl2o';
const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || FALLBACK_VAPID_PUBLIC_KEY;

type PushState = 'idle' | 'prompt' | 'subscribing' | 'blocked' | 'unsupported' | 'needs_install' | 'ready' | 'error';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}

const isIosDevice = () => {
    const ua = window.navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

const isStandaloneMode = () =>
    window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

export default function PushSubscriptionManager() {
    const { profile, realRole } = useUser();
    const initializedRef = useRef(false);
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
    const [pushState, setPushState] = useState<PushState>('idle');
    const [message, setMessage] = useState('');
    const [dismissed, setDismissed] = useState(false);
    const canReceivePush = Boolean(profile?.id && realRole);

    const environmentState = useMemo(() => {
        const hasBrowserSupport =
            typeof window !== 'undefined' &&
            'serviceWorker' in navigator &&
            'Notification' in window &&
            'PushManager' in window &&
            window.isSecureContext;

        if (!VAPID_PUBLIC_KEY) {
            return { supported: false, state: 'unsupported' as PushState, message: 'Notificaciones push no configuradas.' };
        }

        if (hasBrowserSupport) {
            return { supported: true, state: 'idle' as PushState, message: '' };
        }

        if (isIosDevice() && !isStandaloneMode()) {
            return {
                supported: false,
                state: 'needs_install' as PushState,
                message: 'En iPhone debes agregar esta web a Pantalla de Inicio para activar notificaciones.',
            };
        }

        return {
            supported: false,
            state: 'unsupported' as PushState,
            message: 'Este navegador no permite notificaciones push en este modo.',
        };
    }, []);

    const upsertSubscription = async (subscription: PushSubscription) => {
        const json = subscription.toJSON();
        const endpoint = json.endpoint;
        const p256dh = json.keys?.p256dh;
        const auth = json.keys?.auth;

        if (!profile?.id || !endpoint || !p256dh || !auth) {
            throw new Error('Suscripción push incompleta');
        }

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
            throw upsertError;
        }
    };

    const syncSubscription = async (requestPermissionOnDemand = false) => {
        if (!canReceivePush || !profile?.id) return;

        if (!environmentState.supported) {
            setPushState(environmentState.state);
            setMessage(environmentState.message);
            return;
        }

        try {
            const registration = registrationRef.current || await navigator.serviceWorker.register('/sw.js');
            registrationRef.current = registration;

            let permission = Notification.permission;
            if (requestPermissionOnDemand && permission === 'default') {
                setPushState('subscribing');
                permission = await Notification.requestPermission();
            }

            if (permission === 'denied') {
                setPushState('blocked');
                setMessage('Las notificaciones están bloqueadas en el navegador. Debes habilitarlas en los ajustes del sitio.');
                return;
            }

            if (permission !== 'granted') {
                setPushState(isIosDevice() && !isStandaloneMode() ? 'needs_install' : 'prompt');
                setMessage(
                    isIosDevice() && !isStandaloneMode()
                        ? 'Instala la app en Pantalla de Inicio y luego activa las notificaciones.'
                        : 'Activa las notificaciones para recibir aprobaciones en segundo plano.'
                );
                return;
            }

            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                setPushState('subscribing');
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource
                });
            }

            await upsertSubscription(subscription);
            setPushState('ready');
            setMessage('');
            setDismissed(true);
        } catch (error: any) {
            console.warn('Push subscription setup error:', error?.message || error);
            setPushState('error');
            setMessage(error?.message || 'No se pudo activar notificaciones push.');
        }
    };

    useEffect(() => {
        if (!canReceivePush || !profile?.id) return;
        if (initializedRef.current) return;
        initializedRef.current = true;
        void syncSubscription(false);
    }, [canReceivePush, profile?.id]);

    if (!canReceivePush || !profile?.id || dismissed || pushState === 'ready' || pushState === 'idle') {
        return null;
    }

    const showActionButton = pushState === 'prompt' || pushState === 'error' || pushState === 'subscribing';

    return (
        <div className="fixed bottom-4 left-4 right-4 z-[120] lg:left-auto lg:right-6 lg:w-[380px]">
            <div className="rounded-3xl bg-white/95 backdrop-blur-xl border border-gray-200 shadow-2xl p-4">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <Bell size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-black text-gray-900">Notificaciones push</p>
                                <p className="text-xs text-gray-500 font-medium mt-1">
                                    {message || 'Activa avisos en segundo plano para aprobaciones y alertas.'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDismissed(true)}
                                className="p-1.5 rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                                aria-label="Cerrar aviso de notificaciones"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {showActionButton && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => void syncSubscription(true)}
                                    disabled={pushState === 'subscribing'}
                                    className="px-4 py-2 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-colors"
                                >
                                    {pushState === 'subscribing' ? 'Activando...' : 'Activar'}
                                </button>
                            </div>
                        )}

                        {pushState === 'needs_install' && (
                            <p className="mt-4 text-[11px] text-amber-700 font-bold">
                                En iPhone abre compartir y usa `Añadir a Pantalla de Inicio`.
                            </p>
                        )}

                        {pushState === 'blocked' && (
                            <p className="mt-4 text-[11px] text-rose-600 font-bold">
                                El permiso fue bloqueado. Debes reactivarlo desde los ajustes del navegador o de la app instalada.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
