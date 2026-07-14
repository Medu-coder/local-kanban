#!/bin/bash
set -euo pipefail

# Navegar al directorio donde está el script
cd "$(dirname "$0")"

# Asegurar que node y npm estén en el PATH
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

if ! command -v npm >/dev/null 2>&1; then
    echo ">> Error: falta el comando requerido 'npm'." >&2
    exit 1
fi

echo "------------------------------------------------"
echo "   Deteniendo Local Kanban                      "
echo "------------------------------------------------"

# Detener el proceso con PM2
npm stop

echo ">> Servidor detenido correctamente."
sleep 2
exit
