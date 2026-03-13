# Plan de Implementación: Avisos Programados por Telegram (Fase 1) con Ruta a WhatsApp (Fase 2)

## Resumen
Implementaremos un sistema de alertas operativas automatizadas para el CRM, empezando por **aprobaciones de cotización** y canal **Telegram** (según tu selección), usando la infraestructura actual de Supabase + Edge Functions + pg_cron.  
El diseño quedará listo para habilitar **WhatsApp** después sin rehacer arquitectura.

Decisiones cerradas para esta fase:
1. Canal inicial: **Telegram**.
2. Scheduler: **pg_cron** (con fallback definido si no está disponible).
3. Cobertura inicial: **solo aprobaciones pendientes**.
4. Política de aviso: **solo inmediato** (sin recordatorios funcionales de negocio).

---

## 1) Estado actual y base técnica existente
1. Ya existe `approval_requests` y flujo de creación desde cotizaciones.
2. Ya existe infraestructura de notificaciones web push (`send-approval-push`, `push_subscriptions`).
3. Ya existe módulo de Operaciones y tablas de automatización (`automation_rules`, `ops_alerts`, `sla_*`), pero no hay dispatcher de Telegram/WhatsApp.
4. No existe canal persistido por usuario para Telegram/WhatsApp.
5. No hay outbox transaccional para entrega confiable de avisos externos.

---

## 2) Arquitectura objetivo (Fase 1)
1. Evento de negocio: inserción de `approval_requests` con `status='pending'`.
2. Trigger SQL encola evento en tabla outbox (`notification_events`) con `event_key='approval_pending'`.
3. Job pg_cron ejecuta cada minuto una función de despacho SQL que invoca una Edge Function HTTP (vía `pg_net`).
4. Edge Function `dispatch-notification-event` envía Telegram a admin/jefe activos con canal habilitado.
5. Resultado se registra en `notification_deliveries` y se actualiza estado del outbox (`sent/failed`).
6. Idempotencia por `dedupe_key` para evitar avisos duplicados.

---

## 3) Cambios de base de datos (migraciones)
### 3.1 Nuevas tablas
1. `public.notification_channels`
   - `id uuid pk`
   - `user_id uuid fk -> profiles(id)`
   - `channel text check ('telegram','whatsapp')`
   - `destination text not null` (Telegram `chat_id`, WhatsApp `E.164`)
   - `is_active boolean default true`
   - `is_verified boolean default false`
   - `created_at timestamptz default now()`
   - `updated_at timestamptz default now()`
   - `unique(user_id, channel)`

2. `public.notification_events`
   - `id uuid pk`
   - `event_key text not null` (`approval_pending`, reservado para `daily_goal_gap`)
   - `entity_table text not null` (`approval_requests`)
   - `entity_id uuid not null`
   - `payload jsonb not null default '{}'`
   - `dedupe_key text not null unique`
   - `status text check ('queued','processing','sent','failed','cancelled') default 'queued'`
   - `scheduled_at timestamptz default now()`
   - `attempts int default 0`
   - `last_error text null`
   - `created_at timestamptz default now()`
   - `sent_at timestamptz null`

3. `public.notification_deliveries`
   - `id uuid pk`
   - `event_id uuid fk -> notification_events(id) on delete cascade`
   - `user_id uuid fk -> profiles(id)`
   - `channel text check ('telegram','whatsapp')`
   - `destination text`
   - `provider text` (`telegram_bot`, futuro `meta_whatsapp`)
   - `provider_message_id text null`
   - `status text check ('sent','failed','skipped')`
   - `error_message text null`
   - `created_at timestamptz default now()`

### 3.2 Funciones SQL
1. `enqueue_approval_notification()` trigger function:
   - `AFTER INSERT` en `approval_requests`.
   - Encola solo si `NEW.status='pending'`.
   - Construye `dedupe_key = 'approval_pending:' || NEW.id`.

2. `dispatch_queued_notifications(limit int default 100)`:
   - Toma eventos `queued` con `FOR UPDATE SKIP LOCKED`.
   - Marca `processing`.
   - Llama Edge Function por cada evento.
   - Marca `sent` o `failed`.

### 3.3 Trigger
1. `trg_approval_requests_enqueue_notification` sobre `approval_requests`.

### 3.4 RLS y seguridad
1. `notification_channels`:
   - Usuario ve/edita su canal.
   - Admin/jefe pueden ver todo.
2. `notification_events` y `notification_deliveries`:
   - Solo lectura admin/jefe.
   - Escritura solo backend service-role/definer.
3. `SECURITY DEFINER` en funciones operativas críticas.

---

## 4) Scheduler (pg_cron)
1. Validación inicial:
   - `select * from pg_extension where extname in ('pg_cron','pg_net');`
