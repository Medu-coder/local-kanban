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

## Arquitectura del sistema

`Local Kanban` vive en su propio directorio (`KANBAN_ROOT`) y monitoriza otros repositorios como proyectos externos. Esta separacion es fundamental para operar correctamente.

```
KANBAN_ROOT/                            ← donde vive la app
  config/projects.json                  ← registro de proyectos monitorizados
  server/index.js                       ← API REST en http://localhost:4010
  skills/local-kanban-agent/SKILL.md   ← este archivo

TU_PROYECTO/                            ← repositorio externo monitorizado
  docs/kanban/
    epics/
    stories/
```

Los `.md` de historias y epicas viven en `TU_PROYECTO`, no en `KANBAN_ROOT`.

### Como derivar KANBAN_ROOT

El agente debe conocer `KANBAN_ROOT` antes de cualquier operacion. Las unicas fuentes validas son:

1. **Contexto de la tarea**: si la instruccion dice "el Kanban esta en `/ruta/x`", esa es `KANBAN_ROOT`.
2. **Ruta de este archivo**: si el agente accede a este documento y su ruta es `/ruta/x/skills/local-kanban-agent/SKILL.md`, entonces `KANBAN_ROOT=/ruta/x`.

Nunca asumir que `KANBAN_ROOT` coincide con el directorio de trabajo actual del agente (`CWD`). Cuando un agente trabaja en un repositorio externo, su `CWD` es el proyecto externo, no `KANBAN_ROOT`. Son dos rutas distintas que deben mantenerse separadas en todo momento.

Si `KANBAN_ROOT` no esta disponible por ninguna de las dos vias anteriores, pedirlo antes de continuar.

### Operacion desde un repositorio externo

Cuando el agente trabaja en un repositorio que no es `KANBAN_ROOT`, opera simultaneamente sobre dos directorios distintos:

```
KANBAN_ROOT/config/projects.json   ← registrar el proyecto aqui
TU_PROYECTO/docs/kanban/           ← crear epicas e historias aqui
```

Reglas criticas para este escenario:

- **Nunca escribir `.md` de historias o epicas dentro de `KANBAN_ROOT`**. Esos archivos pertenecen al repositorio del proyecto externo.
- **Nunca ejecutar `npm run setup` desde el directorio del proyecto externo**. Ese comando corre en `KANBAN_ROOT`.
- **Nunca usar el `id` del proyecto externo como si fuera `KANBAN_ROOT`** al construir rutas.
- El campo `rootPath` en `config/projects.json` debe apuntar al directorio raiz del proyecto externo, no a `KANBAN_ROOT`.

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

## Bootstrap: registrar y conectar un proyecto nuevo

Este es el flujo completo para que un agente en cualquier repositorio empiece a operar con `Local Kanban`.

### Paso 1 — Verificar que KANBAN_ROOT es correcto

Confirmar que existe el archivo `KANBAN_ROOT/config/projects.json`. Si no existe, ejecutar **desde `KANBAN_ROOT`** (no desde el repositorio del proyecto externo):

```bash
cd KANBAN_ROOT
npm run setup -- --no-interactive
```

Esto crea `config/projects.json` desde la plantilla sin abrir ningun asistente interactivo.

### Paso 2 — Registrar el proyecto en config/projects.json

**IMPORTANTE: No sobrescribir el archivo. Leer primero, añadir la entrada, escribir.**

1. Leer `KANBAN_ROOT/config/projects.json`
2. Comprobar que no existe ya una entrada con el mismo `id` o `rootPath`
3. Si no existe, añadir la nueva entrada al array existente
4. Escribir el archivo completo de vuelta

Formato de una entrada:

```json
{
  "id": "mi-proyecto",
  "name": "Mi proyecto",
  "rootPath": "/ruta/absoluta/al/proyecto",
  "docsPath": "docs/kanban"
}
```

Reglas del campo `id`:
- Obligatorio. Sin `id`, el proyecto no puede ser referenciado por la API ni por el frontmatter.
- Debe ser unico en el array.
- Usar solo minusculas, sin espacios, sin caracteres especiales. Ejemplo: `billing-api`, `frontend-app`.
- Este valor debe coincidir EXACTAMENTE (case-sensitive) con el campo `project` del frontmatter de todas las historias y epicas de ese proyecto.

No existe endpoint de API para registrar proyectos. Editar el archivo es la unica forma.

