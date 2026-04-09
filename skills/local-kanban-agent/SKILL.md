---
name: "local-kanban-agent"
description: "Usa Local Kanban como sistema operativo agéntico basado en Markdown para leer, ejecutar y actualizar historias y épicas dentro de proyectos locales."
---

# Local Kanban Agent Skill

Usa esta skill cuando trabajes en un repositorio que esté monitorizado por `Local Kanban` o cuando tengas que preparar un proyecto para que se integre con este sistema.

Esta skill es la fuente normativa unica para interpretar `Local Kanban` desde un agente. Si otro documento resume o simplifica estas reglas, esta skill tiene precedencia.

## Objetivo

Definir una semantica universal y verificable para que cualquier agente:

- lea historias y epicas igual
- tome las mismas decisiones ante el mismo frontmatter
- no dependa de inferencias locales ni de ejemplos

El contrato cubre dos capas:

- estructura del dato aceptada por el sistema
- politica operativa que un agente debe aplicar al leer y actualizar ese dato

## Alcance y precedencia

Orden de precedencia:

1. Esta skill
2. El comportamiento real del backend
3. La UI como reflejo visual
4. Cualquier ejemplo o resumen documental

Clasificacion normativa:

- `enforced by backend`: el backend valida, normaliza o calcula el comportamiento
- `reflected by UI`: la UI lo muestra o deriva visualmente
- `agent-policy only`: el backend no lo impone, pero todos los agentes deben obedecerlo
- `informational only`: no debe alterar decisiones de ejecucion por si solo

## Decision Matrix

### Regla universal de precedencia

1. `execution_mode` manda sobre cualquier otro campo
2. `agent_owner` define que agente es el ejecutor esperado cuando el modo permite ejecucion agéntica
3. `assignee` es metadata humana y nunca autoriza ni veta al agente por si solo

### Matriz de ejecucion

| `execution_mode` | `agent_owner` | `assignee` | Que debe hacer el agente |
| --- | --- | --- | --- |
| `human` | ausente o presente | ausente o presente | No ejecutar trabajo principal. Puede analizar, documentar, preparar contexto o dejar handoff. No debe asumir ownership operativo. |
| `agent` | ausente | ausente o presente | No ejecutar trabajo principal como owner. Debe tratar la historia como no lista para ejecucion agéntica y dejar trazabilidad si interviene. |
| `agent` | presente | ausente o presente | El agente puede ejecutar trabajo principal. Si el agente actual no coincide con `agent_owner`, debe reasignarse o dejar nota explicita de relevo antes de ejecutar. |
| `hybrid` | ausente | ausente o presente | Puede preparar contexto o dejar handoff, pero no ejecutar trabajo principal como owner. |
| `hybrid` | presente | ausente o presente | Humano y agente pueden intervenir. El agente puede ejecutar trabajo principal y debe dejar trazabilidad de su intervencion. Si no es el `agent_owner`, necesita reasignacion o relevo explicito. |

### Significado normativo de ownership

- `assignee` es metadata humana pura.
- `assignee` no implica exclusividad humana.
- `assignee` no bloquea al agente.
- `agent_owner` identifica al agente ejecutor esperado.
- Si un agente distinto al `agent_owner` quiere ejecutar, debe reflejar el relevo en `agent_status_note` y actualizar `agent_owner` antes o durante la toma de ownership.

## Story Contract

### Invariantes globales de historia

- La historia vive en `docs/kanban/stories/<STORY_ID>.md`.
- El nombre del archivo debe coincidir con `id`.
- `project` es un identificador documental, no un selector de ejecucion.
- `epic` puede faltar o ser `null`; eso significa `Sin épica`.
- `blocked_by` con referencias inexistentes bloquea la historia.
- `blocks` y `related_to` nunca bloquean a la propia historia.
- `status: done` no implica `done validado`.
- `labels` no tienen semantica de ejecucion.

### Campos de story

