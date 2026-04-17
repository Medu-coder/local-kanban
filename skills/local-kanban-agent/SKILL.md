---
name: "local-kanban-agent"
description: "Sistema operativo agéntico basado en Markdown para gestionar historias y épicas locales."
---

# Local Kanban Agent Skill

Fuente normativa única para agentes que operen en repositorios monitorizados por Local Kanban.

## 1. Contrato Operativo Obligatorio (AGENTS.md)

Todo repositorio externo (`TU_PROYECTO`) debe tener un archivo `AGENTS.md` en su raíz **antes de iniciar cualquier trabajo**. 

**Prohibición:** No empezar tareas sustantivas si este archivo no existe o no tiene la siguiente plantilla:

```md
# Agent Work Contract
Este repositorio trabaja bajo el contrato operativo de Local Kanban (KANBAN_ROOT/skills/local-kanban-agent/SKILL.md). Su cumplimiento es obligatorio para todos los agentes. Mantener el Kanban actualizado durante la ejecución es requisito indispensable.
```
*(Sustituir `KANBAN_ROOT` por la ruta absoluta real)*.

## 2. Arquitectura y Roles

Local Kanban separa la aplicación (`KANBAN_ROOT`) de los proyectos externos (`TU_PROYECTO`). Los archivos `.md` de historias y épicas viven en `TU_PROYECTO/docs/kanban/`. **Regla de archivo**: El nombre del archivo debe coincidir exactamente con su `id` (ej: `STO-001.md`).

### Derivación de KANBAN_ROOT
El agente debe conocer esta ruta por contexto de tarea o por la ubicación de este archivo. **Prohibición**: Si no se conoce la ruta, pedirla al usuario antes de operar. Nunca asumir que es igual al directorio de trabajo (`CWD`).

### Roles
- **Orquestador**: Registra proyectos, crea épicas e historias, asigna `agent_owner`, prepara contexto y lanza especialistas en paralelo. Su función es coordinar; **no ejecuta historias ni hace trabajo técnico delegado a especialistas salvo que el usuario se lo ordene explícitamente para una historia concreta**. No cierra sesión mientras haya historias `agent/hybrid` pendientes no bloqueadas por humanos.
- **Especialista**: Recibe una historia concreta con contexto acotado, la ejecuta end to end, actualiza el frontmatter continuamente y la deja cerrada con reporte final o bloqueada con causa explícita. Solo para ante bloqueos humanos reales o fin de trabajo propio.

## 3. Referencia de Campos y API

La API REST corre en `http://localhost:4010`. Todos los campos del body usan **camelCase**; el frontmatter del `.md` usa **snake_case**. Enviar snake_case al API no produce error: el campo simplemente se ignora y se aplica el default, corrompiendo silenciosamente los datos.

### 3.1 Mapa de campos