**El servidor lee `config/projects.json` en cada peticion.** No es necesario reiniciarlo despues de añadir un proyecto.

### Paso 3 — Crear la estructura en el proyecto

Las carpetas deben crearse en el repositorio del proyecto externo (`TU_PROYECTO`), no en `KANBAN_ROOT`. Se crean automaticamente al crear la primera historia o epica via API. Si se usan archivos directamente, deben existir antes:

```bash
# Ejecutar desde TU_PROYECTO, no desde KANBAN_ROOT
mkdir -p docs/kanban/epics
mkdir -p docs/kanban/stories
```

Si `docsPath` en `config/projects.json` tiene un valor distinto a `docs/kanban`, usar ese en lugar del anterior.

### Paso 4 — Crear epicas e historias

Dos formas validas:

**Via archivo (siempre disponible, fuente de verdad):** escribir directamente los `.md` con el frontmatter correcto. Ver plantillas en la seccion "Frontmatter minimo recomendado".

**Via API REST (requiere servidor en marcha):** usar `http://localhost:4010`. Ver seccion "API REST".

### Paso 5 — Verificar que el Kanban lee el proyecto

Si el servidor esta en marcha:

```bash
curl http://localhost:4010/api/health
curl http://localhost:4010/api/projects
```

La respuesta de `/api/projects` debe incluir el proyecto con sus epicas e historias. Si el proyecto no aparece, revisar en este orden:

1. `config/projects.json`: `id` presente, `rootPath` absoluta y existente
2. Estructura `docs/kanban/epics` y `docs/kanban/stories`: deben existir aunque esten vacias
3. Frontmatter de cada `.md`: `id`, `title`, `type` y `status` validos
4. El campo `project` del frontmatter debe coincidir EXACTAMENTE con el `id` del proyecto en `config/projects.json`

## Qué puede y no puede hacer un agente

### Puede

- Leer cualquier `.md` de historia o epica directamente
- Escribir o editar `.md` de historias y epicas directamente
- Registrar un proyecto nuevo editando `KANBAN_ROOT/config/projects.json` (leer-mergar-escribir)
- Crear historias via API: `POST /api/projects/:projectId/stories`
- Editar historias via API: `PUT /api/projects/:projectId/stories/:storyId`
- Crear epicas via API: `POST /api/projects/:projectId/epics`
- Editar epicas via API: `PUT /api/projects/:projectId/epics/:epicId`
- Cambiar el estado de una historia via API: `POST /api/projects/:projectId/stories/:storyId/status`
- Mover una historia a otra epica y estado via API: `POST /api/projects/:projectId/stories/:storyId/move`
- Marcar subtareas via API: `POST /api/projects/:projectId/stories/:storyId/subtasks/:subtaskIndex/toggle`
- Marcar criterios manuales via API: `POST /api/projects/:projectId/stories/:storyId/criteria/:criteriaType/:criteriaIndex/toggle`
- Actualizar `agent_owner`, `agent_status_note`, `last_agent_update` y cualquier campo del frontmatter
- Marcar criterios manuales de `ready_criteria` y `done_criteria` cuando los haya verificado de verdad

### No puede

- Registrar proyectos via API: no existe ese endpoint; debe editar el archivo
- Eliminar historias o epicas via API: no existe endpoint DELETE; para borrar debe eliminar el `.md` directamente y solo si el humano lo ha autorizado
- Mover una historia a `developing` si tiene `blocked_by` pendientes o `ready_criteria` incompletos: el backend lo rechaza con 400
- Usar la UI como fuente de verdad para decidir que escribir en el `.md`
- Marcar criterios derivados directamente: solo puede actualizar el dato fuente que los resuelve
- Reasignar `agent_owner` sin reflejar el relevo en `agent_status_note`
- Inventar estados fuera de `backlog`, `developing`, `testing`, `done`
- Generar contenido nuevo con formatos legacy (subtareas como string, criterios como string)
- Sobrescribir `config/projects.json` sin leer primero su contenido actual
- Asumir que su directorio de trabajo actual es `KANBAN_ROOT`: cuando trabaja en un repo externo, son rutas diferentes
- Escribir `.md` de historias o epicas dentro de `KANBAN_ROOT`: esos archivos pertenecen al repositorio del proyecto
- Usar `KANBAN_ROOT` como valor de `rootPath` en `config/projects.json`: ese campo debe apuntar al proyecto externo

## API REST

