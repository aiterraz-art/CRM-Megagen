import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useUser } from '../contexts/UserContext';
import { Shield, User, Search, CheckCircle, Ban, Edit, Save, AlertTriangle, Trash2 } from 'lucide-react';
import { Profile } from '../contexts/UserContext';

const Settings: React.FC = () => {
    const { profile, isSupervisor, hasPermission } = useUser();
    const [users, setUsers] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'users' | 'permissions' | 'integrations'>('users');
    const [testingSync, setTestingSync] = useState(false);

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

    const roles = ['jefe', 'administrativo', 'seller', 'driver'];
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
        { key: 'VIEW_ALL_TEAM_STATS', label: 'Ver Todo el Equipo', desc: 'Supervisión global (vs solo subordinados directos).' }
    ];

    useEffect(() => {
        fetchUsers();
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
                if (!matrix[p.role]) matrix[p.role] = [];
                matrix[p.role].push(p.permission);
            });
            setRolePerms(matrix);
        } else {
            setRolePerms({
                'manager': permissionList.map(p => p.key),
                'jefe': ['MANAGE_INVENTORY', 'VIEW_METAS', 'MANAGE_DISPATCH', 'VIEW_ALL_CLIENTS', 'VIEW_TEAM_STATS'],
                'administrativo': ['UPLOAD_EXCEL', 'MANAGE_INVENTORY', 'MANAGE_PRICING', 'MANAGE_DISPATCH'],
                'seller': ['VIEW_METAS'],
                'driver': ['EXECUTE_DELIVERY']
            });
        }
    };

    const fetchUsers = async () => {
        setLoading(true);
        try {
            // Solo consultamos public.profiles para evitar "usuarios fantasma" del esquema crm
            const { data, error } = await supabase.from('profiles').select('*').order('email');
            if (error) throw error;
            console.log("Settings Audit: Fetched Profiles:", data);
            setUsers((data || []) as Profile[]);
        } catch (error: any) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (id: string) => {
        try {
            const { error } = await supabase.from('profiles').update({
                role: tempRole,
                status: tempStatus,
                supervisor_id: tempSupervisor || null
            }).eq('id', id);

            if (error) {
                alert('Error al actualizar en tabla principal: ' + error.message);
                return;
            }

            try {
                await (supabase.schema('crm').from('profiles') as any).update({ role: tempRole, status: tempStatus }).eq('id', id);
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
        if (role === 'manager') return; // Manager always has everything
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
            // Transform matrix into array of rows
            const rows: any[] = [];

            // 1. Force 'manager' and 'admin' to always have EVERYTHING (Safety redundancy)
            permissionList.forEach(p => {
                rows.push({ role: 'manager', permission: p.key });
                rows.push({ role: 'admin', permission: p.key });
            });

            // 2. Add other roles from current state (excluding managers as we already forced them)
            Object.entries(rolePerms).forEach(([role, perms]) => {
                if (role === 'manager' || role === 'admin') return;
                perms.forEach(p => {
                    rows.push({ role, permission: p });
                });
            });

            // Delete existing and insert new (simplified sync)
            await supabase.from('role_permissions').delete().neq('role', 'super_admin_placeholder');
            const { error } = await supabase.from('role_permissions').insert(rows);

            if (error) throw error;
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
            // 1. Verify existence in Profiles or Whitelist
            const { data: existingProfile } = await supabase.from('profiles').select('id').eq('email', inviteData.email.toLowerCase()).maybeSingle();
            if (existingProfile) {
                alert("Este usuario ya está registrado en el sistema.");
                setSendingInvite(false);
                return;
            }

            const { data: existingWhitelist } = await supabase.from('user_whitelist').select('email').eq('email', inviteData.email.toLowerCase()).maybeSingle();
            if (existingWhitelist) {
                if (!confirm("Este usuario ya fue invitado previamente. ¿Deseas actualizar su rol y reenviar el correo?")) {
                    setSendingInvite(false);
                    return;
                }
            }

            // 2. Upsert to Whitelist
            const { error: whitelistError } = await supabase.from('user_whitelist').upsert({
                email: inviteData.email.toLowerCase(),
                role: inviteData.role,
                created_by: profile?.id
            });

            if (whitelistError) throw whitelistError;

            // 3. Send Email (Best Effort via Gmail API)
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const providerToken = (session as any)?.provider_token;

                if (providerToken) {
                    const subject = "Invitación a Megagen CRM 🏥";
                    const message = `Hola ${inviteData.full_name},\n\nHas sido invitado al CRM de Megagen con el rol de ${inviteData.role.toUpperCase()}.\n\nPara ingresar, simplemente inicia sesión con tu cuenta de Google (${inviteData.email}) en:\n\n${window.location.origin}/\n\nSaludos,\nEquipo Megagen`;

                    const utf8Encode = new TextEncoder();
                    const subjectEncoded = btoa(String.fromCharCode(...utf8Encode.encode(subject)));
                    const rawMimeMessage = [
                        `From: ${session?.user.email}`,
                        `To: ${inviteData.email}`,
                        `Subject: =?utf-8?B?${subjectEncoded}?=`,
                        'MIME-Version: 1.0',
                        'Content-Type: text/plain; charset="UTF-8"',
                        'Content-Transfer-Encoding: 7bit',
                        '',
                        message
                    ].join('\r\n');

                    await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${providerToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ raw: btoa(unescape(encodeURIComponent(rawMimeMessage))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') })
                    });
                    alert('✅ Invitación creada y correo enviado.');
                } else {
                    alert('⚠️ Invitación creada pero NO enviada (falta sesión Google). Notificar manualmente.');
                }
            } catch (mailErr: any) {
                console.warn("Mail verify error:", mailErr);
                const mailDetail = JSON.stringify(mailErr, Object.getOwnPropertyNames(mailErr), 2);
                alert(`⚠️ Invitación creada, pero falló el envío del correo.\n\nDetalle Correo:\n${mailDetail}`);
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

    const handleDeleteUser = async (id: string, email: string) => {
        if (email === 'aterraza@imegagen.cl' || !window.confirm(`¿BORRADO DEFINITIVO de ${email}?`)) return;

        try {
            // 1. Limpieza de Dependencias (Foreign Keys)
            await supabase.from('clients').update({ created_by: null }).eq('created_by', id);

            const { data: visits } = await supabase.from('visits').select('id').eq('sales_rep_id', id);
            if (visits && visits.length > 0) {
                const visitIds = visits.map(v => v.id);
                await supabase.from('orders').update({ visit_id: null }).in('visit_id', visitIds);
            }

            await supabase.from('visits').delete().eq('sales_rep_id', id);
            await supabase.from('quotations').update({ seller_id: null }).eq('seller_id', id);
            await supabase.from('delivery_routes').update({ driver_id: null }).eq('driver_id', id);
            await supabase.from('tasks').delete().eq('assigned_to', id);
            await supabase.from('tasks').delete().eq('assigned_by', id);
            await supabase.from('meta_config').delete().eq('id', id);

            // 2. Borrado Esquema CRM (Silencioso - best effort)
            try { await (supabase.schema('crm').from('profiles') as any).delete().eq('id', id); } catch (e) { }

            // 3. Borrado Final en esquema Public (Fuente de Verdad)
            const { error: pubErr } = await supabase.from('profiles').delete().eq('id', id);

            if (pubErr) throw pubErr;

            alert(`Usuario ${email} eliminado correctamente.`);
            fetchUsers();
        } catch (error: any) {
            console.error('Error al eliminar usuario:', error);
            alert('Error en el borrado: ' + error.message);
        }
    };

    const handleTestGoogleSync = async () => {
        setTestingSync(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const providerToken = (session as any)?.provider_token;

            if (!providerToken) {
                alert("❌ ERROR DE TOKEN:\nNo se detectó una sesión de Google activa.\n\nSolución: Cierra sesión en el CRM y vuelve a ingresar con Google para renovar el token.");
                return;
            }

            // Test call to Google Calendar API (List Calendars)
            const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
                headers: {
                    'Authorization': `Bearer ${providerToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                console.log("Google Sync Success:", data);
                alert(`✅ CONEXIÓN EXITOSA\n\nGoogle Calendar respondió correctamente.\nCalendarios detectados: ${data.items?.length || 0}\n\nLa sincronización está activa.`);
            } else {
                const errorText = await response.text();
                console.error("Google Sync Failed:", errorText);
                if (response.status === 401 || response.status === 403) {
                    alert("❌ ERROR DE PERMISOS (401/403):\nEl token de Google ha expirado o fue revocado.\n\nSolución: Cierra sesión y vuelve a entrar.");
                } else {
                    alert(`❌ ERROR DE CONEXIÓN (${response.status}):\n${errorText}`);
                }
            }
        } catch (error: any) {
            console.error("Test Error:", error);
            alert("❌ ERROR CRÍTICO:\n" + error.message);
        } finally {
            setTestingSync(false);
        }
    };

    if (!profile || (!isSupervisor && !hasPermission('MANAGE_USERS'))) return <div className="p-20 text-center font-bold">Acceso Denegado</div>;

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
                                                    <span className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${user.role === 'manager' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{user.role || 'Sin Rol'}</span>
                                                )}
                                            </td>
                                            <td className="px-8 py-6">
                                                {editingId === user.id ? (
                                                    <select value={tempStatus} onChange={(e) => setTempStatus(e.target.value)} className="bg-gray-50 border-none text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 block w-full p-3 font-bold shadow-sm">
                                                        <option value="pending">Pendiente</option>
                                                        <option value="active">Activo</option>
                                                        <option value="suspended">Suspendido</option>
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
                                                        {users.filter(u => u.id !== user.id && (u.role === 'jefe' || u.role === 'manager' || u.role === 'admin')).map(u => (
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
                                                        <button onClick={() => handleDeleteUser(user.id, user.email || '')} disabled={user.email === 'aterraza@imegagen.cl'} className="text-gray-300 hover:text-rose-500 transition-all disabled:opacity-0 hover:scale-125"><Trash2 size={18} /></button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingId(user.id);
                                                                setTempRole(user.role || 'seller');
                                                                setTempStatus(user.status || 'active');
                                                                setTempSupervisor(user.supervisor_id || null);
                                                            }}
                                                            disabled={user.email === 'aterraza@imegagen.cl'}
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
                                    {['manager', ...roles].map(role => (
                                        <th key={role} className="p-4 text-center text-[10px] font-black uppercase tracking-widest bg-gray-50 rounded-xl min-w-[120px]">
                                            <span className={role === 'manager' ? 'text-indigo-600' : 'text-gray-600'}>
                                                {role === 'manager' ? 'Manager (Fijo)' : role}
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
                                        {['manager', ...roles].map(role => {
                                            const isActive = role === 'manager' || (rolePerms[role] || []).includes(perm.key);
                                            return (
                                                <td key={role} className="p-4 text-center">
                                                    <button
                                                        onClick={() => handleTogglePermission(role, perm.key)}
                                                        disabled={role === 'manager'}
                                                        className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${isActive
                                                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 scale-105'
                                                            : 'bg-gray-100 text-gray-300 hover:bg-gray-200'
                                                            } ${role === 'manager' ? 'cursor-default opacity-80' : ''}`}
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
                                    Verifica si el sistema tiene permiso para leer y escribir en tu calendario. Si hay errores, usualmente se resuelven cerrando y re-iniciando sesión.
                                </p>
                            </div>

                            <button
                                onClick={handleTestGoogleSync}
                                disabled={testingSync}
                                className={`w-full py-4 rounded-xl font-black text-sm uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2
                                    ${testingSync ? 'bg-gray-100 text-gray-400 cursor-wait' : 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-indigo-200'}`}
                            >
                                {testingSync ? 'Verificando...' : 'Probar Conexión Ahora'}
                            </button>
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
                                        <option value="administrativo">Administrativo</option>
                                        <option value="jefe">Jefe de Ventas</option>
                                        <option value="driver">Repartidor</option>
                                        <option value="manager">Gerente / Admin</option>
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