| Campo | Obligatorio | Tipo | Valores / forma | Clasificacion | Significado exacto | Cuando usarlo | Quien lo actualiza | Regla para agentes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | si | string | ID estable, idealmente `STO-*` | enforced by backend | Identificador unico de la historia | Siempre | humano o agente al crear | Nunca cambiar salvo migracion intencional |
| `type` | si | string | `story` | informational only | Tipo documental del archivo | Siempre | humano o agente al crear | Debe ser `story` |
| `project` | si | string | ID documental del proyecto | informational only | Vinculo documental con el proyecto | Siempre | humano o agente al crear | No usar para decidir ejecucion |
| `title` | si | string | texto no vacio | enforced by backend | Nombre corto de la historia | Siempre | humano o agente | Debe resumir el trabajo sin ambiguedad |
| `description` | no | string | texto corto | reflected by UI | Resumen breve visible en board y detalle | Cuando haga falta resumen rapido | humano o agente | No sustituye el cuerpo Markdown |
| `epic` | no | string o `null` | ID de epica o ausente | enforced by backend | Asociacion con una epica | Cuando la historia pertenezca a una epica | humano o agente | Ausente o `null` es valido y significa `Sin épica` |
| `status` | si | string | `backlog`, `developing`, `testing`, `done` | enforced by backend | Estado operativo de la historia | Siempre | humano o agente | Nunca inventar otros estados |
| `priority` | no | string | `low`, `medium`, `high` | enforced by backend | Prioridad documental | Cuando el equipo quiera priorizacion visible | humano o agente | No cambia permisos ni readiness |
| `assignee` | no | string o `null` | nombre humano libre | informational only | Persona humana relacionada con la historia | Cuando haya contraparte o responsable humano | humano o agente | Tratar siempre como metadata; no autoriza ni bloquea al agente |
| `agent_owner` | no | string o `null` | identidad del agente | agent-policy only | Agente ejecutor esperado | Obligatorio para ejecucion principal en `agent` o `hybrid` | agente u orquestador | Si falta en modos agénticos, no ejecutar como owner |
| `execution_mode` | no pero normativamente requerido | string | `human`, `agent`, `hybrid` | enforced by backend + agent-policy only | Modo de ejecucion que manda sobre ownership | Siempre que la historia vaya a trabajarse | humano o agente | Aplicar la matriz de ejecucion |
| `story_type` | no | string | `feature`, `bug`, `tech_debt`, `research`, `chore` | enforced by backend | Tipo de trabajo | Cuando interese clasificar | humano o agente | No cambia permisos por si solo |
| `blocked_by` | no | string[] | IDs de historias | enforced by backend + reflected by UI | Dependencias de entrada | Cuando otra historia deba completarse antes | humano o agente | Si algun ID falta o no esta en `done`, la historia esta bloqueada |
| `blocks` | no | string[] | IDs de historias | reflected by UI | Historias que dependen de esta | Cuando esta historia desbloquee a otras | humano o agente | No bloquea a la propia historia |
| `related_to` | no | string[] | IDs de historias | reflected by UI | Relacion no bloqueante | Cuando haya contexto lateral | humano o agente | Nunca tratar como bloqueo |
| `context_files` | no | string[] | rutas relativas o absolutas relevantes | reflected by UI + agent-policy only | Entrada tecnica prioritaria | Cuando existan archivos clave para empezar rapido | humano o agente | Revisarlos antes de explorar el repo completo |
| `agent_status_note` | no | string | nota breve | reflected by UI + agent-policy only | Estado operativo actual del trabajo agéntico | Siempre que un agente intervenga de verdad | agente | Debe ser breve, operativa y actual, no un changelog largo |
| `last_agent_update` | no | ISO 8601 o `null` | timestamp | enforced by backend + reflected by UI + agent-policy only | Ultima intervencion real de un agente | Siempre que un agente cambie trabajo o estado real | agente | No actualizar por mera lectura o inspeccion |
| `labels` | no | string[] | etiquetas libres | informational only | Taxonomia libre | Cuando ayude a clasificar | humano o agente | No derivar reglas de ejecucion de aqui |
| `subtasks` | no | objeto[] | `{ title, done }` | enforced by backend + reflected by UI | Desglose operativo del trabajo | Cuando el trabajo necesite pasos concretos | humano o agente | Mantenerlas alineadas con el trabajo real |
| `ready_criteria` | no | criterio[] | ver contrato de criterios | enforced by backend + reflected by UI | Condiciones para empezar | Cuando haga falta explicitar readiness | humano o agente | Si todos se cumplen y no hay bloqueos, la historia queda lista para `developing` |
| `done_criteria` | no | criterio[] | ver contrato de criterios | enforced by backend + reflected by UI | Condiciones para validar cierre | Cuando haga falta explicitar cierre | humano o agente | `done` y `done validado` no son equivalentes |

