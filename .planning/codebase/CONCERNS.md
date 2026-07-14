# Concerns del codebase

**Fecha del análisis:** 2026-07-14  
**Alcance:** deuda técnica, bugs potenciales, seguridad, rendimiento, consistencia funcional, fragilidad y límites del sistema. La prioridad considera que el producto está diseñado para que varios agentes modifiquen Markdown mientras la UI también puede escribir sobre esos mismos archivos.

## Resumen ejecutivo

- El mayor riesgo funcional es la escritura concurrente sin control: todas las mutaciones hacen ciclos `readFile` → modificación → `writeFile` sin bloqueo, versión ni escritura atómica en `server/index.js`. Dos agentes o un agente y la UI pueden perder cambios silenciosamente.
- Los identificadores suministrados por cliente se usan como parte de rutas de archivo sin una validación de formato o confinamiento. Un `id` con `../` puede escapar de `docs/kanban/stories` o `docs/kanban/epics` al crear contenido.
- El contrato normativo de agentes es considerablemente más estricto que lo que garantiza el backend. En particular, la API permite marcar historias como `done` con bloqueos, subtareas o criterios pendientes y no comprueba ownership ni `execution_mode`.
- La fuente de verdad Markdown es flexible, pero no existe una fase de validación estructural. IDs duplicados, nombres de archivo incoherentes, épicas inexistentes, ciclos y relaciones asimétricas pueden entrar al sistema y producir resultados ambiguos o invisibles.
- La cobertura E2E es valiosa para los flujos felices, pero faltan pruebas unitarias/de integración de las reglas centrales y pruebas de concurrencia, confinamiento de rutas y recuperación ante documentos inválidos.

## Riesgos críticos

### P0 — Path traversal mediante IDs de historias y épicas

- `sanitizeStoryPayload` y `sanitizeEpicPayload` solo aplican `trim()` al ID en `server/index.js`; después `writeStoryFile` y `writeEpicFile` interpolan directamente `${id}.md` en `path.join(...)`.
- Los endpoints `POST /api/projects/:projectId/stories` y `POST /api/projects/:projectId/epics` aceptan IDs explícitos. Valores como `../../archivo` pueden resolver fuera de las carpetas previstas.
- La UI deriva slugs seguros en `src/lib/story.js`, pero la API es pública para agentes y no puede depender de la UI como frontera de seguridad.
- Mitigación prioritaria: validar IDs con patrones cerrados (`STO-*`, `EPI-*`), rechazar separadores y comprobar con `path.resolve` que el destino permanece dentro del directorio autorizado.

### P0 — Pérdida de actualizaciones y corrupción por escrituras concurrentes

- Los toggles, movimientos y cambios de estado en `server/index.js` leen el archivo completo y luego lo sobrescriben. No hay mutex por archivo, ETag/revisión, compare-and-swap ni detección de modificación externa.
- `PUT` reemplaza además todos los campos; `skills/local-kanban-agent/SKILL.md` obliga a hacer GET, modificar y reenviar el objeto entero. Entre GET y PUT otro agente puede haber avanzado subtareas o actualizado notas, y el PUT posterior revierte ese trabajo.
- `fs.writeFile` escribe directamente sobre el archivo final. Una interrupción o lectura concurrente puede exponer contenido parcial; tampoco se usa archivo temporal más `rename` atómico.
- La comprobación de existencia previa a creación (`fs.access` y después `writeFile`) tiene una carrera TOCTOU: dos creadores pueden superar el chequeo y el último sobrescribe al primero.
- Mitigación prioritaria: serializar mutaciones por ruta, introducir una revisión/hash esperado y escribir de forma atómica; en creación usar apertura exclusiva (`wx`).

## Inconsistencias funcionales de alta prioridad

### P1 — El backend no hace cumplir el contrato de cierre

- `skills/local-kanban-agent/SKILL.md` prohíbe cerrar una historia con subtareas o criterios pendientes y exige validación real antes de `done`.
- Sin embargo, los endpoints de estado y movimiento de `server/index.js` solo llaman a `validateStoryStatusTransition` para el destino `developing`. Crear o actualizar una historia directamente en `done` también está permitido aunque `isDoneValidated` sea falso.
- Una dependencia abierta o huérfana tampoco impide `testing` ni `done`; `isBlocked` solo condiciona `isReadyForDeveloping`.
- El resultado es que la UI puede mostrar simultáneamente estado `done` y ausencia de “Done validado”, dejando la integridad a la disciplina del agente en vez de al sistema que coordina agentes.

### P1 — Ownership y modo de ejecución son solo metadatos

