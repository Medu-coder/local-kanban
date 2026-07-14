# Arquitectura de Local Kanban

**Fecha del análisis:** 2026-07-14

## Visión funcional

Local Kanban es una aplicación local multiproyecto para coordinar trabajo de desarrollo ejecutado por humanos y agentes.
No mantiene una base de datos propia: la fuente de verdad son archivos Markdown con frontmatter dentro de cada repositorio conectado.
El repositorio de la aplicación y los repositorios gestionados son dominios separados.
La aplicación vive en `KANBAN_ROOT`; cada proyecto externo se registra mediante una ruta absoluta en `config/projects.json`.
Cada proyecto externo aporta épicas en `docs/kanban/epics/*.md` e historias en `docs/kanban/stories/*.md`.
El nombre de cada archivo debe coincidir con el `id` de la entidad, por ejemplo `STO-001.md`.

El sistema tiene cuatro piezas funcionales:

1. La SPA React de `src/` ofrece vistas Kanban y grafo, filtros, edición y seguimiento.
2. El servidor Express monolítico de `server/index.js` lee, normaliza, valida y escribe Markdown.
3. Las skills de `skills/` definen el contrato operativo para instalar el sistema y para que los agentes trabajen sobre él.
4. La suite de `e2e/` verifica tanto el flujo humano por UI como el flujo de agente que modifica Markdown directamente.

## Límites y responsabilidades

### Repositorio Local Kanban

`config/projects.json` registra qué repositorios se observan; no existe endpoint para administrar ese registro.
`server/index.js` es la frontera de acceso a filesystem para la UI y concentra lectura, escritura, validación, agregados y sincronización.
`src/App.jsx` es el coordinador de estado de la SPA y compone las vistas y paneles laterales.
`skills/local-kanban-agent/SKILL.md` es la especificación normativa de operación para agentes.
`skills/local-kanban-installer/SKILL.md` define el proceso de instalación y conexión de proyectos.

### Repositorio externo conectado

El proyecto conectado conserva sus propias épicas e historias bajo el `docsPath` configurado, normalmente `docs/kanban`.
Debe contener un `AGENTS.md` raíz que importe la skill normativa mediante una ruta absoluta a `KANBAN_ROOT`.
Los agentes pueden modificar los `.md` directamente; la UI es un espejo visual y un editor alternativo de esos mismos archivos.
La aplicación no copia las entidades dentro de este repositorio ni introduce un almacén intermedio persistente.

## Modelo funcional

### Proyecto

Cada entrada de configuración contiene `id`, `name`, `rootPath` y `docsPath`.
`server/index.js::loadProjects()` resuelve `rootPath/docsPath`, carga ambas colecciones y devuelve el proyecto ya enriquecido.
El payload añade contadores globales por estado y las colecciones completas `epics` y `stories`.

### Épica

Una épica tiene identidad estable, título, descripción, etiquetas y cuerpo Markdown.
El backend calcula a partir de sus historias `storyCount`, `statusCounts`, `doneCount`, `progressScore`, `progressMax` y `progressPercent`.
El progreso es ponderado: `backlog=0`, `developing=1`, `testing=2` y `done=4`; no es solo porcentaje de historias terminadas.
Las historias sin vínculo se agrupan funcionalmente en la lane sintética `__no_epic__`, mostrada como “Sin épica”.

### Historia

La historia combina planificación, ejecución y trazabilidad.
Sus estados válidos son `backlog`, `developing`, `testing` y `done`; sus prioridades son `low`, `medium` y `high`.
`execution_mode` distingue `human`, `agent` e `hybrid`, mientras `agent_owner` asigna ownership técnico.
`story_type` clasifica `feature`, `bug`, `tech_debt`, `research` o `chore`.
`blocked_by`, `blocks` y `related_to` forman relaciones entre historias.
`context_files`, `agent_status_note` y `last_agent_update` contienen contexto y trazabilidad para el agente.
`subtasks` son objetos `{title, done}`; no son entidades independientes ni tienen endpoint propio más allá del toggle por índice.
`ready_criteria` y `done_criteria` aceptan criterios manuales o derivados.

### Criterios y dependencias

