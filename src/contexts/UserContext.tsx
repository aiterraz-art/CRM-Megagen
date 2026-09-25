import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { Database } from '../types/supabase';
import {
    applyPermissionOverrides,
    fetchRolePermissionRows,
    fetchUserPermissionOverrides,
    getDefaultPermissions,
    isBillingBackofficeRole,
    normalizeRole,
    resolveRolePermissions
} from '../utils/permissions';

export type Profile = Database['public']['Tables']['profiles']['Row'] & {
    supervisor_id?: string | null;
    status?: string | null;
    full_name?: string | null;
};

interface UserContextType {
    profile: Profile | null;
    loading: boolean;
    isSupervisor: boolean;
    impersonatedUser: Profile | null;
    impersonateUser: (email: string) => Promise<void>;
    stopImpersonation: () => void;
    effectiveRole: string | null;
    canImpersonate: boolean;
    realRole: string | null;
    isManager: boolean;
    isChief: boolean;
    isFacturador: boolean;
    isSeller: boolean;
    isDriver: boolean;
    canUploadData: boolean;
    canViewMetas: boolean;
    hasPermission: (permission: string) => boolean;
    permissions: string[];
    simulatedRole: string | null;
    setSimulatedRole: (role: string | null) => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [impersonatedUser, setImpersonatedUser] = useState<Profile | null>(null);
    const [permissions, setPermissions] = useState<string[]>([]);
    const [simulatedRole, setSimulatedRole] = useState<string | null>(null);
    // Identifica al usuario cuyo perfil ya esta cargado, para no repetir la carga
    // ante eventos de sesion que no cambian de usuario.
    const loadedUserIdRef = useRef<string | null>(null);
    const fetchProfile = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                loadedUserIdRef.current = session.user.id;
                const email = session.user.email?.toLowerCase();
                const normalizedSessionEmail = (session.user.email || '').toLowerCase();

                // DOMAIN RESTRICTION CHECK
                const allowedDomain = import.meta.env.VITE_ALLOWED_DOMAIN || '@imegagen.cl';
                const ownerEmail = import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl';

                const { data: whitelistEntry } = await supabase
                    .from('user_whitelist')
                    .select('role')
                    .eq('email', normalizedSessionEmail)
                    .maybeSingle();

                const isOwner = email === ownerEmail;
                const isAllowedDomain = email?.endsWith(allowedDomain);
                const isInvitedEmail = !!whitelistEntry?.role;

                if (!isOwner && !isAllowedDomain && !isInvitedEmail) {
                    await supabase.auth.signOut();
                    alert(`ACCESO DENEGADO\n\nEsta es una plataforma privada.\nSolo se permiten cuentas corporativas ${allowedDomain} o correos previamente invitados.`);
                    window.location.href = '/';
                    return;
                }

