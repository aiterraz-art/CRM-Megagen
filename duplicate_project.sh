#!/bin/bash

# ==========================================
# Script de Duplicación de Proyecto
# Origen: 3dental-CRM-v2-servidor-propio
# Destino: CRM MEGAGEN
# ==========================================

SOURCE_DIR=$(pwd)
PARENT_DIR=$(dirname "$SOURCE_DIR")
TARGET_DIR="$PARENT_DIR/CRM MEGAGEN"

echo "📍 Preparando duplicación..."
echo "📂 Origen: $SOURCE_DIR"
echo "📂 Destino: $TARGET_DIR"

# Verificar si el destino existe
if [ -d "$TARGET_DIR" ]; then
    echo "⚠️  El directorio destino ya existe. Por seguridad, abortando."
    exit 1
fi

echo "🚀 Iniciando copia (esto puede tardar unos segundos)..."
cp -R "$SOURCE_DIR" "$TARGET_DIR"

if [ $? -eq 0 ]; then
    echo "✅ Copia exitosa."
else
    echo "❌ Error al copiar."
    exit 1
fi

echo "🧹 Limpiando nueva carpeta (eliminando basura)..."
cd "$TARGET_DIR" || exit

# Eliminar carpetas innecesarias para empezar limpio
rm -rf .git
rm -rf node_modules
rm -rf .next
rm -rf .env
rm -rf .env.local
rm -rf dist

# Actualizar package.json
echo "📝 Actualizando package.json..."
# Usar sed para actualizar el nombre (compatible con macOS)
sed -i '' 's/"name": ".*"/"name": "crm-megagen"/' package.json

echo "✨ DUPLICACIÓN COMPLETADA ✨"
echo ""
echo "👉 Siguientes pasos OBLIGATORIOS:"
echo "1. Abre la nueva carpeta en tu editor: $TARGET_DIR"
echo "2. Crea un archivo .env.local con las credenciales de tu nuevo Supabase."
echo "3. Ejecuta 'npm install' para instalar dependencias."
echo "4. Ejecuta el script SQL 'supabase/migration_structure.sql' en tu panel de Supabase."
echo ""