### Cuerpo Markdown de story

- Es libre.
- Debe contener contexto largo, aceptacion, notas tecnicas o handoff si hace falta.
- No sustituye a campos operativos obligatorios del frontmatter.

## Epic Contract

### Invariantes globales de epica

- La epica vive en `docs/kanban/epics/<EPIC_ID>.md`.
- El nombre del archivo debe coincidir con `id`.
- La epica agrupa historias, pero no define permisos de ejecucion por si misma.

### Campos de epic

| Campo | Obligatorio | Tipo | Valores / forma | Clasificacion | Significado exacto | Cuando usarlo | Quien lo actualiza | Regla para agentes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | si | string | ID estable, idealmente `EPI-*` | enforced by backend | Identificador unico de la epica | Siempre | humano o agente al crear | No cambiar salvo migracion intencional |
| `type` | si | string | `epic` | informational only | Tipo documental del archivo | Siempre | humano o agente al crear | Debe ser `epic` |
| `project` | si | string | ID documental del proyecto | informational only | Vinculo documental con el proyecto | Siempre | humano o agente al crear | No usar para decidir ejecucion |
| `title` | si | string | texto no vacio | enforced by backend | Nombre corto de la epica | Siempre | humano o agente | Debe describir el tema agregador |
| `description` | no | string | texto corto | reflected by UI | Resumen breve visible | Cuando haga falta resumen rapido | humano o agente | No sustituye al cuerpo Markdown |
| `labels` | no | string[] | etiquetas libres | informational only | Taxonomia libre de la epica | Cuando ayude a clasificar | humano o agente | No definen permisos ni estado |

### Cuerpo Markdown de epic

- Es libre.
- Debe contener objetivo, alcance, contexto y notas largas de producto si hace falta.

## Checklist Contract

### Diferencia entre subtasks y criteria

- `subtasks`: desglosan trabajo operativo.
- `ready_criteria`: declaran condiciones para empezar.
- `done_criteria`: declaran condiciones para validar cierre.

Un agente no debe usar uno como sustituto de otro.

### Forma valida de criterio

Todo criterio debe tener:

- `id`
- `label`
- `kind`

Si `kind: manual`, debe tener:

- `checked`

Si `kind: derived`, debe tener:

- `rule`

### Criterio manual

- Requiere marcacion explicita.
- Representa una condicion que no se puede inferir solo desde frontmatter.
- Un agente puede marcarlo cuando haya realizado o verificado de verdad esa condicion.

### Criterio derivado

- Se calcula solo a partir del frontmatter y las reglas soportadas.
- El agente no debe “marcarlo”; debe actualizar el dato fuente que hace que la regla se cumpla.

### Reglas derivadas soportadas

| Regla | Semantica exacta |
| --- | --- |
| `dependencies_done` | Todos los IDs de `blocked_by` existen y estan en `done` |
| `all_subtasks_done` | Existe al menos una subtarea y todas tienen `done: true` |
| `has_assignee` | Existe `assignee` o `agent_owner` |
| `has_agent_owner` | Existe `agent_owner` |
| `has_context_files` | `context_files` no esta vacio |
| `story_in_testing` | El `status` de la propia historia es `testing` |