El servidor expone una API en `http://localhost:4010`. Todos los cambios via API se persisten directamente en los `.md` del proyecto.

### Verificar que el servidor esta en marcha

```bash
curl http://localhost:4010/api/health
```

Respuesta esperada: `{ "ok": true }`. Si no responde, escribir los `.md` directamente.

### Nomenclatura critica: camelCase en API, snake_case en frontmatter

La API acepta los campos en `camelCase`. El servidor los convierte a `snake_case` al escribir el frontmatter. Un agente que envie campos en snake_case a la API los recibira como `undefined` y el servidor aplicara defaults silenciosos.

| Nombre en API (camelCase) | Nombre en frontmatter (snake_case) | Default si ausente en API |
| --- | --- | --- |
| `agentOwner` | `agent_owner` | `null` |
| `executionMode` | `execution_mode` | **`"human"`** ← critico |
| `storyType` | `story_type` | `"feature"` |
| `epicId` | `epic` | `null` |
| `blockedBy` | `blocked_by` | `[]` |
| `blocks` | `blocks` | `[]` |
| `relatedTo` | `related_to` | `[]` |
| `contextFiles` | `context_files` | `[]` |
| `agentStatusNote` | `agent_status_note` | `""` |
| `lastAgentUpdate` | `last_agent_update` | `null` |
| `readyCriteria` | `ready_criteria` | `[]` |
| `doneCriteria` | `done_criteria` | `[]` |

**El default de `executionMode` es `"human".`** Un agente que no lo incluya explicitamente creara una historia que no puede ejecutar. Siempre incluir `executionMode: "agent"` o `"hybrid"` en el payload.

### IDs en el payload de API

Si no se incluye `id` en el payload de creacion, el servidor genera uno automaticamente como `STO-<slug-del-titulo>` o `EPI-<slug-del-titulo>`. Para mantener el patron `STO-001` / `EPI-001`, proporcionar siempre el `id` de forma explicita.

### Endpoints disponibles

#### Leer todos los proyectos

```
GET /api/projects
```

Devuelve proyectos con epicas e historias enriquecidas (estado de bloqueo, readiness, progreso) y los valores de enum validos del sistema.

#### Crear historia

```
POST /api/projects/:projectId/stories
Content-Type: application/json

{
  "id": "STO-001",
  "title": "Titulo de la historia",
  "description": "Resumen",
  "status": "backlog",
  "epicId": "EPI-001",
  "priority": "medium",
  "executionMode": "agent",
  "agentOwner": "nombre-agente",
  "storyType": "feature",
  "blockedBy": [],
  "blocks": [],
  "relatedTo": [],
  "contextFiles": [],
  "agentStatusNote": "",
  "lastAgentUpdate": null,
  "subtasks": [],
  "readyCriteria": [],
  "doneCriteria": [],
  "body": "## Contexto\n\nDescripcion larga..."
}
```

Devuelve `{ ok: true, id, filePath }`. Si `status` es `"developing"` y la historia no cumple readiness, devuelve 400.

#### Editar historia

```
PUT /api/projects/:projectId/stories/:storyId
Content-Type: application/json
```

Mismos campos que POST. Sobreescribe completamente el frontmatter.

#### Cambiar estado de historia

```
POST /api/projects/:projectId/stories/:storyId/status
Content-Type: application/json

{ "status": "developing" }
```

El backend valida la transicion y rechaza con 400 si la historia no esta lista para `developing`.

#### Mover historia (estado + epica)

```
POST /api/projects/:projectId/stories/:storyId/move
Content-Type: application/json

{ "status": "developing", "epicId": "EPI-002" }
```

#### Crear epica

```
POST /api/projects/:projectId/epics
Content-Type: application/json

{
  "id": "EPI-001",
  "title": "Nombre de la epica",
  "description": "Resumen",
  "labels": [],
  "body": "## Objetivo\n\nDescripcion larga..."
}
```

#### Editar epica

```
PUT /api/projects/:projectId/epics/:epicId
Content-Type: application/json
```

Mismos campos que POST.

#### Marcar/desmarcar subtarea

```
POST /api/projects/:projectId/stories/:storyId/subtasks/:subtaskIndex/toggle
```

`:subtaskIndex` es el indice base 0 de la subtarea en el array `subtasks` del frontmatter.

#### Marcar/desmarcar criterio manual

```
POST /api/projects/:projectId/stories/:storyId/criteria/:criteriaType/:criteriaIndex/toggle
```