`server/index.js::enrichStories()` crea referencias hidratadas, detecta IDs huérfanos y calcula `isBlocked`.
Una dependencia bloquea mientras falte la historia referenciada o su estado no sea `done`.
Los criterios manuales persisten `checked`; los derivados calculan `checked` al leer y no se pueden alternar por API.
Las reglas derivadas disponibles son `dependencies_done`, `all_subtasks_done`, `has_assignee`, `has_agent_owner`, `has_context_files` y `story_in_testing`.
`readyCriteriaProgress.isComplete` es verdadero si todos los criterios existentes están cumplidos; un checklist ready vacío se considera completo.
`doneCriteriaProgress.isComplete` exige al menos un criterio y que todos estén cumplidos; un checklist done vacío nunca valida el cierre.
`isReadyForDeveloping` combina ausencia de bloqueo y ready completo.
`isDoneValidated` refleja done criteria, pero el backend no impide técnicamente mover a `done`; esa prohibición se impone en el contrato del agente.

## Flujo de lectura y sincronización

1. La SPA llama `fetchProjects()` en `src/lib/api.js`, que ejecuta `GET /api/projects`.
2. `server/index.js::loadProjects()` relee `config/projects.json` y todos los `.md` de cada petición; no usa caché de entidades.
3. `gray-matter` separa frontmatter y cuerpo, y las funciones `coerce*` normalizan estructuras legacy o inválidas.
4. `enrichStories()` resuelve vínculos, criterios, readiness y títulos de épica.
5. `loadProjects()` agrega progreso de épicas y contadores globales.
6. `src/App.jsx` guarda el payload en memoria y deriva `visibleProject` aplicando filtros de épica, modo de ejecución y texto.
7. `fs.watch` observa configuración y directorios Markdown; los cambios se agrupan con debounce y se notifican por `GET /api/events` usando SSE.
8. Al recibir `refresh`, `src/App.jsx` vuelve a pedir el snapshot completo y serializa refrescos concurrentes mediante refs de promesa/cola.

Este diseño hace que una edición directa de un agente aparezca en la UI sin que el agente use la API.
La sincronización es eventual y local: depende de los watchers del sistema operativo y, como respaldo funcional, una recarga fuerza una lectura completa.

## Flujo de escritura desde la UI

La SPA encapsula HTTP en `src/lib/api.js` y mantiene estado de edición en `src/App.jsx`.
Crear o editar una historia pasa por `StoryEditor`, se normaliza a camelCase y se envía al servidor.
El servidor transforma camelCase API a snake_case Markdown mediante `sanitizeStoryFrontmatter()`.
Los `PUT` son reemplazos completos: omitir un campo provoca que `sanitizeStoryPayload()` aplique su default y reescriba el archivo con ese valor.
Los cambios puntuales de estado, movimiento, subtarea o criterio tienen endpoints dedicados que preservan el resto del frontmatter original.
Crear una entidad deriva el ID desde el título si no se suministra: `STO-<slug>` o `EPI-<slug>`.
Antes de crear, el backend comprueba si ya existe el archivo objetivo y devuelve conflicto.

El drag and drop de `src/components/KanbanBoard.jsx` aplica primero una actualización optimista en `src/App.jsx`.
Después llama `POST /move`; si falla, muestra el error y recarga el snapshot para revertir la vista a la fuente de verdad.
El movimiento puede cambiar simultáneamente estado y épica, y `epicId: null` deja la historia sin épica.
Los toggles de subtarea y criterio también se reflejan optimistamente en el panel y después se reconcilian con una recarga.

## API local

`GET /api/projects` devuelve catálogos válidos y el snapshot enriquecido de todos los proyectos.
`GET /api/events` mantiene el canal SSE de refresco.
`POST /api/projects/:projectId/stories` crea historias.
`PUT /api/projects/:projectId/stories/:storyId` reemplaza completamente historias existentes sin cambiar su ID.
`POST /api/projects/:projectId/stories/:storyId/status` cambia solo el estado.
`POST /api/projects/:projectId/stories/:storyId/move` cambia estado y vínculo con épica.
`POST /api/projects/:projectId/stories/:storyId/subtasks/:subtaskIndex/toggle` alterna una subtarea manual.
`POST /api/projects/:projectId/stories/:storyId/criteria/:criteriaType/:criteriaIndex/toggle` alterna criterios manuales ready/done.
`POST /api/projects/:projectId/epics` crea épicas.
`PUT /api/projects/:projectId/epics/:epicId` reemplaza completamente una épica.
`GET /api/health` sirve como prueba de vida para ejecución y E2E.
No hay endpoints de borrado, autenticación, registro de proyectos ni coordinación distribuida.

## Reglas de transición