- El contrato en `skills/local-kanban-agent/SKILL.md` limita qué agente puede ejecutar cada historia según `execution_mode` y `agent_owner`.
- La API de `server/index.js` no autentica al llamante ni recibe identidad verificable; cualquier proceso puede crear, editar o mover cualquier historia, cambiar `agent_owner` o ejecutar historias `human`.
- Tampoco existe una operación atómica de claim/lease. Dos agentes pueden considerarse propietarios a la vez y el campo `agent_owner` no evita trabajo duplicado.
- Esto limita el Kanban como mecanismo efectivo de orquestación: representa asignaciones, pero no las coordina ni protege.

### P1 — Historias con épica inexistente desaparecen del tablero

- `enrichStories` conserva un `epicId` desconocido y muestra el propio ID como título en `server/index.js`.
- `buildEpicLanes` en `src/components/KanbanBoard.jsx` solo crea lanes para épicas existentes y para historias sin épica (`epicId == null`). Una historia que referencia `EPI-404` no pertenece a ninguna lane y queda invisible, aunque sí cuenta en las estadísticas del proyecto.
- No hay validación de existencia de la épica al crear, editar o mover historias.
- La UI debería rechazar la referencia o tratarla explícitamente como huérfana, igual que hace con dependencias inexistentes.

### P1 — Integridad referencial no validada

- `blocked_by`, `blocks` y `related_to` se aceptan como listas libres en `server/index.js`; no se rechazan autorreferencias, ciclos, duplicados ni referencias cruzadas entre proyectos.
- `blocked_by` decide `isBlocked`, mientras `blocks` solo se presenta como relación independiente. No se mantiene simetría entre ambos campos, por lo que dos documentos pueden contradecirse.
- `src/lib/graph.js` puede dibujar dos aristas diferentes para la misma relación cuando A declara `blocked_by: [B]` y B declara `blocks: [A]`.
- El servidor normaliza mayúsculas para resolver dependencias, pero `src/lib/graph.js` usa IDs exactos en su `Map`; una relación puede resolverse en el detalle y desaparecer del grafo por diferencias de casing.

### P1 — IDs duplicados y contrato archivo/ID no comprobados

- `readMarkdownCollection` en `server/index.js` confía en el `id` del frontmatter y no verifica que coincida con el nombre del archivo, pese a que `skills/local-kanban-agent/SKILL.md` lo declara obligatorio.
- Dos archivos pueden declarar el mismo ID. Los lookups con `Map`, `find` y las keys React resolverán la ambigüedad de maneras distintas; una edición puede afectar al primer archivo encontrado y no al que el usuario cree ver.
- Tampoco se valida el patrón `STO-*`/`EPI-*` ni la unicidad de IDs de proyectos en `config/projects.json`.

### P1 — La regla derivada `story_in_testing` no es estable al cerrar

- `evaluateDerivedCriterion` en `server/index.js` marca esa regla solo cuando `status === "testing"`.
- Si se usa dentro de `done_criteria`, puede estar completa en testing y pasar automáticamente a incompleta en cuanto la historia llega a done. El backend permite la transición y la UI deja de mostrar “Done validado”.
- La semántica debería ser monotónica para un criterio de cierre o la regla debería reservarse para readiness/validación previa con una regla explícita diferente.

## Seguridad y exposición

### P1 — API de escritura sin autenticación si cambia el bind local

- El valor por defecto `127.0.0.1` en `server/index.js` y `ecosystem.config.cjs` reduce exposición, pero `HOST` es configurable y no existe autenticación, autorización, CSRF ni validación de origen.
- Si se arranca con `HOST=0.0.0.0`, cualquier equipo con acceso de red puede leer rutas locales y contenido Markdown, crear archivos o modificar estados en todos los proyectos configurados.
- `GET /api/projects` devuelve `rootPath`, `filePath` y contenido de las historias; varios errores devuelven además `error.message` con rutas y detalles internos.
- Debe documentarse el modelo de confianza local y fallar de forma segura cuando el bind no sea loopback, o incorporar un secreto local para endpoints mutables.

### P2 — Límites de payload y documentos ausentes

- `app.use(express.json())` usa el límite por defecto, pero no hay límites por número de proyectos, archivos, relaciones, subtareas, criterios, labels ni tamaño de Markdown leído desde disco.
- Un proyecto accidentalmente grande o un documento YAML especialmente costoso puede bloquear el event loop y afectar a todos los clientes.
- El audit local de dependencias reportó vulnerabilidades moderadas corregibles en la cadena de `express`/`qs` y `js-yaml` (esta última llega mediante el parseo de YAML). El lockfile debe actualizarse y verificarse con `npm audit`.