`:criteriaType` es `ready` o `done`. `:criteriaIndex` es el indice base 0. Solo funciona con `kind: manual`. Los criterios `kind: derived` no se pueden marcar via API; hay que actualizar el dato fuente.

### Valores de enum validos

| Campo en API | Campo en frontmatter | Valores aceptados |
| --- | --- | --- |
| `status` | `status` | `backlog`, `developing`, `testing`, `done` |
| `priority` | `priority` | `low`, `medium`, `high` |
| `executionMode` | `execution_mode` | `human`, `agent`, `hybrid` |
| `storyType` | `story_type` | `feature`, `bug`, `tech_debt`, `research`, `chore` |
| `kind` (criterios) | `kind` | `manual`, `derived` |

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

- La historia vive en `docs/kanban/stories/<STORY_ID>.md` dentro del repositorio del proyecto.
- El nombre del archivo debe coincidir con `id`.
- `project` es un identificador documental; debe coincidir EXACTAMENTE (case-sensitive) con el `id` del proyecto en `config/projects.json`.
- `epic` puede faltar o ser `null`; eso significa `Sin epica`.
- `blocked_by` con referencias inexistentes bloquea la historia.
- `blocks` y `related_to` nunca bloquean a la propia historia.
- `status: done` no implica `done validado`.
- `labels` no tienen semantica de ejecucion.

### Campos de story

| Campo | Obligatorio | Tipo | Valores / forma | Clasificacion | Significado exacto | Cuando usarlo | Quien lo actualiza | Regla para agentes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | si | string | ID estable, idealmente `STO-*` | enforced by backend | Identificador unico de la historia | Siempre | humano o agente al crear | Nunca cambiar salvo migracion intencional |
| `type` | si | string | `story` | informational only | Tipo documental del archivo | Siempre | humano o agente al crear | Debe ser `story` |
| `project` | si | string | ID del proyecto en config/projects.json | informational only | Vinculo documental con el proyecto | Siempre | humano o agente al crear | Debe coincidir exactamente (case-sensitive) con `id` en config/projects.json |
| `title` | si | string | texto no vacio | enforced by backend | Nombre corto de la historia | Siempre | humano o agente | Debe resumir el trabajo sin ambiguedad |
| `description` | no | string | texto corto | reflected by UI | Resumen breve visible en board y detalle | Cuando haga falta resumen rapido | humano o agente | No sustituye el cuerpo Markdown |
| `epic` | no | string o `null` | ID de epica o ausente | enforced by backend | Asociacion con una epica | Cuando la historia pertenezca a una epica | humano o agente | Ausente o `null` es valido y significa `Sin epica` |
| `status` | si | string | `backlog`, `developing`, `testing`, `done` | enforced by backend | Estado operativo de la historia | Siempre | humano o agente | Nunca inventar otros estados |
| `priority` | no | string | `low`, `medium`, `high` | enforced by backend | Prioridad documental | Cuando el equipo quiera priorizacion visible | humano o agente | No cambia permisos ni readiness |
| `assignee` | no | string o `null` | nombre humano libre | informational only | Persona humana relacionada con la historia | Cuando haya contraparte o responsable humano | humano o agente | Tratar siempre como metadata; no autoriza ni bloquea al agente |
| `agent_owner` | no | string o `null` | identidad del agente | agent-policy only | Agente ejecutor esperado | Obligatorio para ejecucion principal en `agent` o `hybrid` | agente u orquestador | Si falta en modos agénticos, no ejecutar como owner |
| `execution_mode` | no pero normativamente requerido | string | `human`, `agent`, `hybrid` | enforced by backend + agent-policy only | Modo de ejecucion que manda sobre ownership | Siempre que la historia vaya a trabajarse | humano o agente | Si se omite, el backend asume `human`; siempre especificarlo |
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

- La epica vive en `docs/kanban/epics/<EPIC_ID>.md` dentro del repositorio del proyecto.
- El nombre del archivo debe coincidir con `id`.
- La epica agrupa historias, pero no define permisos de ejecucion por si misma.

### Campos de epic

