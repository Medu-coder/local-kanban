#!/bin/bash
set -euo pipefail

# Navegar al directorio donde está el script
cd "$(dirname "$0")"

# Asegurar que node y npm estén en el PATH (Homebrew standard)
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

for command in node npm open; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo ">> Error: falta el comando requerido '$command'." >&2
        exit 1
    fi
done

echo "------------------------------------------------"
echo "   Lanzando Local Kanban                        "
echo "------------------------------------------------"

# Construir siempre para que el servicio use exactamente el código del checkout actual.
echo ">> Construyendo frontend de producción..."
npm run build

# Iniciar el servidor en segundo plano con PM2
echo ">> Iniciando servidor en segundo plano..."
npm start

# Abrir el navegador
echo ">> Abriendo navegador en http://127.0.0.1:4010..."
open http://127.0.0.1:4010

echo ">> ¡Listo! Puedes cerrar esta ventana."
sleep 3
exit
