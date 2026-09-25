import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Mismo criterio que las politicas de la base: permisos del rol mas las excepciones
// por persona, con el admin siempre habilitado (public.user_has_permission).
export const userHasPermission = async (serviceClient: SupabaseClient, userId: string, permission: string) => {
  const { data, error } = await serviceClient.rpc("user_has_permission", {
    p_user_id: userId,
    p_permission: permission,
  });
  if (error) throw error;
  return data === true;
};

// Usuarios activos que tienen el permiso, para decidir destinatarios de avisos.
export const usersWithPermission = async (serviceClient: SupabaseClient, permission: string) => {
  const { data, error } = await serviceClient.rpc("users_with_permission", { p_permission: permission });
  if (error) throw error;
  return ((data || []) as { user_id: string }[]).map((row) => row.user_id);
};
