# Scripts históricos — no ejecutar

Scripts SQL y de depuración que se usaban antes de ordenar el esquema en
`supabase/migrations/`. Se conservan solo como referencia histórica.

**No los ejecutes contra ninguna base.** Muchos crean políticas de seguridad que
deciden el acceso por nombre de rol (`profiles.role = 'admin'`, `IN ('jefe', ...)`),
algunas con permisos más amplios de los que hoy corresponden. Desde septiembre de
2026 todo el acceso se decide con permisos (`auth_user_has_permission`), y correr
cualquiera de estos scripts reabriría accesos o volvería a dejar a 3dental y
Megagen con reglas distintas.

Todo cambio de esquema va como migración nueva en `supabase/migrations/` y se
aplica en ambas instancias.
