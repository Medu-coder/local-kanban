# Arquitectura

Local Kanban es una metodología local para coordinar trabajo de desarrollo ejecutado por Codex. Los Markdown de cada proyecto conservan el estado durable y versionable; una SQLite local aplica coordinación, auditoría e invariantes operativas; la aplicación web ofrece observación y control humano.

## Límites del sistema

Local Kanban separa dos ámbitos:

- el checkout de esta aplicación contiene la CLI, la skill, el núcleo de dominio, la API y la SPA;
- cada proyecto consumidor conserva su propio `AGENTS.md`, `docs/kanban/` y `.local-kanban/runtime.sqlite`.

`config/projects.json` es un registro local de rutas absolutas para la UI. Se genera a partir de `config/projects.example.json`, no se versiona y se mantiene mediante `local-kanban init` durante el flujo normal.

## Fuente durable y runtime

Los documentos `docs/kanban/epics/*.md` y `docs/kanban/stories/*.md` son la representación durable. Su frontmatter cumple los JSON Schema versionados de `schemas/v1/`; el nombre del fichero coincide con el ID de la entidad.

`.local-kanban/runtime.sqlite` es un runtime reconstruible e ignorado por Git. Conserva:

- operaciones e idempotencia;
- revisiones, hashes y journal de escritura;
- claims, leases, fencing e intentos;
- checkpoints, bloqueos y evidencias;
- auditoría y cuarentenas.

SQLite no sustituye a los Markdown como resultado durable. Si aparece una divergencia o un documento inválido, la entidad se aísla en cuarentena en vez de normalizarse o sobrescribirse silenciosamente.

## Núcleo compartido

`core/` contiene las invariantes utilizadas por CLI y servidor:

- `schema.js`, `paths.js` y `atomic-write.js`: validación, confinamiento de rutas y persistencia atómica;
- `entity-repository.js`, `story-repository.js` y `reconciliation.js`: lectura, escritura, recovery y reconciliación;
- `story.js`, `entity-commands.js`, `commands.js` y `workflow-commands.js`: reglas de dominio y casos de uso;
- `runtime.js` y `coordination.js`: SQLite, scheduler, claims, leases, intentos y cápsulas operativas;
- `git.js` y `diagnostics.js`: worktrees y diagnóstico operativo.

Las mutaciones usan revisión esperada, claves de idempotencia y escritura temporal más `rename`. Un conflicto produce un error de dominio; no se aplica last-write-wins.

## Flujo agéntico

La entrada normativa es `skills/local-kanban/SKILL.md`. La skill invoca `bin/local-kanban.js`, que localiza la raíz Git y ejecuta el núcleo sin requerir que la UI esté activa.

El flujo normal es:

```text
init/doctor -> next -> claim -> ejecutar -> checkpoint/bloqueo -> validate -> complete
```

El orquestador es el único rol que integra y cierra. Los especialistas operan una historia reclamada y respetan el lease y el fencing token. Las historias de riesgo alto requieren una validación independiente antes del cierre.

## Aplicación web

`server/index.js` adapta el núcleo a HTTP, sirve el build de Vite y publica refrescos mediante SSE. La API es una interfaz local para la SPA, no la interfaz de automatización para agentes.

`src/` contiene una SPA React con tablero, grafo, detalle, edición, timeline y acciones administrativas acotadas. La UI es un control plane humano, no una segunda interfaz de ejecución para agentes: permite planificar contratos completos mientras una historia permanece en `backlog` y sin claim, pero reserva transiciones, checks y trabajo reclamado a la CLI con attempt y fencing. La reorganización por drag solo cambia la épica de historias no reclamadas en backlog. Las excepciones humanas destructivas requieren confirmación y quedan auditadas. Los watchers reconcilian cambios externos válidos y SSE actualiza la vista sin recarga manual.

El listener de producción se limita por defecto a `127.0.0.1:4010`. No hay autenticación ni TLS; el servidor rechaza otros hosts salvo opt-in explícito con `LOCAL_KANBAN_ALLOW_REMOTE=1`, que solo debe usarse detrás de una protección externa adecuada.

## Despliegue local

En desarrollo, `npm run dev` levanta Vite y Express. En producción local, el build se
genera durante la preparación del release; `npm run start` comprueba que existe y PM2
ejecuta una instancia de `server/index.js` según `ecosystem.config.cjs`.

La primera versión soportada es macOS con Node.js 22.13 o superior. No depende de servicios cloud, colas externas ni proveedores de identidad.

## Verificación

La calidad se comprueba por capas:

- tests Node del dominio, schemas, filesystem, concurrencia, recovery y CLI;
- evaluaciones deterministas del flujo agéntico;
- benchmark reproducible de scheduler;
- E2E Playwright de HTTP, UI y sincronización;
- build, auditoría de dependencias y secret scanning en CI.

El gate local completo es `npm run release:verify`. La definición ejecutable de los comandos vive en `package.json` y `.github/workflows/ci.yml`.
