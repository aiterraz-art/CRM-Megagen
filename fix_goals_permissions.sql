-- 1. Habilitar seguridad nivel de fila (RLS)
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar políticas antiguas para evitar conflictos
DROP POLICY IF EXISTS "Users can view own goals" ON goals;
DROP POLICY IF EXISTS "Staff can view all goals" ON goals;
DROP POLICY IF EXISTS "Staff can upsert goals" ON goals;

-- 3. Crear política: Usuarios pueden ver sus propias metas
CREATE POLICY "Users can view own goals" ON goals
    FOR SELECT
    USING (auth.uid() = user_id);

-- 4. Crear política: Staff (Admin/Jefe/Supervisor) pueden ver TODAS las metas
CREATE POLICY "Staff can view all goals" ON goals
    FOR SELECT
    USING (
        (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'jefe', 'supervisor')
    );

-- 5. Crear política: Staff puede crear/editar metas
CREATE POLICY "Staff can upsert goals" ON goals
    FOR ALL
    USING (
        (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'jefe', 'supervisor')
    )
    WITH CHECK (
        (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'jefe', 'supervisor')
    );