| Campo API (camelCase) | Campo MD (snake_case) | Tipo | Valores válidos | Default si omitido | Regla crítica |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | String | `STO-*` / `EPI-*` | Auto (slug del título) | Estable tras creación. Nunca cambiar. |
| `title` | `title` | String | Cualquiera | — | **Obligatorio** en creación. |
| `status` | `status` | Enum | `backlog` `developing` `testing` `done` | `backlog` | No inventar estados como `in-progress`. |
| `priority` | `priority` | Enum | `low` `medium` `high` | `medium` | — |
| `executionMode` | `execution_mode` | Enum | `human` `agent` `hybrid` | **`human`** | **Debe ser `agent` para que el agente pueda ejecutar.** Si se omite, queda en `human`. |
| `agentOwner` | `agent_owner` | String\|null | Identidad del agente o `null` | `null` | Requerido para ejecución agéntica. |
| `storyType` | `story_type` | Enum | `feature` `bug` `tech_debt` `research` `chore` | `feature` | — |
| `epicId` | `epic` | String\|null | ID de la épica o `null` | `null` | Vínculo con épica. |
| `blockedBy` | `blocked_by` | String[] | IDs de historias bloqueantes | `[]` | Si alguna no está en `done`, la historia queda bloqueada. |
| `blocks` | `blocks` | String[] | IDs de historias bloqueadas por esta | `[]` | — |
| `relatedTo` | `related_to` | String[] | IDs relacionados | `[]` | — |
| `contextFiles` | `context_files` | String[] | Rutas de archivos | `[]` | — |
| `subtasks` | `subtasks` | `{title,done}[]` | Ver 3.3 | `[]` | Marcar `done:true` al completar. |
| `readyCriteria` | `ready_criteria` | Criterion[] | Ver 3.3 | `[]` | Debe completarse para entrar en `developing`. |
| `doneCriteria` | `done_criteria` | Criterion[] | Ver 3.3 | `[]` | Debe completarse para cerrar. |
| `agentStatusNote` | `agent_status_note` | String | Texto breve operativo | `""` | **Actualizar en cada cambio de estado o hito.** |
| `lastAgentUpdate` | `last_agent_update` | ISO8601\|null | Timestamp RFC 3339 | `null` | Actualizar solo tras acción real, no por lectura. |
| `description` | `description` | String | Texto libre | `""` | — |
| `body` | *(cuerpo MD)* | String | Markdown libre | `""` | Contenido tras el frontmatter. |
| `assignee` | `assignee` | String\|null | Nombre/login | `null` | — |
| `labels` | `labels` | String[] | Etiquetas libres | `[]` | — |

### 3.2 Catálogo de endpoints

Obtener `projectId` primero — está en `GET /api/projects` → campo `id` de cada proyecto.

#### Lectura

```
GET  /api/projects
     → Array de proyectos con sus épicas y historias ya enriquecidas.
     Campos útiles: project.id, story.id, story.status, story.isReadyForDeveloping,
                    story.isBlocked, story.readyCriteriaProgress, story.doneCriteriaProgress
```

#### Creación

```
POST /api/projects/:projectId/stories
Body (JSON, camelCase):
  { title*, epicId, status, priority, executionMode, agentOwner, storyType,
    blockedBy, blocks, relatedTo, contextFiles, subtasks, readyCriteria,
    doneCriteria, agentStatusNote, lastAgentUpdate, description, body,
    assignee, labels, id }
  * = obligatorio
Respuesta 201: { ok: true, id: "STO-xxx", filePath: "..." }
Respuesta 409: ya existe un .md con ese ID.

POST /api/projects/:projectId/epics
Body (JSON, camelCase):
  { title*, description, labels, body, id }
Respuesta 201: { ok: true, id: "EPI-xxx", filePath: "..." }
```

#### Actualización completa (REEMPLAZA todos los campos)

```
PUT  /api/projects/:projectId/stories/:storyId
     ⚠️  REEMPLAZO TOTAL: cualquier campo omitido se resetea a su default.
     Flujo obligatorio:
       1. GET /api/projects → leer el objeto story actual completo.
       2. Modificar solo los campos deseados.
       3. Enviar el objeto completo con camelCase.
Body: mismo esquema que POST /stories (todos los campos).
Respuesta 200: { ok: true, id: "STO-xxx" }

PUT  /api/projects/:projectId/epics/:epicId
     ⚠️  REEMPLAZO TOTAL: mismo patrón que PUT stories.
Body: { title*, description, labels, body }
Respuesta 200: { ok: true, id: "EPI-xxx" }
```

#### Cambio de estado (solo actualiza `status`)

```
POST /api/projects/:projectId/stories/:storyId/status
Body: { "status": "backlog"|"developing"|"testing"|"done" }
     ✅  Seguro: no toca otros campos.
     🚫  Bloqueado por el backend si status="developing" y la historia no está lista
         (blocked_by pendientes o ready_criteria incompletos).
Respuesta 200: { ok: true, status: "..." }
Respuesta 500: { error: "...", detail: "La historia no esta lista para pasar a developing." }
```

