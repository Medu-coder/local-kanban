# Instalación y setup

Esta guía instala Local Kanban en un Mac, enlaza su skill canónica con Codex y prepara proyectos consumidores sin duplicar la metodología.

## Requisitos

- macOS.
- Node.js 22.13+ o Node.js 24 LTS; se recomienda Node 24 para instalaciones nuevas.
- npm.
- Codex con soporte de skills personales en `~/.agents/skills`.
- Uno o más repositorios Git locales que vayan a usar la metodología.

```bash
node --version
npm --version
```

No uses una rama `Current` en producción hasta que figure en la matriz de CI. Con Homebrew,
la actualización recomendada es `brew update && brew upgrade node@24`.

## 1. Instalar Local Kanban

```bash
cd /ruta/al/checkout/local-kanban
npm ci
npm link
npm run setup
```

`npm link` deja disponible el ejecutable `local-kanban` para invocarlo desde cualquier proyecto local.
`npm run setup` crea `config/projects.json` cuando falta y enlaza la skill canónica sin
sobrescribir una configuración ya existente.

## 2. Enlazar la skill canónica

Desde este repositorio:

```bash
npm run skill:verify
npm run skill:smoke
```

La instalación crea o repara de forma idempotente:

```text
~/.agents/skills/local-kanban
  -> <este-repo>/skills/local-kanban
```

No copies `SKILL.md` a otros directorios. El symlink garantiza que una actualización del repositorio sea visible para nuevas tareas de Codex. Una tarea que ya haya cargado la skill puede conservar la versión anterior hasta la siguiente invocación.

Si la ruta de destino ya existe y no es un symlink, el comando se detiene para no sobrescribir contenido personal. Muévela o elimínala manualmente después de comprobar qué contiene y repite la instalación.

## 3. Inicializar cada proyecto consumidor

Desde la raíz Git del proyecto:

```bash
cd /ruta/al/proyecto
local-kanban init --id mi-proyecto --name "Mi proyecto"
```

Opcionalmente puede elegirse una ruta durable distinta de `docs/kanban`:

```bash
local-kanban init --docs-path planning/kanban
```

`init` puede ejecutarse varias veces sin duplicar el registro. Crea la estructura, prepara el runtime local ignorado por Git, registra el proyecto en la UI y añade la cláusula de Local Kanban a `AGENTS.md` sin borrar instrucciones existentes.

El agente debe realizar esta operación a través de `$local-kanban`. No debe editar manualmente el registro central, el frontmatter o SQLite para simular la inicialización.

## 4. Verificar el proyecto

Desde el proyecto consumidor:

```bash
local-kanban validate
local-kanban doctor
```

El resultado de `doctor` incluye:

- `health: healthy` cuando todos los checks pasan, o `degraded` cuando existe una advertencia o fallo;
- checks de schemas/DAG, permisos y rutas, SQLite/recovery/cuarentena, Git/worktrees y skill canónica;
- métricas básicas de auditoría, operaciones, claims, intentos, checkpoints y bloqueos abiertos;
- una acción concreta para cada problema detectado.

`ok: false` significa que no debe continuar el flujo normal. Un warning mantiene
`ok: true`, pero el orquestador debe resolverlo antes de depender de la capacidad afectada.

Además, comprueba que:

- `AGENTS.md` indica que debe invocarse `$local-kanban`;
- existen `docs/kanban/epics` y `docs/kanban/stories`;
- `.gitignore` contiene `.local-kanban/`;
- el proyecto aparece una sola vez en `config/projects.json` de Local Kanban.

## 5. Arrancar la UI

Desde el repositorio Local Kanban:

```bash
npm run dev
```

Esto levanta:

- frontend Vite en `http://localhost:5173`;
- API local en `http://localhost:4010`.

Para el servicio administrado localmente:

```bash
npm run build
npm run start
npm run status
npm run logs
npm run restart
npm run stop
```

En macOS también puede hacerse doble clic en `Launch_Kanban.command`: construye el checkout
actual, inicia/reinicia PM2, espera con límite al health endpoint y solo entonces abre el
navegador. `Stop_Kanban.command` detiene el proceso. PM2 lo mantiene vivo mientras la sesión
local está activa, pero este repositorio no instala arranque automático tras reiniciar macOS.
PM2 concede 12 segundos al cierre ordenado antes de forzarlo, por encima de los 10 segundos
que el servidor reserva para completar la desconexión de clientes y watchers.

`start` y `restart` no terminan correctamente hasta que `/api/health` devuelve un payload
válido. El sondeo tiene 60 intentos, intervalo de un segundo y timeout de petición de un
segundo por defecto. Puede ajustarse con `LOCAL_KANBAN_HEALTH_ATTEMPTS`,
`LOCAL_KANBAN_HEALTH_INTERVAL_MS` y `LOCAL_KANBAN_HEALTH_REQUEST_TIMEOUT_MS`. Si se agota, el
comando falla con las acciones exactas para consultar estado y logs.

Después puedes confirmar manualmente el proceso y su diagnóstico:

```bash
npm run status
curl --fail http://127.0.0.1:4010/api/health
```

El endpoint alimenta el diagnóstico visible de la UI: devuelve `health: degraded` ante rutas
inaccesibles, cuarentenas o cierres `done` sin gate canónico, e incluye por proyecto causa,
impacto, siguiente acción y criterio de verificación. La UI sigue disponible en modo consulta
y permite seleccionar cualquier otro proyecto sano. `local-kanban doctor` añade además los
checks locales de Git, worktrees e instalación de la skill que no pertenecen al servidor web.

