-- 1. Buscar el ID del usuario en auth.users por su correo
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Obtener el ID del usuario
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'aterraza@3dental.cl';
    
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'Usuario aterraza@3dental.cl no encontrado en auth.users';
        RETURN;
    END IF;

    -- 2. Asegurar que el perfil existe en la tabla profiles con el rol de administrador y estado activo
    -- Basado en FULL_DEPLOY_V2.sql: role IN ('manager', 'jefe', 'administrativo', 'seller', 'driver')
    -- Basado en FULL_DEPLOY_V2.sql: status IN ('pending', 'active', 'disabled')
    
    UPDATE public.profiles 
    SET 
        role = 'manager',
        status = 'active',
        updated_at = NOW()
    WHERE id = v_user_id;

    -- 3. Confirmar cambios
    RAISE NOTICE 'Usuario % actualizado a manager y estado activo.', v_user_id;
END $$;