El único gate técnico previsto de estado se aplica al entrar en `developing`.
Creación y edición completa comprueban directamente `isReadyForDeveloping`; el endpoint de cambio de estado valida la historia persistida antes de entrar.
Una historia que ya está en `developing` puede conservar ese estado aunque su readiness haya cambiado, por `canMoveToDeveloping()`.
Existe una discrepancia en `POST /move`: construye el override con el estado destino antes de llamar al gate, por lo que `canMoveToDeveloping()` lo interpreta como historia ya en developing y permite el movimiento aunque no esté ready.
Por tanto, el drag and drop puede eludir actualmente un bloqueo que sí aplican creación, edición completa y `POST /status`.
El backend permite saltos entre estados y no exige pasar secuencialmente por testing.
El contrato de `skills/local-kanban-agent/SKILL.md` añade reglas operativas más estrictas: ownership, actualizaciones de trazabilidad, validación E2E y cierre sin pendientes.

## Arquitectura del frontend

`src/main.jsx` monta un único `App` sin router ni store externo.
`src/App.jsx` posee el estado de proyecto activo, vista, filtros, paneles, editores, drag, sincronización y preferencias de densidad.
`ProjectSidebar` selecciona proyecto y alterna Kanban/grafo.
`Toolbar` filtra y abre creación o gestión de épicas.
`KanbanBoard` deriva lanes y columnas desde el snapshot visible y emite acciones hacia `App`.
`StoryGraphView` convierte el mismo snapshot con `src/lib/graph.js` y usa D3 force para disposición y navegación relacional.
`StoryDetail` y `EpicDetail` son vistas operativas; `StoryEditor`, `EpicEditor` y `EpicManager` concentran escritura y gestión.
No hay routing por URL: cambiar vista o selección solo altera estado React local.
Solo la densidad visual persiste en `localStorage`; selección, filtros y paneles se reinician al recargar.

## Vista grafo

`src/lib/graph.js::buildStoryGraph()` genera nodos de épica e historia y aristas de pertenencia, bloqueo y relación.
Las dependencias huérfanas se muestran en detalle, pero no generan aristas si su historia no está en el snapshot visible.
La vista respeta el proyecto ya filtrado por `App`, por lo que búsqueda y filtros alteran también el subgrafo.
`StoryGraphView` añade simulación D3, filtros de visibilidad, zoom, pan, drag y foco de constelaciones.
El grafo es una proyección de lectura: no permite crear relaciones ni modificar entidades directamente.

## Operación por agentes

La arquitectura deliberadamente permite dos caminos equivalentes de escritura: API local o edición directa del Markdown.
La skill normativa recomienda endpoints específicos para actualizaciones parciales y exige leer antes de cualquier `PUT` completo.
El orquestador registra proyectos, crea y asigna trabajo, entrega contexto mínimo y delega una historia por owner.
El especialista comprueba readiness, mueve la historia, ejecuta subtareas, actualiza notas y timestamp, valida y deja `done` o bloqueo explícito.
Los repositorios externos deben importar este contrato mediante `AGENTS.md`, de modo que la semántica viaja con el proyecto aunque la UI sea opcional.

## Ejecución y despliegue local

En desarrollo, `npm run dev` ejecuta Vite y Express en paralelo; Vite proxyfica `/api` al puerto 4010.
En producción local, `npm run start` construye `dist/` y PM2 levanta `server/index.js`, que sirve tanto API como estáticos.
`HOST`, `PORT` y `KANBAN_CONFIG_PATH` permiten aislar instancias; Vite usa `VITE_PORT` y `VITE_API_PROXY_TARGET`.
`scripts/setup.js` crea o actualiza `config/projects.json` desde plantilla, argumentos o asistente interactivo.
`Launch_Kanban.command` y `Stop_Kanban.command` son accesos macOS sobre el ciclo PM2.

## Decisiones y consecuencias

- Markdown como almacenamiento hace el estado legible, versionable y editable por agentes sin depender de la UI.
- Releer todo en cada snapshot simplifica consistencia, pero el coste crece con número de proyectos e historias.
- Un servidor monolítico reduce piezas operativas, aunque mezcla persistencia, reglas de dominio, watchers y HTTP en `server/index.js`.
- La duplicación de cálculo de progreso entre servidor y `KanbanBoard` mantiene la vista filtrada correcta, pero crea dos implementaciones de la misma ponderación.
- Los reemplazos completos simplifican serialización, pero son peligrosos para agentes que envían campos incompletos o snake_case por API.
- Al no haber autenticación, el binding por defecto a `127.0.0.1` es parte importante del límite de seguridad previsto.
- Las reglas normativas son más estrictas que los gates técnicos; la corrección del cierre depende de que el agente cumpla la skill.