### Reglas de evaluacion normativas

- `ready_criteria` vacio cuenta como completo.
- `done_criteria` vacio no cuenta como `done validado`.
- Una historia esta `blocked` si cualquier referencia en `blocked_by` no existe o no esta en `done`.
- Una historia esta `ready for developing` solo si no esta `blocked` y todos los `ready_criteria` estan completos.
- Una historia esta `done validado` solo si existe al menos un `done_criteria` y todos estan completos.

## Transition Contract

### Restriccion tecnica real

- El sistema solo bloquea de forma estricta la transicion hacia `developing`.

### Regla normativa para agentes

- Antes de mover a `developing`, el agente debe comprobar:
  - bloqueos resueltos
  - `ready_criteria` completos
  - permiso de ejecucion segun `execution_mode` y `agent_owner`
- Antes de mover a `testing`, el trabajo principal debe estar hecho y documentado.
- Antes de mover a `done`, el trabajo debe estar terminado y el frontmatter debe reflejar el estado real.
- Un agente no debe usar `done` como sustituto de `done validado`.

## Compatibilidad y contenido prohibido para contenido nuevo

Compatibilidad legacy existente:

- subtareas como string
- criterios como string
- valores invalidos en enums que el backend normaliza a defaults

Regla normativa:

- Esa compatibilidad existe solo para no romper datos viejos.
- Ningun agente debe generar contenido nuevo usando esos formatos.

## Frontmatter minimo recomendado

### Story

```yaml
id: STO-001
type: story
project: mi-proyecto
title: Historia de ejemplo
description: Resumen corto
epic: EPI-001
status: backlog
priority: medium
assignee: null
agent_owner: codex-main
execution_mode: agent
story_type: feature
blocked_by: []
blocks: []
related_to: []
context_files: []
agent_status_note: ""
last_agent_update: null
labels: []
subtasks: []
ready_criteria: []
done_criteria: []
```

### Epic

```yaml
id: EPI-001
type: epic
project: mi-proyecto
title: Epica de ejemplo
description: Resumen corto
labels: []
```

## Flujo operativo recomendado

1. Lee primero el `.md` de la historia.
2. Si `blocked_by` referencia historias inexistentes, tratalo como bloqueo real.
3. Si `execution_mode` es `human`, no ejecutes trabajo principal.
4. Si `execution_mode` es `agent` o `hybrid` y falta `agent_owner`, no ejecutes trabajo principal.
5. Si tomas posesion de una historia, reflejalo en `agent_owner`.
6. Si avanzas trabajo real, actualiza `last_agent_update` con timestamp ISO y resume el punto actual en `agent_status_note`.
7. Si completas subtareas o criterios manuales, persistelos en el frontmatter antes de terminar.
8. Usa la UI solo como verificacion visual final, nunca como base para decidir que escribir.

## Como preparar un proyecto nuevo para Local Kanban

1. Crea:

```text
docs/kanban/epics
docs/kanban/stories
```

2. Si el repo ya tiene documentacion de producto:
- conviertela a epicas e historias Markdown
- no pierdas contexto tecnico util
- asigna IDs estables

3. Usa el frontmatter minimo y las reglas de esta skill.

## Qué no hacer

- No usar la UI como fuente de verdad.
- No dejar el `.md` desactualizado respecto al trabajo real.
- No borrar dependencias o criterios sin motivo claro.
- No reasignar `agent_owner` sin reflejar el relevo en `agent_status_note`.
- No asumir que `done` implica `done validado`.
- No asumir que `has_assignee` significa solo `assignee`; tambien vale `agent_owner`.
- No confiar en defaults silenciosos del backend para arreglar frontmatter mal formado.
- No tratar `assignee` como veto humano ni como permiso agéntico.
