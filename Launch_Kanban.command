#!/bin/bash
set -euo pipefail

# Navegar al directorio donde está el script
cd "$(dirname "$0")"

# Asegurar que node y npm estén en el PATH (Homebrew standard)
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

readonly HEALTH_URL="http://127.0.0.1:4010/api/health"
readonly MAX_HEALTH_ATTEMPTS="${LOCAL_KANBAN_HEALTH_ATTEMPTS:-60}"

for command in node npm curl open; do
    if ! command -v "$command" >/dev/null 2>&1; then
        echo ">> Error: falta el comando requerido '$command'." >&2
        exit 1
    fi
done

if ! [[ "$MAX_HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
    echo ">> Error: LOCAL_KANBAN_HEALTH_ATTEMPTS debe ser un entero positivo." >&2
    exit 1
fi

echo "------------------------------------------------"
echo "   Lanzando Local Kanban                        "
echo "------------------------------------------------"

# Construir siempre para que el servicio use exactamente el código del checkout actual.
echo ">> Construyendo frontend de producción..."
npm run build

# Iniciar el servidor en segundo plano con PM2
echo ">> Iniciando servidor en segundo plano..."
npm start

# Esperar a que el servidor responda antes de abrir el navegador
echo ">> Esperando a que el servidor esté listo..."
attempt=1
until curl --silent --show-error --fail "$HEALTH_URL" >/dev/null 2>&1; do
    if (( attempt >= MAX_HEALTH_ATTEMPTS )); then
        echo "" >&2
        echo ">> Error: el servidor no respondió en $HEALTH_URL." >&2
        npm run status || true
        npm stop >/dev/null 2>&1 || true
        exit 1
    fi
    echo -n "."
    sleep 1
    ((attempt += 1))
done
echo ""

# Abrir el navegador
echo ">> Abriendo navegador en http://127.0.0.1:4010..."
open http://127.0.0.1:4010

echo ">> ¡Listo! Puedes cerrar esta ventana."
sleep 3
exit