La UI no es necesaria para que los agentes operen; sirve para observación y control humano.
El servicio escucha en `127.0.0.1:4010` por defecto. No cambies `HOST` para exponerlo
a la red: la API no incorpora autenticación ni TLS y está diseñada para un único usuario local.
También rechaza `Host` y `Origin` no loopback. No uses `LOCAL_KANBAN_ALLOW_REMOTE=1` salvo que
otra capa aporte autenticación, TLS y filtrado de red.

## Actualizar la instalación

```bash
cd /ruta/a/local-kanban
git pull
npm ci
npm link
npm run setup
npm run skill:verify
npm run build
npm run restart
npm run status
curl --fail http://127.0.0.1:4010/api/health
```

Si la verificación del symlink falla, ejecuta `npm run skill:install` y vuelve a verificar.
`skill:smoke` comprueba además que la CLI global apunta a este checkout, inicializa un
repositorio consumidor temporal y completa una historia real hasta `done` con `doctor healthy`.

Antes de publicar una actualización del Kanban ejecuta también:

```bash
npm run release:verify
```

Este gate incluye checks, unitarios, evaluaciones, benchmark, auditoría de dependencias, build, E2E y una
instalación aislada de la skill. La verificación del symlink personal se mantiene como
comprobación local separada. Las evaluaciones son deterministas y cubren las invariantes de coordinación. El
benchmark usa `fixtures/long-project/scenario.json`; informa rendimiento para detectar
regresiones, pero su gate estable valida el resultado semántico, no un umbral temporal
dependiente de la máquina.

CI descarga Gitleaks 8.30.1 desde su release oficial, valida el SHA-256 fijado y escanea todo
el historial Git. No depende del runtime interno de `gitleaks-action`.

Consulta [TESTING.md](TESTING.md) para la matriz completa, los umbrales de cobertura y la
equivalencia exacta con CI.

## Backup y restauración

Para conservar tanto los contratos versionados como el historial operativo, detén primero el
servicio y cualquier agente activo, y copia juntos:

- el repositorio consumidor, incluido `docs/kanban/`;
- su `.local-kanban/runtime.sqlite`;
- `config/projects.json` de este checkout si quieres conservar el registro de la UI.

`runtime.sqlite` se crea al abrir por primera vez una operación que necesita runtime. Su
esquema puede regenerarse, pero los claims, intentos, auditoría y evidencias perdidos no pueden
deducirse íntegramente de los Markdown. Tras restaurar rutas, ejecuta en cada consumidor:

```bash
local-kanban init
local-kanban validate
local-kanban doctor
```

No copies una base mientras existen writers activos ni restaures solo uno de los dos lados de
una operación; eso produciría una divergencia que deberá reconciliarse explícitamente.

## Desinstalación

```bash
cd /ruta/a/local-kanban
npm run stop
npm unlink --global local-kanban
rm ~/.agents/skills/local-kanban
```

Antes de borrar el checkout, conserva o elimina conscientemente `config/projects.json`. En cada
proyecto consumidor, `docs/kanban/` es trabajo versionado y no debe borrarse por desinstalar la
herramienta. `.local-kanban/` solo puede eliminarse si aceptas perder su historial operativo.

## Administración humana excepcional

`config/projects.json` es el registro central de la UI. El flujo normal lo mantiene mediante `local-kanban init`. Un humano puede inspeccionarlo o repararlo manualmente si una recuperación lo exige, preservando rutas absolutas locales y sin publicar ese fichero con datos personales.

La edición manual de `docs/kanban/*.md` también es excepcional. Después de una intervención humana ejecuta `local-kanban validate` y `local-kanban doctor`; no edites nunca `.local-kanban/runtime.sqlite`.

## Resolución de problemas

### La skill no aparece en Codex

```bash
npm run skill:verify
ls -la ~/.agents/skills/local-kanban
```

Abre una tarea nueva después de reparar el enlace.

### `local-kanban` no está disponible

```bash
cd /ruta/a/local-kanban
npm link
local-kanban --help
```

### El proyecto no aparece en la UI

Ejecuta desde su raíz Git:

```bash
local-kanban init
local-kanban doctor
```

Comprueba después que la UI esté leyendo el mismo checkout de Local Kanban donde se registró el proyecto.

### El proyecto está degradado

No corrijas SQLite o el frontmatter a ciegas. Ejecuta:

```bash
local-kanban doctor --json
local-kanban reconcile --json
```

Cada issue explica causa, impacto, acción, comando y verificación. `invalid_document` se
corrige y valida; `revision_divergence` puede aceptar Markdown solo tras revisar el diff y
aportar `--reason`; `active_claim` exige resolver o liberar el intento; `pending_operation`
exige recovery; `missing_document` exige restaurar el fichero o escalar un borrado explícito.
No existe una resolución segura mediante edición directa de `.local-kanban/runtime.sqlite`.

Solo para fixtures de prueba antiguos, sin valor histórico:

```bash
local-kanban migrate-legacy --validation "git diff --check" --risk standard \
  --reason "Fixtures de prueba" --apply --json
local-kanban validate --json
local-kanban doctor --json
```

`--validation` mantiene el formato CSV para compatibilidad. Si un comando contiene comas,
usa el flag repetible `--validation-command "COMANDO LITERAL"`; al combinar ambos formatos,
los comandos CSV se ejecutan primero y después los literales en orden de aparición.

La migración reabre los `done` históricos en `testing`: no fabrica evidencia retrospectiva.
