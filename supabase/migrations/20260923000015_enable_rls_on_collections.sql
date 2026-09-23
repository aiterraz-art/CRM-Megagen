-- Control de acceso a cobranzas en la base de datos.
--
-- Hasta ahora las tablas de cobranzas no tenian seguridad a nivel de fila: el filtro que
-- limita a cada vendedor a su propia cartera vivia solo en el navegador. Cualquier usuario
-- autenticado podia pedir la tabla completa por la API y leer la cobranza de todos.
--
-- Las reglas reproducen exactamente lo que hoy muestra la pantalla:
--   - un vendedor ve unicamente los documentos asignados a el, por identificador o por
--     correo, que es como los cruza la aplicacion;
--   - los repartidores no tienen acceso, porque el modulo no aparece en su menu;
--   - los demas roles ven todo, igual que hoy.
--
-- Las cargas de archivos siguen funcionando: se ejecutan dentro de funciones SECURITY
-- DEFINER cuyo propietario es tambien el dueño de las tablas, de modo que no quedan
-- sujetas a estas politicas.

CREATE OR REPLACE FUNCTION public.can_see_collection(
    p_seller_id uuid,
    p_seller_email text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
-- Lee profiles para conocer el rol de quien consulta, asi que debe poder hacerlo con
-- independencia de las politicas que apliquen sobre esa tabla.
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_role text;
    v_email text;
BEGIN
    IF v_actor IS NULL THEN
        RETURN false;
    END IF;

    SELECT lower(coalesce(p.role, '')), lower(btrim(coalesce(p.email, '')))
    INTO v_role, v_email
    FROM public.profiles p
    WHERE p.id = v_actor;

    -- Misma normalizacion de roles historicos que aplica la aplicacion.
    v_role := CASE v_role
        WHEN 'manager' THEN 'admin'
        WHEN 'administrativo' THEN 'facturador'
        WHEN 'supervisor' THEN 'jefe'
        ELSE v_role
    END;

    IF v_role = 'driver' THEN
        RETURN false;
    END IF;

    IF v_role <> 'seller' THEN
        RETURN true;
    END IF;

    RETURN p_seller_id = v_actor
        OR (
            p_seller_email IS NOT NULL
            AND v_email <> ''
            AND lower(btrim(p_seller_email)) = v_email
        );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_see_collection(uuid, text) TO authenticated;

-- Documentos de cobranza -----------------------------------------------------------

ALTER TABLE public.collections_pending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collections_pending_select ON public.collections_pending;
CREATE POLICY collections_pending_select
ON public.collections_pending
FOR SELECT
TO authenticated
USING (public.can_see_collection(seller_id, seller_email));

-- Los descargos y los comprobantes se guardan actualizando la propia fila.
DROP POLICY IF EXISTS collections_pending_update ON public.collections_pending;
CREATE POLICY collections_pending_update
ON public.collections_pending
FOR UPDATE
TO authenticated
USING (public.can_see_collection(seller_id, seller_email))
WITH CHECK (public.can_see_collection(seller_id, seller_email));

-- Sin politicas de insercion ni borrado: solo las funciones de carga escriben aqui.

-- Lotes de importacion -------------------------------------------------------------

ALTER TABLE public.collections_import_batches ENABLE ROW LEVEL SECURITY;

-- Solo contienen el nombre del archivo y su fecha, sin datos por vendedor, y las vistas
-- los necesitan para resolver cual es el lote vigente.
DROP POLICY IF EXISTS collections_batches_select ON public.collections_import_batches;
CREATE POLICY collections_batches_select
ON public.collections_import_batches
FOR SELECT
TO authenticated
USING (true);

-- Comprobantes de pago -------------------------------------------------------------

ALTER TABLE public.collection_payment_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS collection_proofs_select ON public.collection_payment_proofs;
CREATE POLICY collection_proofs_select
ON public.collection_payment_proofs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.collections_pending cp
        WHERE cp.id = collection_id
          AND public.can_see_collection(cp.seller_id, cp.seller_email)
    )
);

DROP POLICY IF EXISTS collection_proofs_insert ON public.collection_payment_proofs;
CREATE POLICY collection_proofs_insert
ON public.collection_payment_proofs
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.collections_pending cp
        WHERE cp.id = collection_id
          AND public.can_see_collection(cp.seller_id, cp.seller_email)
    )
);

-- Vistas ----------------------------------------------------------------------------
--
-- La pantalla lee a traves de estas vistas. Sin security_invoker se evaluarian con los
-- permisos de su propietario y las politicas de arriba no tendrian ningun efecto.

DO $$
BEGIN
    IF current_setting('server_version_num')::int < 150000 THEN
        RAISE EXCEPTION 'Se requiere PostgreSQL 15 o superior para aplicar RLS sobre estas vistas';
    END IF;

    EXECUTE 'ALTER VIEW public.vw_collections_pending_current SET (security_invoker = on)';
    EXECUTE 'ALTER VIEW public.vw_collections_paid_history SET (security_invoker = on)';
    EXECUTE 'ALTER VIEW public.vw_collections_seller_summary_current SET (security_invoker = on)';
END $$;
