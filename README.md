# Local Kanban

Metodología local para planificar, coordinar y verificar proyectos largos desarrollados con Codex y subagentes. Markdown conserva el trabajo durable; la CLI y una SQLite local aplican las invariantes operativas; la web permite al humano observar y gobernar excepciones.

## Principios de uso

- Los agentes entran siempre por la skill canónica `$local-kanban`.
- La skill opera mediante la CLI `local-kanban`; los agentes no editan directamente `docs/kanban`, `.local-kanban` ni `config/projects.json`.
- La edición manual de Markdown queda reservada al humano para mantenimiento o recuperación excepcional.
- El orquestador coordina, integra y es el único rol que marca una historia como `done`.
- La UI es opcional para los agentes: el flujo debe funcionar con la web apagada.

## Instalación local

Requisitos: macOS, Node.js 22.13 o superior y npm.

```bash
cd /ruta/al/checkout/local-kanban
npm ci
npm link
npm run setup
npm run skill:verify
```

`npm link` expone el ejecutable `local-kanban`. `npm run setup` crea la configuración local
`config/projects.json` y enlaza la skill personal de forma idempotente:

```text
~/.agents/skills/local-kanban
  -> <este-repo>/skills/local-kanban
```

La fuente canónica permanece en [skills/local-kanban/SKILL.md](skills/local-kanban/SKILL.md). Al actualizar este repositorio, una nueva invocación de la skill carga la versión vigente sin mantener copias divergentes.

Consulta la guía completa en [docs/INSTALLATION_AND_SETUP.md](docs/INSTALLATION_AND_SETUP.md).

## Inicializar un proyecto consumidor

Desde la raíz Git del proyecto que se va a desarrollar:

```bash
local-kanban init --id mi-proyecto --name "Mi proyecto"
local-kanban validate
local-kanban doctor
```

`doctor` ejecuta validación de schemas y DAG, recovery seguro, integridad SQLite,
permisos/rutas, Git/worktrees y enlace de la skill. Devuelve `health: healthy|degraded`,
checks accionables y métricas compactas de auditoría, operaciones, claims y bloqueos.
Una cuarentena o corrupción hace fallar el diagnóstico; un entorno sin la skill instalada
queda degradado con la acción de reparación, sin ocultar el resto del informe.

`init` es idempotente y se encarga de:

- registrar o actualizar el proyecto en el registro central;
- crear `docs/kanban/epics` y `docs/kanban/stories`;
- crear `.local-kanban/` y añadirlo a `.gitignore`;
- añadir a `AGENTS.md` la cláusula de activación de `$local-kanban` sin reemplazar reglas existentes.

Los agentes deben invocar `$local-kanban` y consultar `local-kanban --help` antes de operar. No deben sustituir un comando ausente por una edición directa.

## UI humana

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API local: `http://localhost:4010`

La UI lee únicamente los proyectos registrados. `config/projects.json` puede inspeccionarse o corregirse manualmente por un humano en una recuperación excepcional, pero no forma parte del flujo normal de agentes.

La instancia de producción local escucha en `127.0.0.1:4010`. No expongas el servidor en una interfaz de red: la API no incorpora autenticación ni TLS y su modelo de confianza es exclusivamente local.

## Modelo funcional

Estados visibles:

```text
backlog -> developing -> testing -> done
```

Las historias usan IDs `STO-*`; las épicas, `EPI-*`. Readiness, bloqueos, claims, leases, intentos y revisión se gestionan mediante la skill y el núcleo de dominio, no mediante estados inventados ni edición libre del frontmatter.

## Verificación

```bash
npm run test:unit
npm run test:skill
npm run skill:smoke
npm run test:quality
npm run test:dogfood
npm run eval
npm run benchmark
npm run test:e2e
npm run build
```

La suite E2E usa un workspace aislado en `.e2e/` y no depende de los proyectos locales reales del usuario.
`eval` comprueba las invariantes agénticas críticas (claims concurrentes, leases,
checkpoint/handoff, bloqueo humano, fencing y cierre) y `benchmark` ejecuta un
fixture reproducible de 1.000 historias. Ambos son gates de CI.

Antes de versionar la metodología, `npm run release:verify` ejecuta todos los gates y
completa un flujo real desde un repositorio consumidor temporal con una instalación aislada
de la skill. `npm run skill:verify` comprueba por separado el symlink personal de este Mac.

## Documentación

- [Instalación y setup](docs/INSTALLATION_AND_SETUP.md)
- [Preparar un proyecto consumidor](docs/PROJECT_KANBAN_SETUP.md)
- [Arquitectura as-built](docs/ARCHITECTURE.md)
- [Skill canónica](skills/local-kanban/SKILL.md)
