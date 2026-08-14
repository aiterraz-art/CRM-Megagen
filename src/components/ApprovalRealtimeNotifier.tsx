import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { AUTO_REFRESH_ENABLED } from '../utils/runtimeFlags';

type ApprovalToast = {
    id: string;
    title: string;
    message: string;
    targetPath: string;
};

export default function ApprovalRealtimeNotifier() {
    const navigate = useNavigate();
    const { profile, realRole } = useUser();
    const [toasts, setToasts] = useState<ApprovalToast[]>([]);
    const seenIdsRef = useRef<Set<string>>(new Set());

    const canReceivePendingRequests = realRole === 'admin' || realRole === 'jefe';
    const canReceiveDiscountResolution = realRole === 'seller';
    const canReceive = canReceivePendingRequests || canReceiveDiscountResolution;

    useEffect(() => {
        if (!canReceive || !profile?.id || !AUTO_REFRESH_ENABLED) return;

        const channel = supabase
            .channel(`approval-realtime-${profile.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'approval_requests',
                    filter: 'status=eq.pending'
                },
                async (payload: any) => {
                    const approval = payload?.new;
                    if (!approval?.id || seenIdsRef.current.has(approval.id)) return;

                    seenIdsRef.current.add(approval.id);
                    if (seenIdsRef.current.size > 100) {
                        const firstSeen = seenIdsRef.current.values().next().value;
                        if (firstSeen) seenIdsRef.current.delete(firstSeen);
                    }

                    let sellerName = 'Vendedor';
                    let clientName = 'Cliente';

                    if (approval?.requester_id) {
                        const { data: seller } = await supabase
                            .from('profiles')
                            .select('full_name, email')
                            .eq('id', approval.requester_id)
                            .maybeSingle();
                        sellerName = seller?.full_name || seller?.email?.split('@')[0] || sellerName;
                    }

                    if (approval?.entity_id) {
                        const { data: quotation } = await supabase
                            .from('quotations')
                            .select('clients(name)')
                            .eq('id', approval.entity_id)
                            .maybeSingle();
                        const joinedClient = Array.isArray(quotation?.clients) ? quotation.clients[0] : quotation?.clients;
                        clientName = joinedClient?.name || clientName;
                    }

                    const title = 'Nueva solicitud de aprobación';
                    const message = `${sellerName} solicita aprobación para ${clientName}.`;

                    if (!canReceivePendingRequests) return;

                    setToasts((prev) => [{ id: `${approval.id}:pending`, title, message, targetPath: '/operations' }, ...prev].slice(0, 3));
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'approval_requests',
                },
                async (payload: any) => {
                    const approval = payload?.new;
                    const previousApproval = payload?.old;
                    if (!approval?.id) return;
                    if (approval.approval_type !== 'extra_discount') return;
                    if (!['approved', 'rejected'].includes(String(approval.status || '').toLowerCase())) return;
                    if (previousApproval?.status === approval.status) return;

                    const toastKey = `${approval.id}:${approval.status}`;
                    if (seenIdsRef.current.has(toastKey)) return;

                    seenIdsRef.current.add(toastKey);
                    if (seenIdsRef.current.size > 100) {
                        const firstSeen = seenIdsRef.current.values().next().value;
                        if (firstSeen) seenIdsRef.current.delete(firstSeen);
                    }

                    let clientName = 'Cliente';
                    let quotationFolio: number | string = '-';
                    let resolvedSellerId: string | null = null;
                    let resolvedSellerEmail = '';

                    if (approval?.entity_id) {
                        const { data: quotation } = await supabase
                            .from('quotations')
                            .select('folio, seller_id, seller_email_snapshot, clients(name)')
                            .eq('id', approval.entity_id)
                            .maybeSingle();
                        const joinedClient = Array.isArray(quotation?.clients) ? quotation.clients[0] : quotation?.clients;
                        clientName = joinedClient?.name || clientName;
                        quotationFolio = quotation?.folio || '-';
                        resolvedSellerId = (quotation as any)?.seller_id || null;
                        resolvedSellerEmail = String((quotation as any)?.seller_email_snapshot || '').trim().toLowerCase();
                    }

                    if (!canReceiveDiscountResolution) return;
                    const profileEmail = String(profile?.email || '').trim().toLowerCase();
                    const matchesSeller = Boolean(
                        (resolvedSellerId && resolvedSellerId === profile.id)
                        || (!resolvedSellerId && approval.requester_id === profile.id)
                        || (resolvedSellerEmail && resolvedSellerEmail === profileEmail)
                    );
                    if (!matchesSeller) return;

                    setToasts((prev) => [{
                        id: toastKey,
                        title: approval.status === 'approved' ? 'Descuento aprobado' : 'Descuento rechazado',
                        message: approval.status === 'approved'
                            ? `Tu solicitud de descuento para ${clientName} en la cotización #${quotationFolio} fue aprobada. Ya puedes generar el pedido.`
                            : `Tu solicitud de descuento para ${clientName} en la cotización #${quotationFolio} fue rechazada.`,
                        targetPath: '/quotations'
                    }, ...prev].slice(0, 3));
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [canReceive, navigate, profile?.id]);

    useEffect(() => {
        if (toasts.length === 0) return;
        const timeout = window.setTimeout(() => {
            setToasts((prev) => prev.slice(0, -1));
        }, 10000);
        return () => window.clearTimeout(timeout);
    }, [toasts]);

    if (!canReceive || toasts.length === 0) return null;

    return (
        <div className="fixed right-4 top-4 z-[120] space-y-3 w-[calc(100%-2rem)] max-w-sm">
            {toasts.map((toast) => (
                <button
                    key={toast.id}
                    onClick={() => navigate(toast.targetPath)}
                    className="w-full text-left rounded-2xl border border-indigo-100 bg-white shadow-xl p-4 hover:bg-indigo-50 transition-colors"
                >
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                            <BellRing size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-black text-gray-900">{toast.title}</p>
                            <p className="text-xs text-gray-600 mt-1">{toast.message}</p>
                        </div>
                    </div>
                </button>
            ))}
        </div>
    );
}
