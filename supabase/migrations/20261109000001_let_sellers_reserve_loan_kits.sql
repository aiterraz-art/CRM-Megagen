-- Una vendedora con REQUEST_KIT_LOANS no podía crear una solicitud: el trigger lee
-- el kit con SELECT ... FOR UPDATE, y ese bloqueo exige la política de UPDATE de
-- loan_kits (MANAGE_KIT_LOANS). Sin ella el kit no aparece y el trigger responde
-- "El kit solicitado no existe"; tampoco podría marcarlo como reservado.
-- El trigger valida por su cuenta el estado del kit, y quién puede insertar o
-- actualizar solicitudes lo siguen decidiendo las políticas de kit_loan_requests.
ALTER FUNCTION public.sync_kit_loan_request_state()
    SECURITY DEFINER
    SET search_path TO 'public';
