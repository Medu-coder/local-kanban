#!/bin/bash
# Navegar al directorio donde está el script
cd "$(dirname "$0")"

# Asegurar que node y npm estén en el PATH
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

echo "------------------------------------------------"
echo "   Deteniendo Local Kanban                      "
echo "------------------------------------------------"

# Detener el proceso con PM2
npm stop

echo ">> Servidor detenido correctamente."
sleep 2
exit
