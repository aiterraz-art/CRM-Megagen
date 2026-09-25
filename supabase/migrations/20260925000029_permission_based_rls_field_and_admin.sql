-- Lote 2 de la Fase 3: visitas, tareas, ubicaciones, leads, ajustes y usuarios pasan de
-- chequeos por rol a permisos. Mismo metodo que el lote 1: se conserva la condicion de
-- propiedad de cada politica y solo se reemplaza la lista de roles.
--
-- Permisos nuevos (misma asignacion que los roles tenian por nombre):
--   VIEW_TEAM_ACTIVITY y MANAGE_TEAM_ACTIVITY: admin, jefe, facturador, tesorero.
--   MANAGE_ORDER_NOTIFICATIONS: solo admin (destinatarios de los correos de pedidos).

INSERT INTO public.role_permissions (role, permission)
VALUES
    ('admin', 'VIEW_TEAM_ACTIVITY'), ('jefe', 'VIEW_TEAM_ACTIVITY'), ('facturador', 'VIEW_TEAM_ACTIVITY'), ('tesorero', 'VIEW_TEAM_ACTIVITY'),
    ('admin', 'MANAGE_TEAM_ACTIVITY'), ('jefe', 'MANAGE_TEAM_ACTIVITY'), ('facturador', 'MANAGE_TEAM_ACTIVITY'), ('tesorero', 'MANAGE_TEAM_ACTIVITY'),
    ('admin', 'MANAGE_ORDER_NOTIFICATIONS')
ON CONFLICT (role, permission) DO NOTHING;

DROP POLICY IF EXISTS "Visits select own or manager" ON public.visits;
CREATE POLICY "Visits select own or manager"
ON public.visits
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (((sales_rep_id = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_TEAM_ACTIVITY'))));

DROP POLICY IF EXISTS "Visits insert own or manager" ON public.visits;
CREATE POLICY "Visits insert own or manager"
ON public.visits
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (((sales_rep_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_TEAM_ACTIVITY'))));

DROP POLICY IF EXISTS "Visits update own or manager" ON public.visits;
CREATE POLICY "Visits update own or manager"
ON public.visits
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (((sales_rep_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_TEAM_ACTIVITY'))))
WITH CHECK (((sales_rep_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_TEAM_ACTIVITY'))));

DROP POLICY IF EXISTS "Visits delete own or manager" ON public.visits;
CREATE POLICY "Visits delete own or manager"
ON public.visits
AS PERMISSIVE
FOR DELETE
TO authenticated
USING (((sales_rep_id = auth.uid()) OR (SELECT public.auth_user_has_permission('MANAGE_TEAM_ACTIVITY'))));

DROP POLICY IF EXISTS "Visit photos select owner or leadership" ON public.visit_photos;
CREATE POLICY "Visit photos select owner or leadership"
ON public.visit_photos
AS PERMISSIVE
FOR SELECT
TO public
USING (((EXISTS ( SELECT 1 FROM visits v WHERE ((v.id = visit_photos.visit_id) AND (v.sales_rep_id = auth.uid())))) OR (SELECT public.auth_user_has_permission('VIEW_ALL_TEAM_STATS'))));

DROP POLICY IF EXISTS "Visit photos insert owner or leadership" ON public.visit_photos;
CREATE POLICY "Visit photos insert owner or leadership"
ON public.visit_photos
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK (((EXISTS ( SELECT 1 FROM visits v WHERE ((v.id = visit_photos.visit_id) AND (v.sales_rep_id = auth.uid())))) OR (SELECT public.auth_user_has_permission('VIEW_ALL_TEAM_STATS'))));

DROP POLICY IF EXISTS "Users can view own tasks or leadership" ON public.tasks;
CREATE POLICY "Users can view own tasks or leadership"
ON public.tasks
AS PERMISSIVE
FOR SELECT
TO public
USING (((auth.uid() = COALESCE(user_id, assigned_to)) OR (SELECT public.auth_user_has_permission('VIEW_TEAM_ACTIVITY'))));

DROP POLICY IF EXISTS "Public manage locations" ON public.seller_locations;
CREATE POLICY "Public manage locations"
ON public.seller_locations
AS PERMISSIVE
FOR ALL
TO public
USING (((seller_id = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_TEAM_ACTIVITY'))));

DROP POLICY IF EXISTS "Lead logs read own or manager" ON public.lead_message_logs;
CREATE POLICY "Lead logs read own or manager"
ON public.lead_message_logs
AS PERMISSIVE
FOR SELECT
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('VIEW_TEAM_ACTIVITY'))));

DROP POLICY IF EXISTS "Lead templates manage admin jefe" ON public.lead_message_templates;
CREATE POLICY "Lead templates manage admin jefe"
ON public.lead_message_templates
AS PERMISSIVE
FOR ALL
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_LEAD_TEMPLATES')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_LEAD_TEMPLATES')));

DROP POLICY IF EXISTS "Lead templates read" ON public.lead_message_templates;
CREATE POLICY "Lead templates read"
ON public.lead_message_templates
AS PERMISSIVE
FOR SELECT
TO public
USING ((SELECT public.auth_user_has_permission('VIEW_LEADS')));

DROP POLICY IF EXISTS "Lead attachments manage admin jefe" ON public.lead_message_attachments;
CREATE POLICY "Lead attachments manage admin jefe"
ON public.lead_message_attachments
AS PERMISSIVE
FOR ALL
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_LEAD_TEMPLATES')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_LEAD_TEMPLATES')));

DROP POLICY IF EXISTS "Lead attachments read" ON public.lead_message_attachments;
CREATE POLICY "Lead attachments read"
ON public.lead_message_attachments
AS PERMISSIVE
FOR SELECT
TO public
USING ((SELECT public.auth_user_has_permission('VIEW_LEADS')));

DROP POLICY IF EXISTS "Lead assets upload admin jefe" ON storage.objects;
CREATE POLICY "Lead assets upload admin jefe"
ON storage.objects
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK (((bucket_id = 'lead-assets'::text) AND (SELECT public.auth_user_has_permission('MANAGE_LEAD_TEMPLATES'))));

DROP POLICY IF EXISTS "Lead assets delete admin jefe" ON storage.objects;
CREATE POLICY "Lead assets delete admin jefe"
ON storage.objects
AS PERMISSIVE
FOR DELETE
TO public
USING (((bucket_id = 'lead-assets'::text) AND (SELECT public.auth_user_has_permission('MANAGE_LEAD_TEMPLATES'))));

DROP POLICY IF EXISTS "Lead assets read" ON storage.objects;
CREATE POLICY "Lead assets read"
ON storage.objects
AS PERMISSIVE
FOR SELECT
TO public
USING (((bucket_id = 'lead-assets'::text) AND (SELECT public.auth_user_has_permission('VIEW_LEADS'))));

DROP POLICY IF EXISTS "Payment proofs read owner or leadership" ON storage.objects;
CREATE POLICY "Payment proofs read owner or leadership"
ON storage.objects
AS PERMISSIVE
FOR SELECT
TO public
USING (((bucket_id = 'payment-proofs'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (SELECT public.auth_user_has_permission('VIEW_ALL_ORDERS')))));

DROP POLICY IF EXISTS "Payment proofs upload owner or leadership" ON storage.objects;
CREATE POLICY "Payment proofs upload owner or leadership"
ON storage.objects
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK (((bucket_id = 'payment-proofs'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (SELECT public.auth_user_has_permission('VIEW_ALL_ORDERS')))));

DROP POLICY IF EXISTS "Admins manage client followup settings" ON public.client_followup_settings;
CREATE POLICY "Admins manage client followup settings"
ON public.client_followup_settings
AS PERMISSIVE
FOR ALL
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_SALES_FLOW')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_SALES_FLOW')));

DROP POLICY IF EXISTS "Admins read client followup settings" ON public.client_followup_settings;
CREATE POLICY "Admins read client followup settings"
ON public.client_followup_settings
AS PERMISSIVE
FOR SELECT
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_SALES_FLOW')));

DROP POLICY IF EXISTS "Admins manage order notification settings" ON public.order_notification_settings;
CREATE POLICY "Admins manage order notification settings"
ON public.order_notification_settings
AS PERMISSIVE
FOR ALL
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_ORDER_NOTIFICATIONS')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_ORDER_NOTIFICATIONS')));

