-- Gestiones virtuales: llamadas, WhatsApp, videollamadas y correos registrados como visitas.
--
-- * Una gestion virtual es una fila de visits con type = 'virtual'. Asi entra sola en el
--   historial de visitas, en la meta diaria, en la ultima actividad del cliente
--   (vw_client_last_activity) y en la conversion via orders.visit_id / quotations.source_visit_id.
-- * channel: medio usado. Obligatorio cuando type = 'virtual'.
-- * outcome ya existia pero nadie lo escribia; ahora guarda el resultado tipificado.
-- * duration_minutes: duracion declarada por el vendedor (el cronometro puede quedar corriendo).
-- * next_action_at / follow_up_task_id: proximo paso y la tarea de seguimiento creada al cerrar.
-- * Las restricciones se agregan NOT VALID para no revisar filas historicas.

ALTER TABLE public.visits
    ADD COLUMN IF NOT EXISTS channel text,
    ADD COLUMN IF NOT EXISTS duration_minutes integer,
    ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
    ADD COLUMN IF NOT EXISTS follow_up_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_channel_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_channel_check
    CHECK (channel IS NULL OR channel IN ('call', 'whatsapp', 'video', 'email')) NOT VALID;

ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_virtual_channel_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_virtual_channel_check
    CHECK (type IS DISTINCT FROM 'virtual' OR channel IS NOT NULL) NOT VALID;

ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_outcome_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_outcome_check
    CHECK (outcome IS NULL OR outcome IN (
        'interested', 'quotation_sent', 'order_closed', 'follow_up',
        'no_answer', 'not_interested', 'wrong_contact'
    )) NOT VALID;

ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_duration_minutes_check;
ALTER TABLE public.visits ADD CONSTRAINT visits_duration_minutes_check
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 600) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_visits_virtual_rep_checkin
    ON public.visits (sales_rep_id, check_in_time)
    WHERE type = 'virtual';