## Rendimiento y escalabilidad

### P1 — Recarga global completa en cada lectura y mutación

- `loadProjects` en `server/index.js` relee y parsea todos los Markdown de todos los proyectos en cada `GET /api/projects`.
- `findStory` también carga todo. Algunas mutaciones vuelven a invocar `loadProjects` para validación, de modo que una sola operación puede escanear el workspace dos o tres veces antes de escribir.
- Los cálculos de estadísticas realizan múltiples `filter` completos por estado y épica; son aceptables con pocos archivos, pero amplifican el coste del I/O global.
- Cada evento SSE provoca en `src/App.jsx` otro `fetchProjects` completo. Con varios clientes, una sola escritura multiplica el escaneo por el número de pestañas conectadas.
- El diseño carece de caché incremental, índice por proyecto/ID o endpoint de lectura parcial; su coste crecerá aproximadamente con proyectos × documentos × clientes.

### P2 — Watchers frágiles ante rutas inexistentes o reemplazadas

- `watchPath` en `server/index.js` captura el fallo si una ruta no existe, pero no programa reintentos periódicos.
- Si el `docsRoot` de un proyecto no existe al arrancar, no hay watcher en un ancestro que detecte su creación; cambios hechos luego por un agente no activarán SSE hasta que otra modificación de configuración fuerce una resincronización o se reinicie el servidor.
- Si un directorio vigilado se elimina y recrea, el handler de error cierra el watcher pero tampoco garantiza una resincronización.
- Los tests de espejo en `e2e/tests/agent-mirror.spec.js` hacen `page.reload()` después de editar Markdown, por lo que no prueban realmente la promesa de actualización en vivo.

## Robustez de datos y errores

### P1 — Un documento defectuoso derriba la carga completa

- `loadProjects` usa `Promise.all` en `server/index.js`. Un JSON de configuración inválido, un proyecto mal formado, un archivo ilegible o un frontmatter YAML inválido hace que `GET /api/projects` responda 500 para todos los proyectos.
- No hay aislamiento por proyecto/archivo, diagnóstico estructurado ni modo degradado que conserve los proyectos sanos.
- `safeReadDir` solo tolera `ENOENT`; problemas de permisos o enlaces rotos bloquean toda la aplicación.

### P2 — Normalización silenciosa oculta errores de agentes

- Estados, modos de ejecución, tipos y reglas inválidos se convierten silenciosamente a defaults en `server/index.js` en vez de rechazarse.
- La propia skill advierte que enviar snake_case a la API ignora campos silenciosamente. Este comportamiento puede convertir trabajo `agent` en `human`, borrar ownership o perder dependencias sin que la llamada falle.
- Para un sistema operado por agentes conviene validación estricta con errores de campo, especialmente en PUT de reemplazo total.

### P2 — Configuración insuficientemente validada

- `scripts/setup.js` exige `rootPath` absoluto, pero no comprueba existencia, permisos, IDs duplicados ni que `docsPath` sea relativo y permanezca bajo `rootPath`.
- El servidor tampoco valida el esquema de `config/projects.json`; espera directamente un array y usa `project.rootPath` en operaciones de path.
- Un `docsPath` absoluto o con `..` puede hacer que un proyecto apunte fuera de su repositorio, contradiciendo la separación documentada en `docs/PROJECT_KANBAN_SETUP.md`.

## Deuda técnica y áreas frágiles

### P2 — Backend monolítico y lógica duplicada

- `server/index.js` concentra parsing, dominio, persistencia, watchers, SSE, API y static hosting en más de mil líneas, sin exports que faciliten pruebas unitarias.
- La lógica de progreso de épicas está duplicada en `server/index.js` y `src/components/KanbanBoard.jsx`; los pesos y algoritmos pueden divergir.
- La semántica de criterios aparece repartida entre `server/index.js`, `src/components/StoryEditor.jsx`, `src/App.jsx` y `skills/local-kanban-agent/SKILL.md`.
- `src/App.jsx`, `src/components/StoryEditor.jsx` y `src/components/StoryGraphView.jsx` acumulan estado y responsabilidades extensas; cambios pequeños tienen una superficie de regresión amplia.

### P2 — Modelo de actualización full-replace peligroso

