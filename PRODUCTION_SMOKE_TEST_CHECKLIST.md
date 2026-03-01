# CRM Megagen - Smoke Test E2E (Multi-Instancia Supabase)

Ejecuta este checklist completo en **cada instancia** (Empresa A y Empresa B).

## 1) Pre-Flight (5 min)

1. Levanta frontend con el `.env` de la instancia a validar.
2. Inicia sesión con una cuenta Google Workspace de prueba por cada rol:
   - admin/manager
   - seller
   - driver
3. Verifica build local:
   - `npm run lint`
   - `npm run build`

Resultado esperado:
- Sin errores de compilación ni lint.

## 2) Agenda + Tareas (10 min)

1. Como supervisor/admin, abre `Agenda`.
2. Asigna una actividad interna para un vendedor desde `Asignar`.
3. Cierra y vuelve a abrir Agenda.
4. Verifica que:
   - aparece en calendario mensual
   - aparece en “Actividades Pendientes”
5. Repite con Google desconectado (o token no válido).

Resultado esperado:
- La actividad se guarda en CRM aunque falle Google.
- No se pierde el registro por falla de Google Calendar.

## 3) Visitas + Checkout + Dashboard (15 min)

1. Como seller, abre un cliente y registra visita.
2. Finaliza visita con notas desde:
   - barra global de visita
   - página de visita
3. Forzar cierre desde Dashboard (si hay visita en curso).

Resultado esperado:
- Solo navega/cierra si la visita quedó realmente en `completed`.
- Dashboard refleja visitas del día correctamente.
- No quedan “visitas fantasma” activas tras cierre exitoso.

## 4) Cotizaciones + GPS resiliente (15 min)

1. Como seller, crea cotización normal con GPS activo.
2. Crea otra cotización con GPS no disponible (sin ubicación manual).
3. Simula falla de red para inserción de ubicación (`seller_locations`) con DevTools:
   - bloquea request a `/rest/v1/seller_locations`
   - crea cotización
4. Restablece red y espera hasta 1 minuto.

Resultado esperado:
- La cotización se crea.
- Si falla ubicación, queda en cola local (`crm_location_queue_v1`).
- Al volver red, se vacía la cola y se inserta la ubicación pendiente.

## 5) Clientes + llamadas + importación (10 min)

1. Desde ficha de cliente, inicia llamada por botón teléfono.
2. Verifica creación de `call_logs` sin error de estado.
3. Importa clientes Excel con un RUT repetido.

Resultado esperado:
- Llamada se registra con estado válido.
- Duplicados por RUT se detectan sin romper importación masiva.

## 6) Despacho + Rutas (20 min)

1. Carga Excel de despacho con `RUT` + `PEDIDO`.
2. Verifica coincidencia correcta por `folio + rut`.
3. Genera ruta optimizada con pedidos:
   - algunos con coordenadas
   - algunos sin coordenadas
4. Crea ruta asignando conductor.

Resultado esperado:
- Match correcto de pedidos (sin falsos no-encontrados por folio ausente).
- Optimización no elimina ni desordena pedidos sin coordenadas.
- Ruta se crea en estado activo compatible (`in_progress` o `active`).
- Conteos en historial muestran pendientes/entregados correctamente.

## 7) Módulo Driver + Cierre de Ruta (15 min)

1. Como driver, abre Dashboard Driver y luego `/delivery`.
2. Entrega 1 pedido con foto.
3. Completa todos los pedidos de la ruta.

Resultado esperado:
- Driver ve rutas activas en ambos esquemas de estado.
- Cada entrega actualiza `orders.delivery_status` y `route_items.status`.
- Al terminar todos los ítems, la ruta pasa a `completed`.
- No quedan rutas activas con 0 pendientes.

## 8) TeamStats + contadores integrados (10 min)

1. Como manager/supervisor, abre TeamStats y cambia fecha.
2. Valida:
   - visitas del día
   - vendedores activos
   - ventas del mes (MTD)
   - pendientes de aprobación

Resultado esperado:
- Contadores coherentes con datos reales del día/mes.
- Sin inflación por histórico total.

## 9) Criterio de salida (Go/No-Go)

Marca **GO** solo si:
1. Ningún flujo crítico rompe navegación.
2. Rutas y entregas cierran en estado correcto.
3. Dashboard y TeamStats muestran cifras consistentes.
4. Ubicación de cotizaciones no se pierde en fallas de conexión (cola + reintento).