2. Si `pg_cron + pg_net` disponibles:
   - `cron.schedule('dispatch_notifications_every_minute', '* * * * *', $$ select public.dispatch_queued_notifications(100); $$);`
3. Fallback definido:
   - Si falta `pg_net`, ejecutar cron externo (Coolify/Make/N8N) que invoque endpoint de Edge Function cada minuto.
4. Aunque la política funcional es “solo inmediato”, el job de 1 minuto garantiza entrega casi inmediata y sin duplicados.

---

## 5) Edge Functions nuevas
1. `supabase/functions/dispatch-notification-event`
   - Input: `event_id`.
   - Carga evento y payload por service role.
   - Resuelve destinatarios `profiles.role in ('admin','jefe') and status='active'`.
   - Lee `notification_channels(channel='telegram', is_active=true, is_verified=true)`.
   - Compone mensaje estándar de aprobación.
   - Envía a Telegram API `sendMessage`.
   - Inserta `notification_deliveries`.
   - Retorna resumen de envíos.

2. `supabase/functions/verify-telegram-channel` (opcional pero recomendado)
   - Proceso de verificación de `chat_id` con token corto para marcar `is_verified`.

Secrets requeridos:
1. `TELEGRAM_BOT_TOKEN`
2. `NOTIFICATION_WEBHOOK_SECRET` (si se protege invocación)

---

## 6) Cambios de frontend
1. `Settings` → tab `Integraciones`:
   - Sección “Canales de aviso”.
   - Campos para Telegram `chat_id`.
   - Botón `Probar aviso` para enviar mensaje de test.
   - Switch `Activo/Inactivo`.

2. `OperationsCenter`:
   - Vista de entregas recientes desde `notification_deliveries`.
   - Estado por evento (`sent/failed`) y error visible.

3. No se cambia el flujo actual de web push; convivirá con Telegram.

---

## 7) Mensajería y contenido (Fase 1)
Formato mensaje aprobación (Telegram):
1. Título: `Nueva aprobación pendiente`.
2. Datos: vendedor, cliente, folio, porcentaje solicitado, monto.
3. CTA: link al módulo `/operations`.

Regla de negocio:
1. Un aviso por solicitud (`dedupe_key`).
2. Sin recordatorios funcionales.
3. Reintentos técnicos solo ante fallo de red/proveedor (máximo 3 intentos).

---

## 8) Ruta de evolución a WhatsApp (Fase 2)
1. Reutilizar las mismas tablas (`notification_channels`, `notification_events`, `notification_deliveries`).
2. Agregar provider `meta_whatsapp` en la Edge Function.
3. Añadir secretos:
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID` (si aplica)
4. Añadir plantillas aprobadas por Meta (mensaje transaccional de aprobación).
5. Habilitar selección de canal por regla (`telegram`, `whatsapp`, `both`).

---

## 9) Cambios importantes en APIs/interfaces/tipos públicos
1. `src/types/supabase.ts` debe incluir:
   - `notification_channels`
   - `notification_events`
   - `notification_deliveries`
2. Nuevas Edge Functions:
   - `dispatch-notification-event`
   - `verify-telegram-channel` (si se implementa verificación formal)
3. Nuevos contratos RPC/SQL:
   - `dispatch_queued_notifications(limit)`
   - trigger enqueue en `approval_requests`

---

## 10) Pruebas y escenarios de aceptación
1. Crear cotización con descuento extra que genere `approval_requests.pending`.
2. Verificar que se crea `notification_events` con `queued`.
3. Ejecutar scheduler y confirmar:
   - mensaje Telegram recibido por admin/jefe,
   - fila `notification_deliveries.status='sent'`,
   - evento en `notification_events.status='sent'`.
4. Verificar idempotencia:
   - no duplicar envío del mismo `approval_id`.
5. Usuario sin canal Telegram:
   - entrega `skipped`, evento no rompe pipeline.
6. Error de Telegram API:
   - `failed` con `last_error` y reintento técnico controlado.
7. Seguridad:
   - seller no puede leer ni manipular entregas globales.
8. Smoke multiempresa:
   - aplicar migración y validar en Megagen y 3Dental.

---

## 11) Rollout y operación
1. Deploy de migraciones.
2. Deploy Edge Functions.
3. Configuración de secrets.
4. Activar cron.
5. Cargar `chat_id` de admin/jefe y enviar test.
6. Activar trigger de aprobación.
7. Monitorear `notification_deliveries` 48h.

---

## Supuestos y defaults
1. Se implementa primero en ambas empresas para paridad operativa.
2. `pg_cron` es la vía principal de programación; si falta extensión, se usa cron externo sin cambiar modelo de datos.
3. Política de negocio inicial: solo evento de aprobación pendiente y solo aviso inmediato.
4. WhatsApp queda preparado en arquitectura, pero no activado en Fase 1.