#### Mover a otra épica (y/o cambiar estado)

```
POST /api/projects/:projectId/stories/:storyId/move
Body: { "status": "..."*, "epicId": "EPI-xxx" }
     * status es obligatorio. epicId es opcional.
     ⚠️  Si epicId se omite o es null, el backend escribe epic: null en el MD
         → la historia queda SIN épica. Incluir siempre epicId si no se quiere cambiar.
     🚫  También valida la transición a "developing" igual que /status.
Respuesta 200: { ok: true, status: "...", epicId: "..." }
Respuesta 500: { error: "...", detail: "La historia no esta lista para pasar a developing." }
```

#### Toggle de subtarea (por índice 0-based)

```
POST /api/projects/:projectId/stories/:storyId/subtasks/:subtaskIndex/toggle
     :subtaskIndex = posición en el array subtasks (0, 1, 2, ...)
     Body: vacío o {}
     ✅  Invierte done del subtask en esa posición.
Respuesta 200: { ok: true, subtasks: [...], toggledSubtask: {...} }
```

#### Toggle de criterio (por índice 0-based)

```
POST /api/projects/:projectId/stories/:storyId/criteria/:criteriaType/:criteriaIndex/toggle
     :criteriaType  = "ready" | "done"
     :criteriaIndex = posición en el array (0, 1, 2, ...)
     ⚠️  Solo funciona en criterios kind="manual". Los kind="derived" se calculan automáticamente.
     Body: vacío o {}
Respuesta 200: { ok: true, criteriaType, criteria: [...], toggledCriterion: {...} }
Respuesta 400: "Solo se pueden editar criterios manuales."
```

### 3.3 Estructuras anidadas

```jsonc
// subtask
{ "title": "Escribir tests", "done": false }

// criterion manual
{ "id": "criterion-tests-pasando", "label": "Tests pasando", "kind": "manual", "checked": false }

// criterion derived (NO enviar checked — lo calcula el backend)
{ "id": "criterion-deps", "label": "Dependencias cerradas", "kind": "derived",
  "rule": "dependencies_done" }
```

Reglas `derived` válidas y su lógica exacta:

| Regla | Se cumple cuando |
| :--- | :--- |
| `dependencies_done` | Todos los IDs en `blockedBy` tienen status `done` |
| `all_subtasks_done` | Hay ≥1 subtarea Y todas tienen `done: true` |
| `has_assignee` | `assignee` **o** `agentOwner` está relleno |
| `has_agent_owner` | `agentOwner` está relleno (más estricto que `has_assignee`) |
| `has_context_files` | Hay ≥1 entrada en `contextFiles` |
| `story_in_testing` | `status === "testing"` |

### 3.4 Prohibiciones API

- No registrar proyectos vía API — editar `config/projects.json` manualmente (leer → modificar → escribir).
- No borrar historias/épicas vía API — borrar el `.md` directamente si el humano lo autoriza.
- No enviar campos en snake_case al body de la API — se ignorarán silenciosamente.
- No omitir campos en `PUT` sin haber leído el estado actual primero.

## 4. Flujos Operativos

### Orquestador (Orquestación Continua)
1. **Bootstrap**: Verificar `KANBAN_ROOT`. Registrar proyecto en `config/projects.json` (leer -> añadir entrada -> escribir). 
   **Estructura entry**: `{ "id": "slug", "name": "Nombre", "rootPath": "/ruta/abs", "docsPath": "docs/kanban" }`.
   *Nota: `id` debe coincidir con campo `project` en MD.*
