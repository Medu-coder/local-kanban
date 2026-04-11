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
- **Orquestador**: Registra proyectos, crea épicas e historias, asigna `agent_owner` y lanza especialistas en paralelo. No cierra sesión mientras haya historias `agent/hybrid` pendientes no bloqueadas por humanos.
- **Especialista**: Filtra historias por su identidad (`agent_owner`), las ejecuta y actualiza el frontmatter continuamente. Solo para ante bloqueos humanos reales o fin de trabajo propio.

## 3. Referencia de Campos y API

La API REST (`http://localhost:4010`) usa **camelCase**, mientras que el frontmatter usa **snake_case**.

| Campo API | Campo MD | Tipo | Valores Válidos (Lista Cerrada) | Default API | Regla Crítica |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | `id` | String | `STO-*` (Story) / `EPI-*` (Epic) | Auto | Estable tras creación. Nunca cambiar. |
| `status` | `status` | Enum | `backlog`, `developing`, `testing`, `done` | `backlog` | No inventar estados (ej. *in-progress*). |
| `priority` | `priority` | Enum | `low`, `medium`, `high` | `medium` | Informativo, no altera permisos. |
| `executionMode`| `execution_mode`| Enum| `human`, `agent`, `hybrid` | **`human`** | **Obligatorio incluir `agent` para ejecución.** |
| `agentOwner` | `agent_owner` | String | Identidad del agente o `null` | `null` | Requerido para ejecución agéntica. |
| `storyType` | `story_type` | Enum | `feature`, `bug`, `tech_debt`, `research`, `chore` | `feature` | Clasificación de trabajo. |
| `epicId` | `epic` | String | ID de la épica o `null` | `null` | Vínculo con épica. |
| `blockedBy` | `blocked_by` | Array | IDs de historias bloqueantes | `[]` | Si no están en `done`, la historia está bloqueada. |
| `subtasks` | `subtasks` | Obj[] | `{ title: String, done: Boolean }` | `[]` | Marcar `done: true` al completar cada una. |
| `readyCriteria`| `ready_criteria`| Crit[] | Ver sección 5 | `[]` | Condición para entrar en `developing`. |
| `doneCriteria` | `done_criteria` | Crit[] | Ver sección 5 | `[]` | Condición para validación de cierre. |
| `agentStatusNote`| `agent_status_note`| String| Texto breve operativo | `""` | **Obligatorio actualizar en cada cambio.** |
| `lastAgentUpdate`| `last_agent_update`| ISO8601| Timestamp o `null` | `null` | Actualizar tras acción real, no por lectura. |

**Prohibiciones API:**
- No registrar proyectos vía API (editar `config/projects.json` manualmente).
- No borrar historias/épicas vía API (borrar el `.md` si el humano autoriza).
- No enviar campos en snake_case a la API (se ignorarán).

## 4. Flujos Operativos

### Orquestador (Orquestación Continua)
1. **Bootstrap**: Verificar `KANBAN_ROOT`. Registrar proyecto en `config/projects.json` (leer -> añadir entrada -> escribir). 
   **Estructura entry**: `{ "id": "slug", "name": "Nombre", "rootPath": "/ruta/abs", "docsPath": "docs/kanban" }`.
   *Nota: `id` debe coincidir con campo `project` en MD.*
2. **Planificación**: Crear épicas e historias maximizando `execution_mode: agent`. Justificar `human` en el cuerpo.
3. **Lanzamiento**: Invocar subagentes en paralelo (un ejemplar por `agent_owner` único con trabajo pendiente).
4. **Monitorización**: Resolver bloqueos, aportar contexto en `agent_status_note` y relanzar agentes si es necesario.

### Especialista (Ejecución Atómica)
1. **Filtro**: Identificar historias propias (`agent_owner` == identidad) no terminadas.
2. **Readiness**: Verificar que `blocked_by` estén en `done` y `ready_criteria` cumplidos.
3. **Ejecución**:
   - Mover a `developing` vía API.
   - Sincronizar: Marcar cada subtarea `done: true` **al completarla**.
   - Actualizar `agent_status_note` y `last_agent_update` en cada cambio de estado o hito.
4. **Cierre**: Mover a `testing` y finalmente a `done` tras validación E2E. Releer el proyecto tras cada `done` por si se desbloqueó trabajo propio.

## 5. Validaciones, Transiciones y Criterios

### Marcación de Criterios (`ready_criteria` / `done_criteria`)
- **`kind: manual`**: Se marcan con `checked: true` tras verificación real.
- **`kind: derived`**: Se calculan por reglas. **Prohibición**: No marcarlos vía API/MD, actualizar el dato fuente.
- **Reglas derived**: `dependencies_done`, `all_subtasks_done`, `has_agent_owner`, `has_context_files`, `story_in_testing`.

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
**Nota Final**: Este contrato es estricto. El backend puede aplicar defaults silenciosos ante datos inválidos, corrompiendo el Kanban. Ante la duda, consultar al Orquestador vía `agent_status_note`.
