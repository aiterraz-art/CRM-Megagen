import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { checkGPSConnection } from '../utils/gps';
import { Database } from '../types/supabase';
import { useUser } from './UserContext';

type Visit = Database['public']['Tables']['visits']['Row'];

interface VisitContextType {
    activeVisit: Visit | null;
    loading: boolean;
    startVisit: (clientId: string) => Promise<Visit | null>;
    endVisit: (options?: { notes?: string }) => Promise<void>;
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
                }
            } catch (err) {
                console.error("Unexpected error fetching active visit:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchActiveVisit();
    }, [profile]);

    const startVisit = async (clientId: string) => {
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

        // Capture Location for Audit
        let checkInLat = null;
        let checkInLng = null;

        try {
            const getPosition = () => new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: true });
            });
            const pos = await getPosition();
            checkInLat = pos.coords.latitude;
            checkInLng = pos.coords.longitude;
        } catch (geoError) {
            console.warn("Could not get geolocation for check-in audit:", geoError);
            // We continue anyway, as blocking logic is handled in frontend if desired.
            // But we try to capture it for "knowing where users are".
        }

        try {
            const { data, error } = await supabase.from('visits').insert({
                client_id: clientId,
                check_in_time: new Date().toISOString(),
                sales_rep_id: profile.id,
                status: 'in_progress',
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

    const endVisit = async (options?: { notes?: string }) => {
        if (!activeVisit) return;

        const closingVisitId = activeVisit.id;

        try {
            // Get location
            const getPosition = () => new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
            });

            let lat = null;
            let lng = null;

            try {
                const pos = await getPosition();
                lat = pos.coords.latitude;
                lng = pos.coords.longitude;
            } catch (geoError) {
                console.warn("Could not get geolocation for checkout:", geoError);
                // Continue without location
            }

            const { error } = await supabase.from('visits').update({
                check_out_time: new Date().toISOString(),
                status: 'completed',
                notes: options?.notes || null,
                check_out_lat: lat as number | undefined,
                check_out_lng: lng as number | undefined
            } as any).eq('id', closingVisitId);

            if (error) {
                console.error("Error closing visit in DB:", error);
                alert(`Error al guardar término de visita: ${error.message}\n\nAvisa a soporte si esto persiste.`);
                // Do NOT clear activeVisit so user can try again
            } else {
                // ONLY clear on success
                setActiveVisit(null);
            }

        } catch (error: any) {
            console.error("Error in endVisit process:", error);
            alert(`Error inesperado al terminar visita: ${error.message || 'Error desconocido'}`);
        }
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