2. **Planificación**: Crear épicas e historias maximizando `execution_mode: agent`. Justificar `human` en el cuerpo.
3. **Preparación de contexto**: Antes de cada lanzamiento, entregar al especialista solo el contexto imprescindible para completar correctamente su historia:
   - ID de la historia y objetivo esperado.
   - Criterios de listo/cierre y estado de dependencias.
   - Archivos o rutas relevantes (`context_files`) y restricciones técnicas del repo.
   - Resultado esperado de validación o evidencia de cierre.
   - Bloqueos conocidos, decisiones previas y límites de actuación.
   **Prohibición**: No volcar contexto masivo "por si acaso". El contexto debe ser suficiente y a la vez mínimo.
4. **Lanzamiento**: Invocar subagentes en paralelo (un ejemplar por `agent_owner` único con trabajo pendiente), dejando claro ownership, alcance, definición de terminado y formato de reporte.
5. **Monitorización**: Seguir el progreso, resolver bloqueos, aportar contexto adicional solo cuando haga falta, actualizar `agent_status_note` si coordina cambios y relanzar agentes si es necesario.
6. **Límite operativo**: Si el orquestador detecta trabajo técnico pendiente en una historia ejecutable por especialista, debe delegarlo. No debe absorberlo él mismo por conveniencia.

### Especialista (Ejecución Atómica)
1. **Entrada acotada**: Trabajar únicamente sobre las historias asignadas a su identidad (`agent_owner` == identidad) y el contexto entregado por el orquestador. Si falta contexto crítico, pedirlo de forma concreta. Si sobra contexto irrelevante, ignorarlo.
2. **Readiness**: Verificar que `blocked_by` estén en `done` y `ready_criteria` cumplidos.
3. **Ejecución end to end**:
   - Mover a `developing` vía API.
   - Sincronizar: Marcar cada subtarea `done: true` **al completarla**.
   - Actualizar `agent_status_note` y `last_agent_update` en cada cambio de estado o hito.
4. **Cierre**: Mover a `testing` y finalmente a `done` tras validación E2E. Releer el proyecto tras cada `done` por si se desbloqueó trabajo propio.
5. **Reporte obligatorio**: Cada historia debe quedar en uno de estos estados finales:
   - `done`, con validación ejecutada y nota breve de lo realizado.
   - bloqueada, con causa concreta, evidencia del bloqueo, siguiente acción necesaria y aclaración de por qué no puede resolverse respetando este contrato.
   **Prohibición**: No devolver trabajo a medias, no parar por ambigüedad menor y no cerrar la sesión sin dejar trazabilidad suficiente para que el orquestador actúe.

## 5. Validaciones, Transiciones y Criterios

### Marcación de Criterios (`ready_criteria` / `done_criteria`)
- **`kind: manual`**: Se marcan con `checked: true` tras verificación real (endpoint toggle de criterio).
- **`kind: derived`**: El backend los calcula automáticamente. **Prohibición**: No marcarlos vía API/MD — modificar el dato fuente (ej. para `all_subtasks_done`, completar las subtareas). Ver tabla de reglas en sección 3.3.

### Transiciones Estrictas
- **A `developing`**: El backend bloquea si hay `blocked_by` pendientes o `ready_criteria` incompletos.
- **A `done`**: 
  - **Prohibición**: No cerrar con subtareas (`done: false`) o criterios manuales (`checked: false`) pendientes.
  - **Validación E2E Obligatoria**: Antes de cerrar, el agente **debe** ejecutar pruebas reales (API, UI, scripts). No basta con inspección de código.

## 6. Matrix de Ejecución vs Ownership

| `execution_mode` | `agent_owner` | Acción del Agente |
| :--- | :--- | :--- |
| `human` | Cualquier | Solo analizar/documentar. No tomar ownership operativo. |
| `agent` | Ausente | No ejecutar. Declarar falta de owner. |
| `agent` | Presente | Ejecutar. Si es otra identidad, reasignar con nota de relevo. |
| `hybrid` | Presente | Cooperación humano-agente. Ejecutar parte técnica. |

---
**Nota Final**: Ante bloqueos o ambigüedad, dejar constancia en `agent_status_note` y consultar al Orquestador antes de operar.
