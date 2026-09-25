-- auth_user_has_any_role decidia accesos por nombre de rol. Tras la Fase 3 ninguna politica,
-- funcion ni vista la usa (verificado en ambas instancias), asi que se elimina para que no
-- vuelva a usarse: todo acceso se decide con auth_user_has_permission.
DROP FUNCTION IF EXISTS public.auth_user_has_any_role(text[]);

NOTIFY pgrst, 'reload schema';
