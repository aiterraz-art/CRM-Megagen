-- Aviso al móvil en cuanto entra un lead desde Meta.
--
-- Un lead de Meta se enfría en horas. Entra sin dueño a propósito, para que lo
-- reparta quien corresponda, pero sin un aviso nadie se entera de que llegó:
-- es exactamente lo que pasó con la carga de marzo, 37 leads esperando 205 días
-- en una bandeja que nadie abría.
--
-- Quién lo recibe se decide por permiso y no por nombre de rol, para que el
-- jefe pueda cambiar la lista desde Configuración sin tocar código.

INSERT INTO public.role_permissions (role, permission)
SELECT roles.role, 'RECEIVE_META_LEAD_ALERTS'
FROM (VALUES ('admin'), ('jefe')) AS roles(role)
WHERE NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = roles.role
      AND rp.permission = 'RECEIVE_META_LEAD_ALERTS'
);
