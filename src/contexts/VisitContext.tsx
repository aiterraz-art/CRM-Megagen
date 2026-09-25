import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { checkGPSConnection } from '../utils/gps';
import { Database } from '../types/supabase';
import { useUser } from './UserContext';
import { queueVisitCheckoutLocation } from '../services/locationQueue';
import { AUTO_REFRESH_ENABLED } from '../utils/runtimeFlags';
import { getVirtualChannelLabel, getVirtualOutcomeLabel, isVirtualVisit, VIRTUAL_VISIT_TYPE, VirtualChannel, VirtualCheckoutDetails } from '../utils/virtualVisits';

type Visit = Database['public']['Tables']['visits']['Row'];

interface VisitContextType {
    activeVisit: Visit | null;
    loading: boolean;
    startVisit: (clientId: string, options?: { type?: string; channel?: VirtualChannel }) => Promise<Visit | null>;
    endVisit: (options?: { notes?: string; virtual?: VirtualCheckoutDetails }) => Promise<boolean>;
}

const VisitContext = createContext<VisitContextType | undefined>(undefined);

export const VisitProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { profile } = useUser();
    const [activeVisit, setActiveVisit] = useState<Visit | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchActiveVisit = async () => {
            if (!profile?.id) {
                setLoading(false);
                return;
            }

            try {
                // Find most recent in_progress visit for this sales rep
                const { data, error } = await supabase
                    .from('visits')
                    .select('*')
                    .eq('sales_rep_id', profile.id)
                    .eq('status', 'in_progress')
                    .order('check_in_time', { ascending: false })
                    .limit(1)
                    .single();

                if (data) {
                    setActiveVisit(data);
                } else if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned" which is fine
                    console.error("Error fetching active visit:", error);
                    setActiveVisit(null);
                } else {
                    setActiveVisit(null);
                }
            } catch (err) {
                console.error("Unexpected error fetching active visit:", err);
                setActiveVisit(null);
            } finally {
                setLoading(false);
            }
        };

        fetchActiveVisit();

        // REALTIME SYNC: Listen for changes in the visits table for this rep
        if (!profile?.id || !AUTO_REFRESH_ENABLED) return;

        const channel = supabase
            .channel(`active-visit-${profile.id}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'visits',
                    filter: `sales_rep_id=eq.${profile.id}`
                },
                (payload) => {
                    console.log("Visit Realtime Change:", payload);

                    // If a visit was updated/deleted and it matches our active visit, or status changed
                    if (payload.eventType === 'UPDATE') {
                        const updatedVisit = payload.new as Visit;
                        if (updatedVisit.status === 'completed' || updatedVisit.status === 'cancelled') {
                            // If the visit we're tracking was just closed, clear it
                            setActiveVisit(prev => (prev?.id === updatedVisit.id ? null : prev));
                        } else if (updatedVisit.status === 'in_progress') {
                            // If an in_progress visit was updated, or a new one appeared (unlikely on update but safe)
                            setActiveVisit(updatedVisit);
                        }
                    } else if (payload.eventType === 'INSERT') {
                        const newVisit = payload.new as Visit;
                        if (newVisit.status === 'in_progress') {
                            setActiveVisit(newVisit);
                        }
                    } else if (payload.eventType === 'DELETE') {
                        const deletedId = payload.old.id;
                        setActiveVisit(prev => (prev?.id === deletedId ? null : prev));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [profile]);

    const startVisit = async (clientId: string, options?: { type?: string; channel?: VirtualChannel }) => {
        if (!profile?.id) return null;

        if (activeVisit) {
            console.warn("Cannot start new visit, one is already active");
            return null;
        }

        // Safety check: Ensure no other visit is legally in progress in the DB
        // This prevents "zombie" visits if the local state was lost (e.g. refresh)
        // Using limit(1) + array destructuring to handle cases where multiple duplicates might already exist
        const { data: existingList } = await supabase
            .from('visits')
            .select('*')
            .eq('sales_rep_id', profile.id)
            .eq('status', 'in_progress')
            .limit(1);

        const existing = existingList?.[0];

        if (existing) {
            console.log("Found existing stuck visit, resuming:", existing);
            setActiveVisit(existing);

            // If the user is trying to check-in to the SAME client, return existing
            // If different client, we should probably warn them or auto-close the old one? 
            // For now, let's just resume the old one to force them to close it.
            return existing;
        }

        const isVirtual = options?.type === VIRTUAL_VISIT_TYPE;

        // Capture Location for Audit (virtual visits happen remotely: no location)
        let checkInLat = null;
        let checkInLng = null;

        if (!isVirtual) {
            try {
                const pos = await checkGPSConnection({ showAlert: false, timeoutMs: 12000, retries: 1, minAccuracyMeters: 200 });
                checkInLat = pos.coords.latitude;
                checkInLng = pos.coords.longitude;
            } catch (geoError) {
                console.warn("Could not get geolocation for check-in audit:", geoError);
                // We continue anyway, as blocking logic is handled in frontend if desired.
                // But we try to capture it for "knowing where users are".
            }
        }

        try {
            const { data, error } = await supabase.from('visits').insert({
                client_id: clientId,
                check_in_time: new Date().toISOString(),
                sales_rep_id: profile.id,
                status: 'in_progress',
                type: options?.type || null,
                channel: isVirtual ? options?.channel || null : null,
                lat: checkInLat, // Audit: Check-in location
                lng: checkInLng, // Audit: Check-in location
                scheduled_at: new Date().toISOString() // Required by DB constraint
            }).select().single();

            if (data) {
                setActiveVisit(data);
                return data;
            }
            if (error) throw error;
        } catch (error: any) {
            console.error("Error starting visit:", error);
            alert(`Error trying to start visit:\n${error.message}\n${error.details || ''}\n${error.hint || ''}`);
        }
        return null;
    };

    const endVisit = async (options?: { notes?: string; virtual?: VirtualCheckoutDetails }) => {
        if (!activeVisit) return false;

        const closingVisitId = activeVisit.id;
        const isVirtual = isVirtualVisit(activeVisit);
        const virtual = isVirtual ? options?.virtual : undefined;

        try {
            // Get location (not for virtual visits)
            let lat = null;
            let lng = null;

            if (!isVirtual) {
                try {
                    const pos = await checkGPSConnection({ showAlert: false, timeoutMs: 12000, maximumAgeMs: 2000, retries: 1, minAccuracyMeters: 200 });
                    lat = pos.coords.latitude;
                    lng = pos.coords.longitude;
                } catch (geoError) {
                    console.warn("Could not get geolocation for checkout:", geoError);
                    // Continue without immediate location; queue retry after close.
                }
            }

            const { error } = await supabase.from('visits').update({
                check_out_time: new Date().toISOString(),
                status: 'completed',
                notes: options?.notes || null,
                check_out_lat: lat as number | undefined,
                check_out_lng: lng as number | undefined,
                ...(virtual ? {
                    outcome: virtual.outcome,
                    duration_minutes: virtual.durationMinutes,
                    next_action_at: virtual.nextActionAt
                } : {})
            } as any).eq('id', closingVisitId);

            if (error) {
                console.error("Error closing visit in DB:", error);
                alert(`Error al guardar término de visita: ${error.message}\n\nAvisa a soporte si esto persiste.`);
                // Do NOT clear activeVisit so user can try again
                return false;
            } else {
                if (virtual?.nextActionAt) {
                    await createFollowUpTask(activeVisit, virtual, options?.notes || '');
                }
                // If checkout location was unavailable at close time, retry in background queue.
                if (!isVirtual && (lat === null || lng === null)) {
                    void queueVisitCheckoutLocation({
                        visit_id: closingVisitId,
                        seller_id: profile?.id || activeVisit.sales_rep_id || ''
                    });
                }
                // ONLY clear on success
                setActiveVisit(null);
                return true;
            }

        } catch (error: any) {
            console.error("Error in endVisit process:", error);
            alert(`Error inesperado al terminar visita: ${error.message || 'Error desconocido'}`);
            return false;
        }
    };

    // The follow-up task is created after the visit is closed: if it fails the visit stays
    // recorded and the seller is told to create the task by hand.
    const createFollowUpTask = async (visit: Visit, virtual: VirtualCheckoutDetails, notes: string) => {
        if (!profile?.id || !virtual.nextActionAt) return;

        const outcomeLabel = getVirtualOutcomeLabel(virtual.outcome);
        const { data, error } = await supabase.from('tasks').insert({
            user_id: profile.id,
            client_id: visit.client_id,
            title: `Seguimiento gestión ${getVirtualChannelLabel(visit.channel).toLowerCase()}${outcomeLabel ? ` · ${outcomeLabel}` : ''}`,
            description: notes || null,
            due_date: virtual.nextActionAt,
            priority: 'medium',
            status: 'pending'
        } as any).select('id').single();

        if (error || !data) {
            console.error("Error creating follow-up task:", error);
            alert('La gestión quedó registrada, pero no se pudo crear la tarea de seguimiento. Créala manualmente desde la agenda.');
            return;
        }

        const { error: linkError } = await supabase.from('visits')
            .update({ follow_up_task_id: (data as { id: string }).id })
            .eq('id', visit.id);
        if (linkError) console.warn("Could not link follow-up task to visit:", linkError);
    };

    return (
        <VisitContext.Provider value={{ activeVisit, loading, startVisit, endVisit }}>
            {children}
        </VisitContext.Provider>
    );
};

export const useVisit = () => {
    const context = useContext(VisitContext);
    if (context === undefined) {
        throw new Error('useVisit must be used within a VisitProvider');
    }
    return context;
};
