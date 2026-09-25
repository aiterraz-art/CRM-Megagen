import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Ban, Search, Shield, X } from 'lucide-react';
import { supabase } from '../../services/supabase';
import {
    PERMISSION_CATALOG,
    PERMISSION_MODULES,
    type PermissionOverrideEffect,
    fetchRolePermissionRows,
    fetchUserPermissionOverrides,
    normalizeRole,
    resolveRolePermissions
} from '../../utils/permissions';

type TargetUser = {
    id: string;
    email: string | null;
    full_name?: string | null;
    role: string | null;
};

interface Props {
    user: TargetUser | null;
    isOpen: boolean;
    onClose: () => void;
}

type Choice = 'role' | PermissionOverrideEffect;

const CHOICES: { value: Choice; label: string }[] = [
    { value: 'role', label: 'Según rol' },
    { value: 'grant', label: 'Permitir' },
    { value: 'deny', label: 'Denegar' }
];

const UserPermissionsModal = ({ user, isOpen, onClose }: Props) => {
    const [rolePermissions, setRolePermissions] = useState<string[]>([]);
    const [choices, setChoices] = useState<Record<string, Choice>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');

    const role = normalizeRole(user?.role);
    const isAdminTarget = role === 'admin';

    useEffect(() => {
        if (!isOpen || !user) return;
        let cancelled = false;
        setLoading(true);
        setSearch('');

        void (async () => {
            const [rows, overrides] = await Promise.all([
                fetchRolePermissionRows(),
                fetchUserPermissionOverrides(user.id)
            ]);
            if (cancelled) return;
            setRolePermissions(resolveRolePermissions(user.role, rows).permissions);
            setChoices(Object.fromEntries(overrides.map((override) => [override.permission, override.effect])));
            setLoading(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [isOpen, user]);

    const visiblePermissions = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return PERMISSION_CATALOG;
        return PERMISSION_CATALOG.filter((permission) =>
            permission.label.toLowerCase().includes(term) || permission.desc.toLowerCase().includes(term)
        );
    }, [search]);

    const overrideCount = Object.values(choices).filter((choice) => choice !== 'role').length;

    if (!isOpen || !user) return null;

    const setChoice = (permission: string, choice: Choice) => {
        setChoices((current) => ({ ...current, [permission]: choice }));
    };

    const guardar = async () => {
        setSaving(true);
        try {
            const overrides = Object.entries(choices)
                .filter(([, choice]) => choice !== 'role')
                .map(([permission, effect]) => ({ permission, effect }));

            const { error } = await supabase.rpc('set_user_permission_overrides', {
                p_user_id: user.id,
                p_overrides: overrides
            });

            if (error) throw error;
            onClose();
        } catch (error: any) {
            alert(`No se pudieron guardar los permisos: ${error?.message || 'error desconocido'}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white w-full max-w-3xl rounded-[2.5rem] p-8 shadow-2xl flex flex-col max-h-[90vh]">
                <div className="flex items-start justify-between mb-6">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Permisos individuales</p>
                        <h3 className="text-2xl font-black text-gray-900 mt-1">{user.full_name || user.email}</h3>
                        <p className="text-xs font-bold text-gray-400 mt-1">
                            Rol <span className="uppercase text-indigo-600">{role || 'sin rol'}</span>
                            {' · '}
                            {overrideCount === 0 ? 'sin excepciones' : `${overrideCount} excepción(es)`}
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100">
                        <X size={20} />
                    </button>
                </div>

                {isAdminTarget ? (
                    <div className="flex gap-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50 p-4">
                        <Shield size={20} className="shrink-0 text-indigo-600" />
                        <p className="text-xs font-bold text-indigo-900 leading-snug">
                            Un administrador siempre tiene todos los permisos, para que nadie pueda quedar
                            fuera de la configuración de accesos. Cambia su rol si necesitas limitarlo.
                        </p>
                    </div>
                ) : (
                    <>
                        <p className="text-xs font-medium text-gray-500 mb-4">
                            Por defecto la persona tiene lo que trae su rol. Marca <b>Permitir</b> o <b>Denegar</b> solo
                            para las excepciones; el resto sigue a la matriz de roles.
                        </p>

                        <div className="relative mb-4">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar permiso..."
                                className="w-full pl-11 pr-4 py-3 bg-gray-50 border-none rounded-xl font-medium focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto -mx-2 px-2">
                            {loading ? (
                                <p className="p-10 text-center text-gray-400 font-bold uppercase tracking-widest animate-pulse">Cargando...</p>
                            ) : PERMISSION_MODULES.map((module) => {
                                const modulePermissions = visiblePermissions.filter((permission) => permission.module === module.id);
                                if (modulePermissions.length === 0) return null;
                                return (
                                    <div key={module.id} className="divide-y divide-gray-100">
                                        <p className="pt-6 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-600">{module.label}</p>
                                        {modulePermissions.map((permission) => {
                                const choice = choices[permission.key] || 'role';
                                const fromRole = rolePermissions.includes(permission.key);
                                const effective = choice === 'role' ? fromRole : choice === 'grant';

                                return (
                                    <div key={permission.key} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="font-black text-gray-800 text-sm flex items-center gap-2">
                                                {effective
                                                    ? <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                                                    : <Ban size={16} className="text-gray-300 shrink-0" />}
                                                {permission.label}
                                            </p>
                                            <p className="text-[11px] text-gray-400 font-bold mt-1 leading-tight">{permission.desc}</p>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">
                                                Su rol: {fromRole ? 'lo tiene' : 'no lo tiene'}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 bg-gray-100 p-1 rounded-xl">
                                            {CHOICES.map((option) => {
                                                const active = choice === option.value;
                                                const activeClass = option.value === 'grant'
                                                    ? 'bg-emerald-600 text-white'
                                                    : option.value === 'deny'
                                                        ? 'bg-rose-600 text-white'
                                                        : 'bg-white text-indigo-600 shadow-sm';
                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        onClick={() => setChoice(permission.key, option.value)}
                                                        className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${active ? activeClass : 'text-gray-400 hover:text-gray-600'}`}
                                                    >
                                                        {option.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                                        })}
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            onClick={guardar}
                            disabled={saving || loading}
                            className="mt-6 w-full rounded-2xl bg-indigo-600 px-6 py-4 text-sm font-black uppercase tracking-widest text-white transition-all hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {saving ? 'Guardando...' : 'Guardar permisos'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default UserPermissionsModal;
