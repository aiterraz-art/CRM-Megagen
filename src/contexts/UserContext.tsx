import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { Database } from '../types/supabase';

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
    isAdminOps: boolean;
    isSeller: boolean;
    isDriver: boolean;
    canUploadData: boolean;
    canViewMetas: boolean;
    hasPermission: (permission: string) => boolean;
    permissions: string[];
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [impersonatedUser, setImpersonatedUser] = useState<Profile | null>(null);
    const [permissions, setPermissions] = useState<string[]>([]);

    const fetchPermissions = async (role: string) => {
        const defaults: Record<string, string[]> = {
            'manager': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'EXECUTE_DELIVERY', 'MANAGE_USERS', 'MANAGE_PERMISSIONS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'IMPORT_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_ALL_TEAM_STATS'],
            'admin': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'EXECUTE_DELIVERY', 'MANAGE_USERS', 'MANAGE_PERMISSIONS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'IMPORT_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_ALL_TEAM_STATS'],
            'jefe': ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_TEAM_STATS'],
            'administrativo': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH'],
            'seller': ['VIEW_METAS'],
            'driver': ['EXECUTE_DELIVERY']
        };

        // NUCLEAR BYPASS: If current user is owner, give EVERYTHING regardless of DB
        const ownerEmail = import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl';
        if (profile?.email === ownerEmail) {
            console.log("UserContext: Owner nuclear bypass applied to permissions.");
            setPermissions(defaults['admin']);
            return;
        }

        try {
            const { data, error } = await supabase.from('role_permissions').select('permission').eq('role', role);
            console.log(`UserContext DB Perms (${role}):`, { data, error });

            if (error || !data || data.length === 0) {
                console.warn(`UserContext: Using default permissions for ${role}`);
                const fallback = defaults[role] || [];
                console.log(`UserContext Fallback (${role}):`, fallback);
                setPermissions(fallback);
                return;
            }

            const perms = data.map(p => p.permission);
            console.log(`UserContext Final Perms (${role}):`, perms);
            setPermissions(perms);
        } catch (err) {
            console.error("Error fetching permissions, using fallbacks:", err);
            setPermissions(defaults[role] || []);
        }
    };

    const fetchProfile = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                const email = session.user.email?.toLowerCase();

                // DOMAIN RESTRICTION CHECK
                const allowedDomain = import.meta.env.VITE_ALLOWED_DOMAIN || '@imegagen.cl';
                const ownerEmail = import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl';

                const isOwner = email === ownerEmail;
                const isAllowedDomain = email?.endsWith(allowedDomain);

                if (!isOwner && !isAllowedDomain) {
                    console.warn(`UserContext: Access Denied for ${email}. Domain not allowed.`);
                    await supabase.auth.signOut();
                    alert(`ACCESO DENEGADO\n\nEsta es una plataforma privada.\nSolo se permiten cuentas corporativas ${allowedDomain}`);
                    window.location.href = '/';
                    return;
                }

                // 1. PRIMARY SOURCE: public.profiles
                const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id);


                if (data && data.length > 0) {
                    let userProfile = data[0] as any as Profile;

                    const ownerEmail = import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl';
                    if (session.user.email === ownerEmail) {
                        console.warn("UserContext: Owner detected in DB. Forcing ACTIVE/ADMIN status locally.");
                        userProfile = {
                            ...userProfile,
                            status: 'active',
                            role: 'admin'
                        };
                    } else if (userProfile.status === 'pending') {
                        const { data: whitelistEntry } = await supabase
                            .from('user_whitelist')
                            .select('role')
                            .eq('email', session.user.email)
                            .maybeSingle();

                        if (whitelistEntry) {
                            console.log("UserContext: Pending user found in whitelist. Activating...");

                            // Force update DB
                            await supabase.from('profiles').update({
                                status: 'active',
                                role: whitelistEntry.role
                            }).eq('id', session.user.id);

                            // Update local object
                            userProfile = { ...userProfile, status: 'active', role: whitelistEntry.role };
                        }
                    }
                    setProfile(userProfile);
                } else if (session.user.email === (import.meta.env.VITE_OWNER_EMAIL || 'aterraza@imegagen.cl')) {
                    // EMERGENCY BYPASS: Force admin profile for system owner if DB fetch fails
                    console.warn("UserContext: EMERGENCY BYPASS triggered for owner.");
                    const ownerProfile = {
                        id: session.user.id,
                        email: session.user.email,
                        role: 'admin',
                        status: 'active',
                        full_name: 'Super Admin (Bypass)'
                    };
                    setProfile(ownerProfile as any as Profile);
                } else {
                    // 2. CHECK WHITELIST (Security & Onboarding)
                    const { data: whitelistEntry } = await supabase
                        .from('user_whitelist')
                        .select('role')
                        .eq('email', session.user.email)
                        .maybeSingle();

                    if (whitelistEntry) {
                        console.log("UserContext: User found in whitelist. creating profile...");
                        const newProfile = {
                            id: session.user.id,
                            email: session.user.email,
                            role: whitelistEntry.role, // Use role from invitation
                            status: 'active',
                            full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Nuevo Usuario'
                        };

                        const { error, data } = await supabase.from('profiles').insert(newProfile).select().single();

                        if (error) {
                            console.error("UserContext: Error creating profile from whitelist:", error);
                            // Retry or fallback? Alert?
                        } else {
                            setProfile(data as any as Profile);
                            // Optional: Delete from whitelist or mark as claimed? 
                            // Keeping it allows re-creation if profile is deleted by mistake.
                        }
                    } else {
                        // 3. REJECT or PENDING
                        console.warn("UserContext: User NOT in whitelist. Access Restricted.");
                        // We DO NOT create a profile. User remains authenticated but with no role.
                        // Logic below handles "no profile" as "Access Denied" or basic view.
                        setProfile(null);
                    }
                }
            }
        } catch (err) {
            console.error("UserContext: Profile Load Error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProfile();
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) fetchProfile();
            else {
                setProfile(null);
                setImpersonatedUser(null);
                setLoading(false);
            }
        });
        return () => authListener.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        const role = (impersonatedUser || profile)?.role;
        if (role) fetchPermissions(role);
        else setPermissions([]);
    }, [profile?.role, impersonatedUser?.role]);

    const getRoleBase = (r: string | null | undefined) => (r || '').trim().toLowerCase();
    const effectiveProfile = impersonatedUser || profile;
    const effectiveRole = getRoleBase(effectiveProfile?.role);

    const isManager = effectiveRole === 'manager' || effectiveRole === 'admin';
    const isChief = effectiveRole === 'jefe';
    const isAdminOps = effectiveRole === 'administrativo';
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
            }, stopImpersonation: () => setImpersonatedUser(null), effectiveRole, canImpersonate: bCanImpersonate, realRole: getRoleBase(profile?.role) || null, isManager, isChief, isAdminOps, isSeller, isDriver, canUploadData: bCanUploadData, canViewMetas: bCanViewMetas, hasPermission: bHasPermission, permissions
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