                const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id);


                if (data && data.length > 0) {
                    let userProfile = data[0] as any as Profile;

                    const ownerEmail = import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl';
                    if (session.user.email === ownerEmail) {
                        userProfile = {
                            ...userProfile,
                            status: 'active',
                            role: 'admin'
                        };
                    } else if (userProfile.status === 'pending') {
                        if (whitelistEntry) {
                            await supabase.from('profiles').update({
                                status: 'active',
                                role: normalizeRole(whitelistEntry.role)
                            }).eq('id', session.user.id);

                            userProfile = { ...userProfile, status: 'active', role: normalizeRole(whitelistEntry.role) };
                        }
                    }
                    setProfile(userProfile);
                } else if (session.user.email === (import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl')) {
                    const ownerProfile = {
                        id: session.user.id,
                        email: session.user.email,
                        role: 'admin',
                        status: 'active',
                        full_name: 'Super Admin (Bypass)'
                    };
                    setProfile(ownerProfile as any as Profile);
                } else {
                    if (whitelistEntry) {
                        const newProfile = {
                            id: session.user.id,
                            email: session.user.email,
                            role: normalizeRole(whitelistEntry.role),
                            status: 'active',
                            full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Nuevo Usuario'
                        };

                        const { error, data } = await supabase.from('profiles').insert(newProfile).select().single();

                        if (error) {
                            console.error("UserContext: Error creating profile from whitelist:", error);
                        } else {
                            setProfile(data as any as Profile);
                        }
                    } else {
                        setProfile(null);
                    }
                }
            }
        } catch (err) {
            console.error("UserContext: Profile Load Error:", err);
            // Si la carga fallo, se libera la marca para que un evento de sesion
            // posterior pueda reintentarla en lugar de quedar bloqueada.
            loadedUserIdRef.current = null;
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchProfile();

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.user) {
                loadedUserIdRef.current = null;
                setProfile(null);
                setImpersonatedUser(null);
                setSimulatedRole(null);
                setLoading(false);
                return;
            }

            // Solo se recarga el perfil cuando cambia el usuario autenticado. Los eventos
            // de refresco de token que Supabase emite al volver el foco a la pestana no
            // traen informacion nueva, y recargar aqui sustituia el objeto del perfil,
            // lo que reejecutaba las consultas de las paginas y cerraba los formularios.
            if (loadedUserIdRef.current === session.user.id) return;

            void fetchProfile();
        });

        return () => authListener.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const role = normalizeRole(simulatedRole || (impersonatedUser || profile)?.role);

        if (!role) {
            setPermissions([]);
            return;
        }

        // El bypass del propietario no debe aplicarse mientras se impersona a otro usuario
        // o se simula un rol: en ese caso el objetivo es ver exactamente lo que ve el rol destino.
        const ownerEmail = String(import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl').trim().toLowerCase();
        const isViewingAsSomeoneElse = Boolean(simulatedRole) || Boolean(impersonatedUser);
        const isOwnerSession = Boolean(ownerEmail) && (profile?.email || '').trim().toLowerCase() === ownerEmail;

        if (isOwnerSession && !isViewingAsSomeoneElse) {
            setPermissions(getDefaultPermissions('admin'));
            return;
        }

        let cancelled = false;
        // Al simular un rol se ve el rol puro; las excepciones son de una persona concreta.
        const overridesUserId = simulatedRole ? null : (impersonatedUser || profile)?.id || null;

        void (async () => {
            const [rows, overrides] = await Promise.all([
                fetchRolePermissionRows(),
                overridesUserId ? fetchUserPermissionOverrides(overridesUserId) : Promise.resolve([])
            ]);
            if (cancelled) return;
            setPermissions(applyPermissionOverrides(role, resolveRolePermissions(role, rows).permissions, overrides));
        })();

        return () => {
            cancelled = true;
        };
    }, [profile?.id, profile?.email, profile?.role, impersonatedUser?.id, impersonatedUser?.role, simulatedRole]);

    useEffect(() => {
        if (!simulatedRole) return;
        if (normalizeRole(profile?.role) !== 'admin') {
            setSimulatedRole(null);
        }
    }, [profile?.role, simulatedRole]);

    const effectiveProfile = impersonatedUser || profile;
    const effectiveRole = normalizeRole(simulatedRole || effectiveProfile?.role);

    const isManager = effectiveRole === 'admin';
    const isChief = effectiveRole === 'jefe';
    const isFacturador = isBillingBackofficeRole(effectiveRole);
    const isSeller = effectiveRole === 'seller';
    const isDriver = effectiveRole === 'driver';
    const isSupervisor = permissions.includes('VIEW_TEAM_STATS');
    const bCanImpersonate = permissions.includes('MANAGE_USERS');
    const bHasPermission = (perm: string) => permissions.includes(perm);
    const bCanUploadData = permissions.includes('UPLOAD_EXCEL');
    const bCanViewMetas = permissions.includes('VIEW_METAS');

    return (
        <UserContext.Provider value={{
            profile: effectiveProfile, loading, isSupervisor, impersonatedUser, impersonateUser: async (email: string) => {
                const { data } = await supabase.from('profiles').select('*').eq('email', email).single();
                if (data) setImpersonatedUser(data as any as Profile);
            }, stopImpersonation: () => setImpersonatedUser(null), effectiveRole, canImpersonate: bCanImpersonate, realRole: normalizeRole(profile?.role) || null, isManager, isChief, isFacturador, isSeller, isDriver, canUploadData: bCanUploadData, canViewMetas: bCanViewMetas, hasPermission: bHasPermission, permissions, simulatedRole, setSimulatedRole: (role: string | null) => setSimulatedRole(role ? normalizeRole(role) : null)
        }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = () => {
    const context = useContext(UserContext);
    if (context === undefined) throw new Error('useUser must be used within a UserProvider');
    return context;
};
