import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Shield, User, Search, CheckCircle, Ban, Edit, Save, AlertTriangle, Trash2, Mail } from 'lucide-react';
import { Profile } from '../contexts/UserContext';
import { googleService } from '../services/googleService';

type InvitePayload = {
    email: string;
    full_name?: string | null;
    role: string;
};

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
    admin: ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'VIEW_METAS', 'MANAGE_METAS', 'MANAGE_DISPATCH', 'EXECUTE_DELIVERY', 'MANAGE_USERS', 'MANAGE_PERMISSIONS', 'VIEW_ALL_CLIENTS', 'MANAGE_CLIENTS', 'IMPORT_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_ALL_TEAM_STATS', 'VIEW_OPERATIONS', 'MANAGE_AUTOMATIONS', 'MANAGE_SLA', 'MANAGE_APPROVALS', 'MANAGE_POSTSALE', 'MANAGE_COLLECTIONS', 'VIEW_TEAM_CALENDARS', 'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'MANAGE_PROCUREMENT', 'VIEW_KIT_LOANS', 'REQUEST_KIT_LOANS', 'MANAGE_KIT_LOANS'],
    jefe: ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_TEAM_STATS', 'VIEW_OPERATIONS', 'MANAGE_SLA', 'MANAGE_APPROVALS', 'VIEW_TEAM_CALENDARS', 'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'MANAGE_PROCUREMENT', 'VIEW_KIT_LOANS', 'REQUEST_KIT_LOANS'],
    facturador: ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_OPERATIONS', 'MANAGE_COLLECTIONS', 'VIEW_KIT_LOANS', 'MANAGE_KIT_LOANS'],
    seller: ['VIEW_METAS', 'VIEW_PROCUREMENT', 'REQUEST_PRODUCTS', 'VIEW_KIT_LOANS', 'REQUEST_KIT_LOANS'],
    driver: ['EXECUTE_DELIVERY']
};