DROP POLICY IF EXISTS "Admins read order notification settings" ON public.order_notification_settings;
CREATE POLICY "Admins read order notification settings"
ON public.order_notification_settings
AS PERMISSIVE
FOR SELECT
TO authenticated
USING ((SELECT public.auth_user_has_permission('MANAGE_ORDER_NOTIFICATIONS')));

DROP POLICY IF EXISTS "Push subscriptions select own or manager" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions select own or manager"
ON public.push_subscriptions
AS PERMISSIVE
FOR SELECT
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('SEND_TEAM_PUSH'))));

DROP POLICY IF EXISTS "Push subscriptions delete own or manager" ON public.push_subscriptions;
CREATE POLICY "Push subscriptions delete own or manager"
ON public.push_subscriptions
AS PERMISSIVE
FOR DELETE
TO public
USING (((user_id = auth.uid()) OR (SELECT public.auth_user_has_permission('SEND_TEAM_PUSH'))));

DROP POLICY IF EXISTS "Whitelist admins manage" ON public.user_whitelist;
CREATE POLICY "Whitelist admins manage"
ON public.user_whitelist
AS PERMISSIVE
FOR ALL
TO public
USING ((SELECT public.auth_user_has_permission('MANAGE_USERS')))
WITH CHECK ((SELECT public.auth_user_has_permission('MANAGE_USERS')));

DROP POLICY IF EXISTS "Whitelist read own email" ON public.user_whitelist;
CREATE POLICY "Whitelist read own email"
ON public.user_whitelist
AS PERMISSIVE
FOR SELECT
TO public
USING (((lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text))) OR (SELECT public.auth_user_has_permission('MANAGE_USERS'))));

-- Tareas: en 3dental las escrituras estaban limitadas por rol; en Megagen la tabla tenia la
-- seguridad por filas desactivada y cualquier usuario podia leer y escribir todas las tareas.
-- Ambas instancias quedan con las mismas reglas: lo propio o asignado, o permiso de equipo.
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
CREATE POLICY "Users can insert their own tasks"
ON public.tasks
AS PERMISSIVE
FOR INSERT
TO public
WITH CHECK ((auth.uid() = COALESCE(user_id, assigned_to)) OR (SELECT public.auth_user_has_permission('MANAGE_TEAM_ACTIVITY')));

DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
CREATE POLICY "Users can update their own tasks"
ON public.tasks
AS PERMISSIVE
FOR UPDATE
TO public
USING ((auth.uid() = COALESCE(user_id, assigned_to)) OR (SELECT public.auth_user_has_permission('MANAGE_TEAM_ACTIVITY')));

DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;
CREATE POLICY "Users can delete their own tasks"
ON public.tasks
AS PERMISSIVE
FOR DELETE
TO public
USING ((auth.uid() = COALESCE(user_id, assigned_to)) OR (SELECT public.auth_user_has_permission('MANAGE_TEAM_ACTIVITY')));

NOTIFY pgrst, 'reload schema';