| Campo | Obligatorio | Tipo | Valores / forma | Clasificacion | Significado exacto | Cuando usarlo | Quien lo actualiza | Regla para agentes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | si | string | ID estable, idealmente `EPI-*` | enforced by backend | Identificador unico de la epica | Siempre | humano o agente al crear | No cambiar salvo migracion intencional |
| `type` | si | string | `epic` | informational only | Tipo documental del archivo | Siempre | humano o agente al crear | Debe ser `epic` |
| `project` | si | string | ID del proyecto en config/projects.json | informational only | Vinculo documental con el proyecto | Siempre | humano o agente al crear | Debe coincidir exactamente (case-sensitive) con `id` en config/projects.json |
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
- Puede marcarse via API con el endpoint de toggle, o actualizando `checked: true` directamente en el `.md`.

### Criterio derivado

- Se calcula solo a partir del frontmatter y las reglas soportadas.
- El agente no debe marcarlo ni en el `.md` ni via API; debe actualizar el dato fuente que hace que la regla se cumpla.
- El endpoint de toggle rechaza criterios `kind: derived` con 400.

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
- Las transiciones a `testing` y `done` no tienen validacion automatica en el backend; es responsabilidad del agente aplicar la politica normativa.

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
agent_owner: nombre-agente
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

1. Confirmar `KANBAN_ROOT` en el contexto de la tarea. Si no esta, pedirlo.
2. Leer el `.md` de la historia.
3. Si `blocked_by` referencia historias inexistentes, tratarlo como bloqueo real.
4. Si `execution_mode` es `human`, no ejecutar trabajo principal.
5. Si `execution_mode` es `agent` o `hybrid` y falta `agent_owner`, no ejecutar trabajo principal.
6. Si se toma posesion de una historia, reflejarlo en `agent_owner`.
7. Si se avanza trabajo real, actualizar `last_agent_update` con timestamp ISO y resumir el punto actual en `agent_status_note`.
8. Si se completan subtareas o criterios manuales, persistirlos en el frontmatter antes de terminar.
9. Para cambios de estado, usar la API si el servidor esta en marcha (aplica validaciones automaticas). Para edicion de campos, escribir el `.md` directamente.
10. Usar la UI solo como verificacion visual final, nunca como base para decidir que escribir.

## Como preparar un proyecto nuevo para Local Kanban

1. Confirmar `KANBAN_ROOT`.

2. Leer `KANBAN_ROOT/config/projects.json`. Si no existe, ejecutar `npm run setup -- --no-interactive`.

3. Verificar que no existe ya el proyecto por `id` o `rootPath`. Añadir la entrada y escribir el archivo completo.

4. Crear la estructura en el repositorio del proyecto (o dejar que la API la cree al insertar la primera historia):

```text
docs/kanban/epics/
docs/kanban/stories/
```

5. Si el repo ya tiene documentacion de producto, convertirla a epicas e historias Markdown sin perder contexto tecnico. Asignar IDs estables.

6. Usar el frontmatter minimo y las reglas de esta skill.

## Qué no hacer

- No asumir `KANBAN_ROOT` sin tenerlo confirmado en el contexto.
- No asumir que el directorio de trabajo actual (`CWD`) es `KANBAN_ROOT`; cuando se trabaja en un repo externo, son rutas distintas.
- No sobrescribir `config/projects.json` sin leer primero su contenido actual.
- No escribir `.md` de historias o epicas dentro de `KANBAN_ROOT`; pertenecen al repositorio del proyecto.
- No usar `KANBAN_ROOT` como valor de `rootPath` al registrar un proyecto externo.
- No ejecutar `npm run setup` desde el directorio del proyecto externo; corre en `KANBAN_ROOT`.
- No usar la UI como fuente de verdad.
- No dejar el `.md` desactualizado respecto al trabajo real.
- No borrar dependencias o criterios sin motivo claro.
- No reasignar `agent_owner` sin reflejar el relevo en `agent_status_note`.
- No asumir que `done` implica `done validado`.
- No asumir que `has_assignee` significa solo `assignee`; tambien vale `agent_owner`.
- No confiar en defaults silenciosos del backend para arreglar frontmatter mal formado.
- No tratar `assignee` como veto humano ni como permiso agéntico.
- No intentar registrar proyectos via API; no existe ese endpoint.
- No intentar eliminar historias o epicas via API; no existe ese endpoint.
- No marcar criterios derivados directamente ni via API; actualizar el dato fuente.
- No enviar campos en snake_case a la API; usa camelCase (ver tabla de nomenclatura).
- No omitir `executionMode` en el payload de API; el default es `"human"`.
- No crear IDs de historia o epica sin seguir el patron `STO-*` / `EPI-*` a menos que haya razon explicita.
