# Instalación y setup

Esta guía instala Local Kanban en un Mac, enlaza su skill canónica con Codex y prepara proyectos consumidores sin duplicar la metodología.

## Requisitos

- macOS.
- Node.js 22.13 o superior.
- npm.
- Codex con soporte de skills personales en `~/.agents/skills`.
- Uno o más repositorios Git locales que vayan a usar la metodología.

```bash
node --version
npm --version
```

## 1. Instalar Local Kanban

```bash
git clone <repo-url> local-kanban
cd local-kanban
npm install
npm link
```

`npm link` deja disponible el ejecutable `local-kanban` para invocarlo desde cualquier proyecto local.

## 2. Enlazar la skill canónica

Desde este repositorio:

```bash
npm run skill:install
npm run skill:verify
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
npm run start
npm run status
npm run stop
```

La UI no es necesaria para que los agentes operen; sirve para observación y control humano.

## Actualizar la instalación

```bash
cd /ruta/a/local-kanban
git pull
npm install
npm link
npm run skill:verify
```

Si la verificación del symlink falla, ejecuta `npm run skill:install` y vuelve a verificar.

Antes de publicar una actualización del Kanban ejecuta también:

```bash
npm run release:verify
```

Este gate incluye checks, unitarios, evaluaciones, benchmark, build, E2E y la
verificación local del symlink de la skill. Las evaluaciones son deterministas y cubren las invariantes de coordinación. El
benchmark usa `fixtures/long-project/scenario.json`; informa rendimiento para detectar
regresiones, pero su gate estable valida el resultado semántico, no un umbral temporal
dependiente de la máquina.

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

No corrijas SQLite o el frontmatter a ciegas. Invoca `$local-kanban`, ejecuta `local-kanban doctor` y sigue el diagnóstico. Si exige una decisión humana, conserva la entidad en cuarentena hasta resolverla.