const Settings: React.FC = () => {
    const { profile, effectiveRole } = useUser();
    const ownerEmail = import.meta.env.VITE_OWNER_EMAIL || 'owner@company.com';
    const [users, setUsers] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'users' | 'permissions' | 'integrations'>('users');
    const [testingSync, setTestingSync] = useState(false);
    const [googleStatus, setGoogleStatus] = useState<{
        googleEmail: string | null;
        hasRefreshToken: boolean;
        lastRefreshAt: string | null;
        lastError: string | null;
        updatedAt: string | null;
        needsReconnect: boolean;
    } | null>(null);
    const [loadingGoogleStatus, setLoadingGoogleStatus] = useState(false);

    // RESTORED STATE
    const [tempRole, setTempRole] = useState<string>('');
    const [tempStatus, setTempStatus] = useState<string>('');
    const [tempSupervisor, setTempSupervisor] = useState<string | null>(null);
    const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
    const [savingPerms, setSavingPerms] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [sendingInvite, setSendingInvite] = useState(false);
    const [inviteData, setInviteData] = useState({ email: '', full_name: '', role: 'seller' });
    const [pendingInvites, setPendingInvites] = useState<any[]>([]); // New state for Pending Invites
    const [resendingInviteEmail, setResendingInviteEmail] = useState<string | null>(null);

    const normalizeRole = (role: string | null | undefined) => {
        const normalized = (role || '').toLowerCase().trim();
        if (normalized === 'manager') return 'admin';
        if (normalized === 'administrativo') return 'facturador';
        return normalized;
    };
    const roles = ['admin', 'jefe', 'facturador', 'seller', 'driver'];
    const permissionList = [
        { key: 'UPLOAD_EXCEL', label: 'Cargar Excel', desc: 'Permite subir archivos de inventario, precios y despacho.' },
        { key: 'MANAGE_INVENTORY', label: 'Gestión Inventario', desc: 'Crear, editar y eliminar productos.' },
        { key: 'MANAGE_PRICING', label: 'Modificar Precios', desc: 'Cambiar precios de venta.' },
        { key: 'VIEW_METAS', label: 'Ver Metas', desc: 'Visualizar indicadores de venta y facturación.' },
        { key: 'MANAGE_METAS', label: 'Configurar Metas', desc: 'Asignar objetivos comerciales a vendedores.' },
        { key: 'MANAGE_DISPATCH', label: 'Gestionar Despacho', desc: 'Crear y asignar rutas de transporte.' },
        { key: 'EXECUTE_DELIVERY', label: 'Realizar Entregas', desc: 'Módulo de repartidor para completar pedidos.' },
        { key: 'MANAGE_USERS', label: 'Gestionar Usuarios', desc: 'Editar roles y estados de perfiles.' },
        { key: 'MANAGE_PERMISSIONS', label: 'Matriz Permisos', desc: 'Configurar los accesos de cada rol.' },
        { key: 'VIEW_ALL_CLIENTS', label: 'Ver Todos Clientes', desc: 'Acceso a la cartera total de clientes (vs solo propios).' },
        { key: 'MANAGE_CLIENTS', label: 'Gestionar Clientes', desc: 'Editar, eliminar y crear fichas de clientes.' },
        { key: 'IMPORT_CLIENTS', label: 'Importar Clientes', desc: 'Subida masiva de clientes vía CSV.' },
        { key: 'VIEW_TEAM_STATS', label: 'Panel Equipo', desc: 'Acceso a estadísticas y supervisión de representantes.' },
        { key: 'VIEW_ALL_TEAM_STATS', label: 'Ver Todo el Equipo', desc: 'Supervisión global (vs solo subordinados directos).' },
        { key: 'VIEW_OPERATIONS', label: 'Ver Operaciones', desc: 'Acceso al centro de operaciones y monitoreo operativo.' },
        { key: 'MANAGE_AUTOMATIONS', label: 'Gestionar Automatizaciones', desc: 'Configurar reglas automáticas del sistema.' },
        { key: 'MANAGE_SLA', label: 'Gestionar SLA', desc: 'Administrar compromisos y tiempos de servicio.' },
        { key: 'MANAGE_APPROVALS', label: 'Gestionar Aprobaciones', desc: 'Resolver solicitudes de autorización y descuentos.' },
        { key: 'MANAGE_POSTSALE', label: 'Gestionar Postventa', desc: 'Administrar flujos y seguimiento de postventa.' },
        { key: 'MANAGE_COLLECTIONS', label: 'Gestionar Cobranzas', desc: 'Subir y administrar información de cobranzas.' },
        { key: 'VIEW_TEAM_CALENDARS', label: 'Calendarios del Equipo', desc: 'Permite ver Google Calendar de otros vendedores compartidos por Workspace.' },
        { key: 'VIEW_PROCUREMENT', label: 'Ver Compras', desc: 'Acceso al módulo de solicitudes de productos e importaciones en tránsito.' },
        { key: 'REQUEST_PRODUCTS', label: 'Solicitar Productos', desc: 'Permite crear solicitudes de compra o reposición.' },
        { key: 'MANAGE_PROCUREMENT', label: 'Gestionar Compras', desc: 'Permite administrar solicitudes, importaciones y vínculos con embarques.' },
        { key: 'VIEW_KIT_LOANS', label: 'Ver Kits', desc: 'Acceso al módulo de préstamo y seguimiento de kits clínicos.' },
        { key: 'REQUEST_KIT_LOANS', label: 'Solicitar Kits', desc: 'Permite crear solicitudes de préstamo de kits para clientes.' },
        { key: 'MANAGE_KIT_LOANS', label: 'Gestionar Kits', desc: 'Permite registrar kits, despachar préstamos y cerrar devoluciones.' }
    ];

    useEffect(() => {
        fetchUsers();
        fetchRolePermissions();
        fetchPendingInvites(); // Fetch whitelisted users
    }, []);

    const fetchPendingInvites = async () => {
        // Fetch whitelist entries that DO NOT have a corresponding profile
        const { data: whitelist } = await supabase.from('user_whitelist').select('*');
        if (whitelist) {
            // Filter out those who already have a profile
            const { data: existingProfiles } = await supabase.from('profiles').select('email');
            const existingEmails = new Set((existingProfiles || []).map(p => p.email?.toLowerCase()));

            const pending = whitelist.filter(w => !existingEmails.has(w.email?.toLowerCase()));
            setPendingInvites(pending);
        }
    };

    const fetchRolePermissions = async () => {
        const { data } = await supabase.from('role_permissions').select('*');
        if (data && data.length > 0) {
            const matrix: Record<string, string[]> = {};
            data.forEach((p: any) => {
                const roleKey = normalizeRole(p.role);
                if (!matrix[roleKey]) matrix[roleKey] = [];
                matrix[roleKey].push(p.permission);
            });
            const merged: Record<string, string[]> = { ...DEFAULT_ROLE_PERMISSIONS };
            Object.entries(matrix).forEach(([role, perms]) => {
                const basePerms = role === 'admin'
                    ? permissionList.map((permission) => permission.key)
                    : (DEFAULT_ROLE_PERMISSIONS[role] || []);
                merged[role] = Array.from(new Set([...basePerms, ...perms]));
            });
            setRolePerms(merged);
        } else {
            setRolePerms(DEFAULT_ROLE_PERMISSIONS);
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            // Solo consultamos public.profiles para evitar "usuarios fantasma" del esquema crm
            const { data, error } = await supabase.from('profiles').select('*').order('email');
            if (error) throw error;
            setUsers((data || []) as Profile[]);
        } catch (error: any) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (id: string) => {
        try {
            const statusToPersist = tempStatus === 'disabled' ? 'disabled' : tempStatus;
            let { error } = await supabase.from('profiles').update({
                role: tempRole,
                status: statusToPersist,
                supervisor_id: tempSupervisor || null
            }).eq('id', id);

            if (error) {
                const retry = await supabase.from('profiles').update({
                    role: tempRole,
                    status: statusToPersist
                }).eq('id', id);
                error = retry.error;
            }

            // Backward compatibility for instances that still enforce "suspended" instead of "disabled".
            if (error && statusToPersist === 'disabled') {
                const legacyRetry = await supabase.from('profiles').update({
                    role: tempRole,
                    status: 'suspended'
                } as any).eq('id', id);
                error = legacyRetry.error;
            }

            if (error) {
                alert('Error al actualizar en tabla principal: ' + error.message);
                return;
            }

            try {
                await (supabase.schema('crm').from('profiles') as any).update({ role: tempRole, status: statusToPersist }).eq('id', id);
            } catch (e) {
                console.warn("Silent failure updating crm schema profile:", e);
            }

            alert('Usuario actualizado correctamente.');
            setEditingId(null);
            fetchUsers();
        } catch (error: any) {
            console.error("Save error:", error);
            alert('Error crítico: ' + error.message);
        }
    };

    const handleTogglePermission = (role: string, perm: string) => {
        if (role === 'admin') return; // Admin always has everything
        setRolePerms(prev => {
            const current = prev[role] || [];
            if (current.includes(perm)) {
                return { ...prev, [role]: current.filter(p => p !== perm) };
            } else {
                return { ...prev, [role]: [...current, perm] };
            }
        });
    };

    const handleSaveRolePermissions = async () => {
        setSavingPerms(true);
        try {
            const rows: any[] = [];
            permissionList.forEach(p => {
                rows.push({ role: 'admin', permission: p.key });
            });

            Object.entries(rolePerms).forEach(([role, perms]) => {
                if (role === 'admin') return;
                perms.forEach(p => {
                    rows.push({ role: normalizeRole(role), permission: p });
                });
            });

            const { error } = await supabase.rpc('sync_role_permissions', {
                p_rows: rows
            });

            if (error) throw error;
            await fetchRolePermissions();
            alert('Matriz de permisos actualizada correctamente y accesos de Administrador blindados.');
        } catch (error: any) {
            console.error('Error saving perms:', error);
            alert('Error al guardar: ' + error.message);
        } finally {
            setSavingPerms(false);
        }
    };

    const handleInviteUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setSendingInvite(true);
        try {
            const normalizedEmail = inviteData.email.trim().toLowerCase();
            if (!normalizedEmail) {
                alert('Debes indicar un email válido para invitar.');
                return;
            }

            // 1. Verify existence in Profiles or Whitelist
            const { data: existingProfile } = await supabase.from('profiles').select('id').eq('email', normalizedEmail).maybeSingle();
            if (existingProfile) {
                alert("Este usuario ya está registrado en el sistema.");
                setSendingInvite(false);
                return;
            }

            const { data: existingWhitelist } = await supabase.from('user_whitelist').select('email').eq('email', normalizedEmail).maybeSingle();
            if (existingWhitelist) {
                if (!confirm("Este usuario ya fue invitado previamente. ¿Deseas actualizar su rol y reenviar el correo?")) {
                    setSendingInvite(false);
                    return;
                }
            }

            // 2. Upsert to Whitelist
            const { error: whitelistError } = await supabase.from('user_whitelist').upsert({
                email: normalizedEmail,
                role: inviteData.role
            });

            if (whitelistError) throw whitelistError;

            // 3. Send Email (Best Effort via Gmail API)
            const mailResult = await sendInvitationEmail({
                email: normalizedEmail,
                full_name: inviteData.full_name,
                role: inviteData.role
            });

            if (mailResult.sent) {
                alert('✅ Invitación creada y correo enviado.');
            } else {
                alert('⚠️ Invitación creada pero NO enviada (falta sesión Google). Notificar manualmente.');
            }

            setIsInviteModalOpen(false);
            setInviteData({ email: '', full_name: '', role: 'seller' });
            fetchPendingInvites();
        } catch (error: any) {
            console.error('Error in handleInviteUser:', error);
            alert('Error al procesar invitación: ' + (error.message || 'Error desconocido'));
        } finally {
            setSendingInvite(false);
        }
    };

    const sendInvitationEmail = async (invite: InvitePayload): Promise<{ sent: boolean }> => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return { sent: false };

        const companyName = import.meta.env.VITE_COMPANY_NAME || 'Megagen';
        const contactName = invite.full_name?.trim() || invite.email.split('@')[0];
        const subject = `Invitación a ${companyName} CRM 🏥`;
        const message = `Hola ${contactName},\n\nHas sido invitado al CRM de ${companyName} con el rol de ${invite.role.toUpperCase()}.\n\nPara ingresar, simplemente inicia sesión con tu cuenta de Google (${invite.email}) en:\n\n${window.location.origin}/\n\nSaludos,\nEquipo ${companyName}`;

        const utf8Encode = new TextEncoder();
        const subjectEncoded = btoa(String.fromCharCode(...utf8Encode.encode(subject)));
        const rawMimeMessage = [
            `From: ${session?.user.email}`,
            `To: ${invite.email.toLowerCase()}`,
            `Subject: =?utf-8?B?${subjectEncoded}?=`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset="UTF-8"',
            'Content-Transfer-Encoding: 7bit',
            '',
            message
        ].join('\r\n');

        await googleService.fetchGoogleJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw: btoa(unescape(encodeURIComponent(rawMimeMessage))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') })
        });

        return { sent: true };
    };

    const handleResendInvite = async (invite: InvitePayload) => {
        setResendingInviteEmail(invite.email);
        try {
            const mailResult = await sendInvitationEmail(invite);
            if (mailResult.sent) {
                alert(`✅ Invitación reenviada a ${invite.email}.`);
            } else {
                alert('⚠️ No se pudo reenviar: falta sesión Google activa. Reconecta Google e intenta nuevamente.');
            }
        } catch (error: any) {
            console.error('Error resending invite:', error);
            alert(`❌ Error al reenviar invitación: ${error.message || 'Error desconocido'}`);
        } finally {
            setResendingInviteEmail(null);
        }
    };

    const handleDisableUser = async (id: string, email: string) => {
        if (email === ownerEmail || !window.confirm(`¿Deshabilitar a ${email}?\n\nEl historial de visitas, pedidos, cotizaciones y tareas se conservará.`)) return;

        try {
            let { error } = await supabase
                .from('profiles')
                .update({ status: 'disabled' })
                .eq('id', id);

            if (error) {
                const legacyRetry = await supabase
                    .from('profiles')
                    .update({ status: 'suspended' } as any)
                    .eq('id', id);
                error = legacyRetry.error;
            }

            if (error) throw error;

            alert(`Usuario ${email} deshabilitado correctamente.`);
            fetchUsers();
        } catch (error: any) {
            console.error('Error al deshabilitar usuario:', error);
            alert('Error al deshabilitar: ' + error.message);
        }
    };

    const handleTestGoogleSync = async () => {
        setTestingSync(true);
        try {
            const data = await googleService.fetchGoogleJson<any>('https://www.googleapis.com/calendar/v3/users/me/calendarList');
            console.log("Google Sync Success:", data);
            alert(`✅ CONEXIÓN EXITOSA\n\nGoogle Calendar respondió correctamente.\nCalendarios detectados: ${data.items?.length || 0}\n\nLa sincronización está activa.`);
            fetchGoogleStatus();
        } catch (error: any) {
            console.error("Test Error:", error);
            alert("❌ ERROR CRÍTICO:\n" + error.message);
        } finally {
            setTestingSync(false);
        }
    };

    const fetchGoogleStatus = async () => {
        setLoadingGoogleStatus(true);
        try {
            const status = await googleService.getConnectionStatus();
            setGoogleStatus(status);
        } catch (error) {
            console.error('Error fetching Google status:', error);
        } finally {
            setLoadingGoogleStatus(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'integrations') {
            fetchGoogleStatus();
        }
    }, [activeTab]);

    if (!profile || effectiveRole !== 'admin') return <div className="p-20 text-center font-bold">Acceso Denegado</div>;

    const filteredUsers = users.filter(u => (u.email?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || (u.full_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()));

    return (
        <div className="w-full mx-auto space-y-8 pb-20">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-4xl font-black text-gray-900 tracking-tight">Configuración Global</h2>
                    <p className="text-gray-400 font-medium mt-1 text-lg">Control maestro de accesos y permisos</p>
                </div>
                <div className="flex bg-gray-100 p-1.5 rounded-2xl">
                    <button onClick={() => setActiveTab('users')} className={`px-6 py-2.5 rounded-xl font-bold transition-all ${activeTab === 'users' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Usuarios</button>
                    <button onClick={() => setActiveTab('permissions')} className={`px-6 py-2.5 rounded-xl font-bold transition-all ${activeTab === 'permissions' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Roles</button>
                    <button onClick={() => setActiveTab('integrations')} className={`px-6 py-2.5 rounded-xl font-bold transition-all ${activeTab === 'integrations' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>Integraciones</button>
                    <button onClick={() => setIsInviteModalOpen(true)} className="ml-4 px-6 py-2.5 bg-gray-900 text-white rounded-xl font-bold hover:bg-black transition-all shadow-lg flex items-center gap-2"><User size={16} /> Invitar</button>
                </div>
            </div>

            {activeTab === 'users' ? (
                <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                    <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0 z-20">
                        <h3 className="text-2xl font-black text-gray-800 flex items-center gap-3"><User className="text-indigo-600" /> Miembros del Equipo</h3>
                        <div className="relative w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input type="text" placeholder="Buscar por email o nombre..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-xl font-medium focus:ring-2 focus:ring-indigo-500 shadow-inner" />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50/50">
                                <tr>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Perfil</th>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Rol</th>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Estado</th>
                                    <th className="px-8 py-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest">Supervisor / Jefe</th>
                                    <th className="px-8 py-4 text-right text-xs font-black text-gray-400 uppercase tracking-widest">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {loading ? (
                                    <tr><td colSpan={4} className="p-20 text-center text-gray-400 font-bold uppercase tracking-widest animate-pulse">Sincronizando...</td></tr>
                                ) : filteredUsers.length === 0 ? (
                                    <tr><td colSpan={4} className="p-20 text-center text-gray-400 font-bold">Sin resultados.</td></tr>
                                ) : (
                                    filteredUsers.map(user => (
                                        <tr key={user.id} className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="px-8 py-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 rounded-2xl bg-indigo-100 flex items-center justify-center text-indigo-700 font-black text-xl shadow-inner group-hover:scale-110 transition-all">{user.email?.charAt(0).toUpperCase()}</div>
                                                    <div>
                                                        <p className="font-black text-gray-900 leading-tight">{user.email}</p>
                                                        <p className="text-xs text-gray-400 font-bold mt-0.5">{user.full_name || 'Nombre no definido'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-8 py-6">
                                                {editingId === user.id ? (
                                                    <select value={tempRole} onChange={(e) => setTempRole(e.target.value)} className="bg-gray-50 border-none text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-3 font-bold shadow-sm">
                                                        {roles.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                                                    </select>
                                                ) : (
                                                    <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${normalizeRole(user.role) === 'admin' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{normalizeRole(user.role) || 'Sin Rol'}</span>
                                                )}
                                            </td>
                                            <td className="px-8 py-6">
                                                {editingId === user.id ? (
                                                    <select value={tempStatus} onChange={(e) => setTempStatus(e.target.value)} className="bg-gray-50 border-none text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-3 font-bold shadow-sm">
                                                        <option value="pending">Pendiente</option>
                                                        <option value="active">Activo</option>
                                                        <option value="disabled">Deshabilitado</option>
                                                        <option value="suspended">Suspendido (Legacy)</option>
                                                    </select>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <div className={`h-2 w-2 rounded-full ${user.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></div>
                                                        <span className={`font-black text-[10px] uppercase tracking-widest ${user.status === 'active' ? 'text-emerald-700' : 'text-rose-700'}`}>{user.status || 'Pendiente'}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-8 py-6">
                                                {editingId === user.id ? (
                                                    <select
                                                        value={tempSupervisor || ''}
                                                        onChange={(e) => setTempSupervisor(e.target.value || null)}
                                                        className="bg-gray-50 border-none text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-3 font-bold shadow-sm"
                                                    >
                                                        <option value="">Sin Supervisor</option>
                                                        {users.filter(u => u.id !== user.id && (u.role === 'jefe' || normalizeRole(u.role) === 'admin')).map(u => (
                                                            <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <span className="text-xs font-bold text-gray-500">
                                                        {users.find(u => u.id === user.supervisor_id)?.full_name || users.find(u => u.id === user.supervisor_id)?.email || '-'}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-8 py-6 text-right">
                                                {editingId === user.id ? (
                                                    <div className="flex justify-end gap-3">
                                                        <button onClick={() => setEditingId(null)} className="px-4 py-2 text-gray-400 hover:text-gray-600 font-black text-[10px] uppercase tracking-widest">Cancelar</button>
                                                        <button onClick={() => handleSave(user.id)} className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-100 flex items-center gap-2 hover:bg-indigo-700 active:scale-95 transition-all"><Save size={14} /> Guardar</button>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-end items-center gap-6">
                                                        <button onClick={() => handleDisableUser(user.id, user.email || '')} disabled={user.email === ownerEmail} className="text-gray-300 hover:text-amber-600 transition-all disabled:opacity-0 hover:scale-125"><Ban size={18} /></button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingId(user.id);
                                                                setTempRole(normalizeRole(user.role) || 'seller');
                                                                setTempStatus(user.status || 'active');
                                                                setTempSupervisor(user.supervisor_id || null);
                                                            }}
                                                            disabled={user.email === ownerEmail}
                                                            className="text-indigo-600 hover:text-indigo-800 font-black text-[10px] uppercase tracking-widest group-hover:translate-x-[-4px] transition-all flex items-center gap-2 disabled:opacity-20"
                                                        >
                                                            <Edit size={14} /> Editar
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pending Invitations Section */}
                    {pendingInvites.length > 0 && (
                        <div className="border-t border-gray-100">
                            <div className="p-8 bg-orange-50/30">
                                <h3 className="text-xl font-black text-gray-800 flex items-center gap-3 mb-6">
                                    <span className="bg-orange-100 text-orange-600 p-2 rounded-lg"><User size={20} /></span>
                                    Invitaciones Pendientes
                                    <span className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded-md font-bold">{pendingInvites.length}</span>
                                </h3>
                                <div className="space-y-3">
                                    {pendingInvites.map((invite: any) => (
                                        <div key={invite.email} className="flex items-center justify-between bg-white p-4 rounded-2xl border border-orange-100 shadow-sm">
                                            <div className="flex items-center gap-4">
                                                <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                                                    {invite.email[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-gray-900">{invite.email}</p>
                                                    <p className="text-xs text-orange-400 font-medium">Esperando registro (Rol: {invite.role})</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleResendInvite({
                                                        email: invite.email,
                                                        full_name: invite.full_name || null,
                                                        role: invite.role || 'seller'
                                                    })}
                                                    disabled={resendingInviteEmail === invite.email}
                                                    className="text-indigo-600 hover:text-indigo-700 px-3 py-2 hover:bg-indigo-50 rounded-lg transition-all font-black text-[10px] uppercase tracking-widest flex items-center gap-2 disabled:opacity-40"
                                                >
                                                    <Mail size={14} />
                                                    {resendingInviteEmail === invite.email ? 'Enviando...' : 'Reenviar'}
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        if (confirm(`¿Eliminar invitación para ${invite.email}?`)) {
                                                            await supabase.from('user_whitelist').delete().eq('email', invite.email);
                                                            fetchPendingInvites();
                                                        }
                                                    }}
                                                    className="text-gray-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-all"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : activeTab === 'permissions' ? (
                <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                    <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
                        <div>
                            <h3 className="text-2xl font-black text-gray-800 flex items-center gap-3"><Shield className="text-indigo-600" /> Matriz de Permisos</h3>
                            <p className="text-sm text-gray-400 font-bold mt-1 uppercase tracking-wider">Configura qué puede hacer cada perfil</p>
                        </div>
                        <button
                            onClick={handleSaveRolePermissions}
                            disabled={savingPerms}
                            className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center gap-2 transition-all ${savingPerms ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'}`}
                        >
                            {savingPerms ? 'Sincronizando...' : <><Save size={16} /> Aplicar Cambios</>}
                        </button>
                    </div>

                    <div className="overflow-x-auto p-4">
                        <table className="w-full border-separate border-spacing-2">
                            <thead>
                                <tr>
                                    <th className="p-4 text-left text-xs font-black text-gray-400 uppercase tracking-widest bg-gray-50 rounded-xl">Módulo / Capacidad</th>
                                    {roles.map(role => (
                                        <th key={role} className="p-4 text-center text-[10px] font-black uppercase tracking-widest bg-gray-50 rounded-xl min-w-[120px]">
                                            <span className={role === 'admin' ? 'text-indigo-600' : 'text-gray-600'}>
                                                {role === 'admin' ? 'Admin (Fijo)' : role}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {permissionList.map(perm => (
                                    <tr key={perm.key} className="group hover:bg-gray-50/50 transition-colors">
                                        <td className="p-6">
                                            <p className="font-black text-gray-800 text-sm leading-none">{perm.label}</p>
                                            <p className="text-[10px] text-gray-400 font-bold mt-1.5 leading-tight">{perm.desc}</p>
                                        </td>
                                        {roles.map(role => {
                                            const isActive = role === 'admin' || (rolePerms[role] || []).includes(perm.key);
                                            return (
                                                <td key={role} className="p-4 text-center">
                                                    <button
                                                        onClick={() => handleTogglePermission(role, perm.key)}
                                                        disabled={role === 'admin'}
                                                        className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isActive
                                                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 scale-105'
                                                            : 'bg-gray-100 text-gray-300 hover:bg-gray-200'
                                                            } ${role === 'admin' ? 'cursor-default opacity-80' : ''}`}
                                                    >
                                                        {isActive ? <CheckCircle size={20} /> : <Ban size={20} />}
                                                    </button>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                // NEW: Integrations Tab
                <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden p-8 space-y-8">
                    <div>
                        <h3 className="text-2xl font-black text-gray-800 flex items-center gap-3">Integraciones & Diagnóstico</h3>
                        <p className="text-sm text-gray-400 font-bold mt-1 uppercase tracking-wider">Verifica el estado de tus conexiones externas</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Google Calendar Card */}
                        <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-bold text-2xl">
                                    G
                                </div>
                                <div>
                                    <h4 className="text-lg font-black text-gray-900">Google Calendar</h4>
                                    <p className="text-xs text-gray-500 font-medium">Sincronización de eventos y visitas</p>
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-2xl p-6 mb-6">
                                <p className="text-sm text-gray-600 font-medium leading-relaxed">
                                    Verifica si el sistema tiene permiso para leer y escribir en tu calendario. Si falta un refresh token, usa reconexión explícita sin cerrar sesión.
                                </p>
                            </div>

                            <div className="rounded-2xl border border-gray-100 p-4 mb-4 space-y-2">
                                <p className="text-[10px] uppercase tracking-widest font-black text-gray-400">Estado Google</p>
                                {loadingGoogleStatus ? (
                                    <p className="text-sm font-bold text-gray-500">Consultando conexión...</p>
                                ) : googleStatus ? (
                                    <>
                                        <p className={`text-sm font-black ${googleStatus.needsReconnect ? 'text-amber-600' : 'text-emerald-600'}`}>
                                            {googleStatus.needsReconnect ? 'Reconexión requerida' : 'Renovación automática activa'}
                                        </p>
                                        <p className="text-xs text-gray-500 font-medium">
                                            Cuenta: {googleStatus.googleEmail || profile?.email || 'Sin cuenta'}
                                        </p>
                                        {googleStatus.lastRefreshAt && (
                                            <p className="text-xs text-gray-500 font-medium">
                                                Última renovación: {new Date(googleStatus.lastRefreshAt).toLocaleString('es-CL')}
                                            </p>
                                        )}
                                        {googleStatus.lastError && (
                                            <p className="text-xs text-rose-600 font-bold">
                                                Último error: {googleStatus.lastError}
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm font-bold text-gray-500">Sin diagnóstico disponible.</p>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button
                                    onClick={handleTestGoogleSync}
                                    disabled={testingSync}
                                    className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2
                                    ${testingSync ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-indigo-200'}`}
                                >
                                    {testingSync ? 'Verificando...' : 'Probar Conexión'}
                                </button>
                                <button
                                    onClick={() => void googleService.startReconnect()}
                                    className="w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest border border-gray-200 text-gray-700 hover:bg-gray-50 transition-all"
                                >
                                    Reconectar Google
                                </button>
                            </div>

                            <p className="text-[11px] text-gray-400 font-medium">
                                Para ver calendarios ajenos, Google Workspace debe compartir esos calendarios corporativos con jefes o admins.
                            </p>
                        </div>
                    </div>
                </div>
            )
            }

            {
                isInviteModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-md bg-black/40">
                        <div className="bg-white rounded-[3rem] w-full max-w-xl p-12 shadow-2xl relative border border-gray-100">
                            <h3 className="text-4xl font-black text-gray-900 mb-2">Crear Invitación</h3>
                            <form onSubmit={handleInviteUser} className="space-y-8">
                                <input required type="text" value={inviteData.full_name} onChange={e => setInviteData(p => ({ ...p, full_name: e.target.value }))} className="w-full h-16 px-8 bg-gray-50 border-none rounded-2xl font-black" placeholder="Nombre" />
                                <input required type="email" value={inviteData.email} onChange={e => setInviteData(p => ({ ...p, email: e.target.value.toLowerCase() }))} className="w-full h-16 px-8 bg-gray-50 border-none rounded-2xl font-black" placeholder="Email" />

                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Rol / Perfil</label>
                                    <select
                                        value={inviteData.role}
                                        onChange={e => setInviteData(p => ({ ...p, role: e.target.value }))}
                                        className="w-full h-16 px-8 bg-gray-50 border-none rounded-2xl font-black appearance-none focus:ring-4 focus:ring-indigo-500/10 transition-all uppercase"
                                    >
                                        <option value="seller">Vendedor</option>
                                        <option value="facturador">Facturador</option>
                                        <option value="jefe">Jefe de Ventas</option>
                                        <option value="driver">Repartidor</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>

                                <div className="flex gap-4 pt-4">
                                    <button type="button" onClick={() => setIsInviteModalOpen(false)} className="flex-1 h-16 rounded-2xl font-black text-gray-400 hover:bg-gray-50 transition-all">CANCELAR</button>
                                    <button type="submit" disabled={sendingInvite} className="flex-[2] h-16 bg-gray-900 text-white rounded-2xl font-black shadow-xl shadow-gray-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50">
                                        {sendingInvite ? 'ENVIANDO...' : 'CREAR INVITACIÓN'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default Settings;
