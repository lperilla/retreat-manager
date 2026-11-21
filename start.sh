#!/usr/bin/env bash
# Cartas del retiro: arrancar, parar, reiniciar, instalar…
#
#   ./start.sh              arranca el panel en segundo plano (y MongoDB si hace falta)
#   ./start.sh --install    instala dependencias y prepara .env y data/participants.json
#   ./start.sh --stop       para el panel y MongoDB (los datos se conservan)
#   ./start.sh --restart    reinicia el panel
#   ./start.sh --status     muestra qué está en marcha
#   ./start.sh --logs       muestra el registro (--follow para seguirlo)
#   ./start.sh --auth       autoriza el acceso de solo lectura a Gmail
#   ./start.sh --demo       arranca con datos de demostración
#   ./start.sh --help       todas las opciones
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "✖ No se encuentra Node.js. Instala Node.js 22 o superior (https://nodejs.org/) y vuelve a intentarlo." >&2
  exit 1
fi

exec node scripts/manage.js "$@"
