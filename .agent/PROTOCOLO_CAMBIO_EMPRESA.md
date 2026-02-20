# Protocolo Obligatorio: Cambio de Entorno Multi-Empresa

Este protocolo es de cumplimiento obligatorio para el asistente cada vez que el usuario solicite cambiar el entorno de trabajo entre **Megagen Chile** y **3Dental**.

## Pasos Técnicos Obligatorios

1.  **Identificación de Activos**:
    -   **Megagen**: Puerto `5174`, archivo `.env.megagen`, dominio `@imegagen.cl`.
    -   **3Dental**: Puerto `5175`, archivo `.env.3dental`, dominio `@3dental.cl`.

2.  **Limpieza de Procesos**:
    -   Antes de iniciar un nuevo entorno, se deben identificar y detener todos los procesos `vite` activos para evitar colisiones de puertos y sesiones de caché.

3.  **Verificación de Configuración (`.env`)**:
    -   Verificar el contenido del archivo `.env` específico de la empresa.
    -   **CRÍTICO**: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` deben ser los de la instancia correcta. Nunca asumir valores sin verificar contra `COOLIFY_ENV_COMPLETE.txt` o `DATOS_ACCESO_OAUTH.md`.

4.  **Ejecución de Servidor**:
    -   Usar únicamente los comandos script: `npm run dev:megagen` o `npm run dev:3dental`.

5.  **Validación de Redirección (OAuth)**:
    -   Asegurar que las URLs de redirección en el servidor (Coolify) incluyan el puerto local actual (5174 o 5175).

6.  **Verificación Visual**:
    -   Validar que el branding (logo y título) corresponda a la empresa solicitada tras el arranque.

## Restricciones
- Prohibido mezclar credenciales entre empresas.
- El cruce de datos se considera un fallo crítico.
