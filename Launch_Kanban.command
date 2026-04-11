#!/bin/bash
# Navegar al directorio donde está el script
cd "$(dirname "$0")"

# Asegurar que node y npm estén en el PATH (Homebrew standard)
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH

echo "------------------------------------------------"
echo "   Lanzando Local Kanban                        "
echo "------------------------------------------------"

# Verificar si dist existe, si no, construir
if [ ! -d "dist" ]; then
    echo ">> Detectada primera ejecución: Construyendo frontend..."
    npm run build
fi

# Iniciar el servidor en segundo plano con PM2
echo ">> Iniciando servidor en segundo plano..."
npm start

# Esperar a que el servidor responda antes de abrir el navegador
echo ">> Esperando a que el servidor esté listo..."
until curl -s -f http://localhost:4010 > /dev/null; do
    echo -n "."
    sleep 0.5
done
echo ""

# Abrir el navegador
echo ">> Abriendo navegador en http://localhost:4010..."
open http://localhost:4010

echo ">> ¡Listo! Puedes cerrar esta ventana."
sleep 3
exit