- Los PUT de historias y épicas reconstruyen un frontmatter canónico y eliminan cualquier campo personalizado que un proyecto o agente hubiera añadido al Markdown.
- Esto contradice parcialmente la idea de Markdown como fuente de verdad extensible: editar desde la UI puede destruir metadatos desconocidos conservados previamente por el archivo.
- Los endpoints especializados de toggle y status sí preservan campos desconocidos, por lo que el comportamiento cambia según la operación usada.

### P2 — Estados de UI susceptibles a quedar obsoletos

- `liveSelectedStory` y `liveSelectedEpic` en `src/App.jsx` conservan el objeto viejo si el elemento desaparece tras un cambio externo. El panel puede seguir mostrando o intentando editar una entidad ya borrada.
- Al cambiar de proyecto, filtros de épica y búsqueda no se normalizan; un filtro perteneciente al proyecto anterior puede dejar el nuevo tablero vacío hasta intervención manual.
- Las actualizaciones optimistas de drag, subtareas y criterios no incorporan versión; una respuesta tardía o un refresh SSE puede intercalarse con otra acción y mostrar temporalmente estado antiguo.

### P2 — Scripts de producción poco resilientes

- `Launch_Kanban.command` comprueba `dist`, pero después ejecuta `npm start`, cuyo script siempre vuelve a hacer `npm run build`; la comprobación inicial no evita el build.
- Su bucle `until curl ...` no tiene timeout. Si build, PM2 o servidor fallan, la ventana puede esperar indefinidamente sin presentar la causa raíz.
- `npm stop` usa `pm2 stop ecosystem.config.cjs`; el flujo no contempla que PM2 no esté inicializado ni limpia procesos eliminados.

## Cobertura de pruebas pendiente

### P1 — Reglas centrales sin pruebas de integración dedicadas

- Solo existe suite Playwright; no hay tests unitarios para `enrichStories`, transición de estados, reglas derivadas, parsing/sanitización o `buildStoryGraph`.
- Faltan casos de seguridad y consistencia: traversal, IDs duplicados, filename/ID divergentes, épica huérfana, ciclos, casing, documento corrupto, campos desconocidos y acceso concurrente.
- Faltan pruebas que demuestren que no se puede cerrar trabajo incompleto; actualmente esa garantía ni siquiera existe en backend.
- `playwright.config.js` usa `reuseExistingServer: true` con puertos fijos, lo que puede ejecutar la suite contra un proceso viejo o ajeno y ocultar cambios locales.
- `fullyParallel: false` y `workers: 1` son coherentes con una fixture compartida, pero impiden detectar carreras y alargan la suite a medida que crezca.
- Las pruebas de mirror en `e2e/tests/agent-mirror.spec.js` verifican persistencia mediante reload, no la ruta SSE/watchers que constituye el comportamiento live.

## Limitaciones funcionales conocidas

- No hay eliminación, archivado ni historial/auditoría de historias o épicas desde la API/UI; el borrado requiere manipular archivos directamente.
- No hay orden explícito dentro de una columna, ranking, límite WIP, fechas, estimaciones, capacidad ni planificación temporal. El “orden” de trabajo depende del orden de directorio y render, no de un campo normativo.
- Prioridad solo tiene tres niveles y no existe una política backend para escoger la próxima historia ejecutable; el orquestador debe reconstruirla leyendo todas las historias.
- No hay estado explícito `blocked`; el bloqueo se deriva únicamente de `blocked_by`. Bloqueos humanos descritos en `agent_status_note` no son consultables estructuralmente.
- No existe endpoint para registrar proyectos, consultar una sola historia, obtener solo trabajo ejecutable, reclamar ownership o renovar un lease; los agentes deben transferir y parsear el dataset completo.
- No hay historial de transiciones, autor, timestamps de creación/modificación ni evidencia de validación estructurada. `last_agent_update` es editable libremente y no constituye auditoría fiable.

## Orden recomendado de remediación

1. **P0:** confinar rutas e IDs; añadir escritura exclusiva/atómica, control de concurrencia y revisiones.
2. **P1:** convertir las reglas normativas esenciales (`done`, ownership, referencias) en invariantes del backend y rechazar datos inválidos.
3. **P1:** detectar IDs/épicas huérfanas y aislar errores por archivo/proyecto para que el tablero nunca pierda silenciosamente trabajo.
4. **P1:** añadir tests de integración del dominio, seguridad, concurrencia y SSE antes de ampliar funcionalidad.
5. **P2:** indexar/cachar Markdown incrementalmente, separar capas del backend y reducir duplicación de reglas entre servidor, UI y skill.
6. **P2:** robustecer setup/launch y añadir primitives específicas para agentes: consulta de trabajo ejecutable, claim/lease, actualización parcial e historial.
