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

## Modelo multiagéntico

`Local Kanban` esta disenado para coordinar multiples agentes especialistas trabajando en paralelo sobre el mismo proyecto. Hay dos roles diferenciados: el **orquestador** y el **especialista**.

### Roles

**Orquestador**

El agente orquestador es el punto de entrada. Sus responsabilidades son:

1. Conocer `KANBAN_ROOT` y el repositorio del proyecto.
2. Registrar el proyecto en el Kanban si aun no esta registrado.
3. Leer el documento de especificaciones del proyecto o el repositorio para entender el trabajo a realizar.
4. Crear las epicas (agrupadores tematicos del trabajo).
5. Crear las historias, asignando a cada una el `agent_owner` que corresponde al especialista con las capacidades para ejecutarla. Aplicar la politica de `execution_mode`: `agent` por defecto, `hybrid` si el trabajo requiere participacion humana puntual, `human` solo como excepcion con justificacion explicita en el cuerpo de la historia (ver "Politica de execution_mode al crear historias").
6. Determinar que agentes especialistas hay que invocar leyendo las historias pendientes.
7. Invocar un agente especialista por cada `agent_owner` distinto con historias ejecutables.

El orquestador no ejecuta el trabajo de las historias; su trabajo termina cuando los especialistas estan en marcha.

**Especialista**

El agente especialista recibe su identidad y el contexto del proyecto. Sus responsabilidades son:

1. Filtrar las historias del proyecto que le corresponden: `execution_mode: agent`, `agent_owner == su identidad`, `status != done`.
2. Ejecutar cada historia respetando bloqueos y readiness.
3. Actualizar el frontmatter a medida que avanza (estado, subtareas, criterios, `agent_status_note`, `last_agent_update`).

El especialista no crea historias ni registra proyectos; opera exclusivamente sobre las historias que le han sido asignadas.

### Como el orquestador determina que agentes invocar

Despues de crear las historias, el orquestador debe leer el proyecto (via API o directamente los `.md`) y extraer los valores unicos de `agent_owner` que cumplan todas estas condiciones:

- `execution_mode` es `agent` o `hybrid`
- `status` es distinto de `done`
- `agent_owner` no es `null`

Cada valor unico resultante requiere una instancia de agente especialista. Si dos historias tienen el mismo `agent_owner`, las gestiona el mismo agente; no se invocan dos instancias del mismo especialista.

```
agent_owner unico A → invocar especialista A
agent_owner unico B → invocar especialista B
agent_owner unico C → invocar especialista C
```

Los especialistas A, B y C pueden ejecutarse en paralelo si no tienen dependencias entre sus historias.

### Contexto minimo que debe recibir un especialista

El orquestador debe pasar al especialista al menos:

- `KANBAN_ROOT`: ruta absoluta al directorio de Local Kanban
- ID del proyecto tal como esta en `config/projects.json`
- Su identidad como `agent_owner` (para filtrar sus historias)

Opcionalmente: ruta absoluta al repositorio del proyecto si el especialista necesita leer o modificar codigo.

### Tipos de agente especialista

Los tipos de especialista son libres; cada proyecto los define segun sus necesidades. El orquestador es quien decide que tipo de especialista corresponde a cada historia en funcion del trabajo que describe. Ejemplos no normativos: `frontend-agent`, `backend-agent`, `qa-agent`, `devops-agent`, `data-agent`.

No existe un catalogo global de tipos. El unico contrato es que el valor de `agent_owner` en la historia debe coincidir exactamente con la identidad que el especialista usa para filtrar sus historias.

### Best practice: crear historias desde un documento de especificaciones

El orquestador deberia leer un documento de especificaciones del proyecto antes de crear epicas e historias (ej. `docs/specs.md`, `README.md`, un PRD o cualquier documento de producto disponible en el repositorio). Esto garantiza que el desglose refleja requisitos reales y que el `agent_owner` de cada historia refleja al especialista con las capacidades correctas.

Si no existe un documento de specs, el orquestador puede derivar el plan leyendo el codigo y la estructura del repositorio.

Este es un best practice, no un requisito. Las historias pueden crearse por cualquier via valida.

### Politica de iteracion continua

**Los agentes no paran salvo causa justificada.** El comportamiento por defecto es iterar indefinidamente hasta que todo el trabajo este en `done`.

#### Para el especialista

El especialista no termina su sesion al completar una historia. Despues de cada `done` debe:
1. Releer el proyecto para detectar historias desbloqueadas o nuevas historias asignadas a su `agent_owner`.
2. Continuar con la siguiente historia ejecutable.
3. Repetir hasta que no quede ninguna historia propia ejecutable.

El especialista **solo puede detenerse** en estos casos, y debe documentarlo:

| Causa de parada | Accion obligatoria antes de parar |
| --- | --- |
| Todas las historias propias en `done` | Notificar al orquestador via `agent_status_note` en la ultima historia completada |
| Historia bloqueada por accion humana inevitable (firma, aprobacion externa, decision ejecutiva) | Escribir el impedimento en `agent_status_note` y esperar instruccion del orquestador |
| Bloqueo tecnico que el agente no puede resolver ni el orquestador puede desbloquear remotamente | Escribir el impedimento detallado en `agent_status_note`; el orquestador decidira si reasigna o escala al humano |

Parar por cualquier otra razon — incertidumbre, falta de contexto, duda sobre el enfoque — **no es valido**. En esos casos el agente debe consultar al orquestador actualizando `agent_status_note` con la pregunta concreta y continuar con otras historias ejecutables mientras espera respuesta.

#### Para el orquestador

El orquestador tampoco termina al lanzar los especialistas. Permanece activo como fuente de contexto y guia hasta que el proyecto este completo:

- Monitoriza periodicamente el estado de todas las historias.
- Cuando un especialista tiene dudas o esta bloqueado, lee su `agent_status_note` y responde actualizando esa nota o el cuerpo de la historia con el contexto necesario para desbloquear.
- Si ningun especialista puede avanzar por causas que requieren intervencion humana real, el orquestador escala al humano con un resumen claro de que se necesita y por que.

**El unico motivo legitimo para que el orquestador cierre la sesion** es que todas las historias de `execution_mode: agent` o `hybrid` esten en `done` o que las unicas pendientes sean de `execution_mode: human` esperando accion del humano.

### Monitorizacion y gestion de bloqueos

El orquestador no termina cuando lanza los especialistas. Tiene la vision global del proyecto que ningun especialista posee individualmente, y debe usarla para detectar y resolver bloqueos.

#### Senales de alerta a monitorizar

El orquestador debe leer periodicamente las historias del proyecto y evaluar:

| Senal | Como detectarla | Significado |
| --- | --- | --- |
| Agente estancado | `status: developing` y `last_agent_update` sin cambios durante un tiempo prolongado | El especialista puede estar bloqueado sin haberlo declarado |
| Bloqueo declarado | `agent_status_note` describe un impedimento explicitamente | El especialista ha reconocido que no puede avanzar solo |
| Dependencia sin resolver | `blocked_by` contiene historias con `status != done` | La historia no puede avanzar hasta que se complete la dependencia |
| Criterios de readiness sin cumplir | `ready_criteria` incompletos y la historia lleva tiempo en `backlog` | Nadie ha tomado accion para cumplir las condiciones de entrada |
| Historia sin `agent_owner` | `execution_mode: agent` pero `agent_owner: null` | Ningún especialista ha tomado ownership; la historia no avanza |

#### Acciones disponibles para el orquestador

Ante una alerta, el orquestador puede tomar las siguientes acciones segun el tipo de bloqueo:

**Aportar contexto y guia:**
- Actualizar `agent_status_note` de la historia bloqueada con informacion global que el especialista no tiene (dependencias en otros modulos, decisiones de arquitectura, prioridad relativa).
- Dejar en el cuerpo Markdown de la historia un handoff explicito con el contexto necesario para desbloquear.

**Resolver dependencias:**
- Si una historia que bloquea a otra lleva tiempo estancada, el orquestador puede reasignar su `agent_owner` a un especialista diferente o mas disponible.
- Si la dependencia ya esta resuelta fuera del Kanban (trabajo hecho pero no registrado), actualizar el `status` de la historia bloqueante a `done`.
- Si la dependencia es imposible de resolver, evaluar si se puede eliminar del `blocked_by` con justificacion explicita en `agent_status_note`.

**Reasignar ownership:**
- Si un especialista lleva demasiado tiempo sin actualizar su historia, el orquestador puede cambiar `agent_owner` a otro especialista con capacidades equivalentes y dejar trazabilidad del relevo en `agent_status_note`.

**Replantear el plan:**
- Si un bloqueo revela un problema de diseno en el desglose original, el orquestador puede crear nuevas historias, modificar dependencias existentes o reordenar prioridades para desatascar el flujo global.
- Ante cambios significativos en el plan, actualizar el `agent_status_note` de las historias afectadas para que los especialistas tengan contexto actualizado.

#### Lo que el orquestador nunca debe hacer durante la monitorizacion

- No ejecutar trabajo tecnico de las historias en lugar del especialista asignado.
- No cambiar `agent_owner` sin dejar nota del relevo en `agent_status_note`.
- No marcar una historia como `done` sin verificar que el trabajo esta realmente completo.
- No eliminar dependencias (`blocked_by`) sin entender por que existian.

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

### Politica de execution_mode al crear historias

Al crear historias, el orquestador debe maximizar el uso de `agent` y minimizar `human` al maximo. La regla de decision es:

1. **¿Puede un agente completar este trabajo de principio a fin sin intervencion humana?** → `agent`. Este es el caso por defecto; la mayoria de historias deben ser `agent`.
2. **¿El trabajo puede hacerlo un agente en su mayor parte, pero requiere participacion humana en algun paso concreto?** (revision de producto, aprobacion, decision estrategica, aportacion de contexto que el agente no puede obtener) → `hybrid`.
3. **¿El trabajo es genuinamente imposible para un agente?** (contacto con personas externas, firma legal, accion fisica fuera del entorno digital, decision ejecutiva de negocio) → `human`. **Obligatorio:** el cuerpo de la historia debe justificar explicitamente por que no puede ser `agent` o `hybrid`. Una historia `human` sin justificacion es un error de planificacion.

Resumen de valores:

| `execution_mode` | Cuando usarlo | Frecuencia esperada |
| --- | --- | --- |
| `agent` | El agente puede completar el trabajo de principio a fin | Mayoria de historias |
| `hybrid` | Agente hace la mayor parte; humano interviene puntualmente | Casos con validacion o input humano necesario |
| `human` | Trabajo imposible para un agente; justificacion obligatoria en el cuerpo | Excepcion rara y justificada |

## Contrato estricto de valores permitidos

**Usar un valor no listado aqui es una violacion del contrato, independientemente de que parezca semanticamente equivalente.**

El backend puede normalizar o ignorar silenciosamente valores invalidos aplicando un default, lo que corrompe el dato sin emitir error visible. Un agente que use valores no listados introduce inconsistencias que se propagan sin traza.

### Enums de historia — lista cerrada y exhaustiva

| Campo | Valores permitidos. Solo estos. Ninguno mas. |
| --- | --- |
| `status` | `backlog` · `developing` · `testing` · `done` |
| `priority` | `low` · `medium` · `high` |
| `execution_mode` | `human` · `agent` · `hybrid` |
| `story_type` | `feature` · `bug` · `tech_debt` · `research` · `chore` |
| `type` | `story` |
| `kind` (criterio) | `manual` · `derived` |

### Enums de epica — lista cerrada y exhaustiva

| Campo | Valores permitidos. Solo estos. Ninguno mas. |
| --- | --- |
| `type` | `epic` |

### Campos con forma fija

| Campo | Forma obligatoria |
| --- | --- |
| `id` (story) | Patron `STO-*`; estable tras creacion, nunca cambiar |
| `id` (epic) | Patron `EPI-*`; estable tras creacion, nunca cambiar |
| `project` | Debe coincidir EXACTAMENTE (case-sensitive) con el `id` en `config/projects.json` |
| `last_agent_update` | ISO 8601 o `null`. No usar formatos de fecha libres ni strings arbitrarios |

### Regla de cumplimiento

Si un campo tiene un conjunto cerrado de valores, el agente debe usar uno de esos valores exactos. Si el valor correcto no figura en la lista, debe detenerse y consultar al humano antes de escribir. No existe excepcion a esta regla.

Ejemplos de violaciones frecuentes que el backend puede aceptar silenciosamente y que **estan prohibidas**:

| Valor escrito | Por que es incorrecto | Valor correcto |
| --- | --- | --- |
| `in_progress`, `in-progress`, `doing` | No es un status valido | `developing` |
| `urgent`, `critical`, `p0` | No es una priority valida | `high` |
| `autonomous`, `ai`, `bot` | No es un execution_mode valido | `agent` |
| `task`, `improvement`, `spike` | No es un story_type valido | usar el mas aproximado de la lista |
| `epic` en campo `type` de historia | Solo valido en epicas | `story` |

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
- **Todo campo con valores enumerados acepta unica y exclusivamente los valores listados en "Contrato estricto de valores permitidos". Ningun otro valor es valido aunque parezca equivalente.**

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
| `subtasks` | no | objeto[] | `{ title, done }` | enforced by backend + reflected by UI | Desglose operativo del trabajo | Cuando el trabajo necesite pasos concretos | humano o agente | **Obligatorio marcar cada subtarea como `done: true` en el momento en que se completa. No se puede mover la historia a `done` con subtareas sin completar.** |
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
- **Todo campo con valores enumerados acepta unica y exclusivamente los valores listados en "Contrato estricto de valores permitidos". Ningun otro valor es valido aunque parezca equivalente.**

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

### Obligatoriedad de completar subtareas

**Cada subtarea debe marcarse `done: true` en el momento exacto en que se completa, no al final.** Completar el trabajo sin actualizar las subtareas es una violacion del contrato.

Un agente no puede mover una historia a `done` si quedan subtareas con `done: false`. La historia con subtareas incompletas no esta terminada aunque el trabajo real parezca finalizado: las subtareas son la evidencia verificable del avance.

Como marcar una subtarea completada:
- Via API: `POST /api/projects/:projectId/stories/:storyId/subtasks/:subtaskIndex/toggle`
- Via archivo: editar `done: true` en la subtarea correspondiente del frontmatter

### Obligatoriedad de completar criterios manuales

Los `done_criteria` de tipo `manual` deben marcarse `checked: true` uno a uno a medida que se verifican, no todos de golpe al final. Un criterio manual solo puede marcarse cuando el agente ha verificado de verdad la condicion que describe.

**Una historia no puede considerarse `done validado` si tiene `done_criteria` sin completar.**

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
  - bloqueos resueltos (`blocked_by` vacio o todas las referencias en `done`)
  - `ready_criteria` completos
  - permiso de ejecucion segun `execution_mode` y `agent_owner`
- Antes de mover a `testing`, el trabajo principal debe estar hecho, todas las subtareas completadas y `agent_status_note` actualizada.
- Antes de mover a `done`:
  - Todas las subtareas deben tener `done: true`. Sin excepcion.
  - Todos los `done_criteria` manuales deben tener `checked: true`. Sin excepcion.
  - `last_agent_update` y `agent_status_note` deben reflejar el cierre real.
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

## Punto de entrada: qué hacer cuando te dicen "empieza a trabajar"

Antes de actuar, el agente debe leer el estado actual del proyecto y determinar su rol y fase. Esta es la unica decision que tomar; todo lo demas esta prescrito por los flujos siguientes.

### Arbol de decision de arranque

```
¿Tiene el proyecto historias con execution_mode: agent o hybrid, status != done, y agent_owner asignado?
│
├── NO → Eres el orquestador en Fase 1.
│         Planifica: crea epicas e historias.
│         Cuando termines, continua a Fase 2.
│
└── SI → ¿Todas esas historias estan en status: done?
          │
          ├── SI → El proyecto esta completado. Informar al humano.
          │
          └── NO → ¿Tienes una identidad como agent_owner en el contexto?
                    │
                    ├── SI → Eres un especialista.
                    │         Ve al Flujo operativo del especialista.
                    │
                    └── NO → Eres el orquestador en Fase 2 o 3.
                              Comprueba si hay historias sin especialista activo:
                              - Si hay agent_owners sin instancia en marcha → Fase 2: lanzar especialistas.
                              - Si ya estan en marcha → Fase 3: monitorizar y desbloquear.
```

### Como lanzar especialistas en paralelo

El orquestador debe lanzar **un subagente por cada `agent_owner` unico** con historias ejecutables. Los subagentes se lanzan **simultaneamente**, no en secuencia, salvo que todas las historias de un especialista esten bloqueadas por historias de otro (en cuyo caso ese especialista puede esperar).

Cada subagente recibe como contexto minimo:
- `KANBAN_ROOT`: ruta absoluta al directorio de Local Kanban
- ID del proyecto en `config/projects.json`
- Su identidad: el valor exacto de `agent_owner` que tiene asignado en las historias
- Ruta al repositorio del proyecto si necesita leer o modificar codigo

El orquestador no espera a que un especialista termine antes de lanzar el siguiente. El paralelismo es el comportamiento esperado y correcto.

### Señal de que la ejecucion ha terminado

El orquestador puede cerrar la sesion cuando se cumplan simultaneamente:
- Todas las historias con `execution_mode: agent` o `hybrid` tienen `status: done`
- Las unicas historias pendientes (si las hay) son de `execution_mode: human` y estan documentadas con el handoff necesario para que el humano actue

Cualquier otra situacion — historias bloqueadas, especialistas con dudas, dependencias sin resolver — no es una condicion de cierre. El orquestador debe seguir activo y resolver.

## Flujo operativo del orquestador

**Fase 1 — Planificacion:**

1. Confirmar `KANBAN_ROOT`. Si no esta en el contexto, pedirlo.
2. Registrar el proyecto en `KANBAN_ROOT/config/projects.json` si no existe (ver Bootstrap).
3. Leer el documento de especificaciones del proyecto o el repositorio para entender el trabajo.
4. Crear las epicas necesarias via API o archivo.
5. Crear las historias: una por unidad de trabajo atomica. Para cada historia:
   - Asignar `agent_owner` al especialista con las capacidades adecuadas para ese trabajo.
   - Asignar `execution_mode` segun la politica: `agent` por defecto, `hybrid` si el agente necesita participacion humana puntual, `human` solo si el trabajo es genuinamente imposible para un agente y con justificacion explicita en el cuerpo de la historia (ver "Politica de execution_mode al crear historias").
   - Declarar `blocked_by` cuando haya dependencias entre historias.
   - Incluir `context_files` si hay archivos clave que el especialista debe revisar primero.

**Fase 2 — Lanzamiento:**

6. Leer el proyecto y extraer los `agent_owner` unicos con historias ejecutables (ver "Como el orquestador determina que agentes invocar").
7. Invocar un agente especialista por cada `agent_owner` unico, pasandole `KANBAN_ROOT`, el ID del proyecto y su identidad como `agent_owner`.

**Fase 3 — Monitorizacion continua:**

8. Leer periodicamente el estado del proyecto para detectar bloqueos (ver "Monitorizacion y gestion de bloqueos").
9. Ante cada alerta, tomar la accion correspondiente: aportar contexto, resolver dependencias, reasignar ownership o replantear el plan.
10. Si se lanzan nuevos especialistas o se reasignan historias, verificar que el contexto que reciben es suficiente para operar.
11. El orquestador permanece activo hasta que todas las historias del proyecto esten en `done`.

## Contrato de actualización obligatoria durante la ejecución

El especialista tiene la obligacion de mantener el frontmatter de cada historia sincronizado con el trabajo real en todo momento. Omitir una actualizacion no es una opcion: el kanban es la unica fuente de verdad sobre el estado del proyecto y otros agentes y el orquestador dependen de que los datos sean exactos.

### Que actualizar y cuándo — tabla prescriptiva

| Momento | Campo | Accion obligatoria |
| --- | --- | --- |
| Al tomar ownership | `agent_owner` | Confirmar o escribir la propia identidad |
| Al tomar ownership | `status` | Cambiar a `developing` via API |
| Al tomar ownership | `last_agent_update` | Escribir timestamp ISO 8601 actual |
| Al tomar ownership | `agent_status_note` | Escribir nota breve del inicio ("Iniciando implementacion de X") |
| Al completar cada subtarea | `subtasks[i].done` | Marcar `true` en el momento de completarla, no al final |
| Al verificar cada criterio manual | `ready_criteria` / `done_criteria` | Marcar `checked: true` en el momento de verificarlo |
| Ante cualquier bloqueo | `agent_status_note` | Describir el impedimento concreto |
| Ante cualquier bloqueo | `last_agent_update` | Actualizar timestamp |
| Al terminar el trabajo | `status` | Cambiar a `testing` via API |
| Al terminar el trabajo | `last_agent_update` | Actualizar timestamp |
| Al terminar el trabajo | `agent_status_note` | Escribir nota de cierre ("Trabajo completado, pendiente de validacion") |
| Al validar y cerrar | `status` | Cambiar a `done` via API |
| Al validar y cerrar | `last_agent_update` | Actualizar timestamp |
| Al validar y cerrar | `agent_status_note` | Escribir nota de cierre final |

### Reglas de sincronizacion

- **Nunca avanzar `status` sin haber actualizado primero `last_agent_update` y `agent_status_note`.** Un cambio de estado sin nota ni timestamp es un dato a medias.
- **Nunca marcar `status: done` con subtareas incompletas.** Todas las subtareas deben estar en `done: true`.
- **Nunca marcar `status: done` con `done_criteria` manuales sin verificar.** Todos los criterios manuales deben estar en `checked: true`.
- **`last_agent_update` debe reflejar el momento real de la ultima accion**, no el momento en que se escribio el `.md` por conveniencia. Si el agente no ha hecho nada nuevo, no debe actualizarlo.
- **`agent_status_note` debe ser operativa y actual**, no un historial. Cada escritura sustituye a la anterior; debe describir el estado presente, no el pasado.

### Frecuencia minima de actualizacion

No existe un intervalo de tiempo fijo, pero el agente debe actualizar el frontmatter:
- Al inicio de cada historia (toma de ownership)
- Tras completar cada subtarea
- Cada vez que el estado real cambia
- Al detectar un bloqueo
- Al terminar el trabajo de la historia

Un agente que completa trabajo sin actualizar el frontmatter es invisible para el orquestador y para el resto del sistema.

## Flujo operativo del especialista

1. Confirmar `KANBAN_ROOT`, ID del proyecto y propia identidad como `agent_owner`.
2. Leer las historias del proyecto que le corresponden: `execution_mode: agent` o `hybrid`, `agent_owner == propia identidad`, `status != done`.
3. Ordenar las historias: primero las que no tienen `blocked_by` pendientes y tienen `ready_criteria` completos (o sin criterios); despues el resto por prioridad.
4. Para cada historia ejecutable, en ese orden:
   a. Comprobar bloqueos: si `blocked_by` tiene historias con `status != done`, saltar a la siguiente.
   b. Comprobar `ready_criteria`: si no estan completos, saltar a la siguiente.
   c. Confirmar que `agent_owner` es la propia identidad o tomarlo si esta vacio.
   d. Mover a `developing` via API.
   e. Ejecutar el trabajo.
   f. Completar subtareas y criterios manuales a medida que se verifican.
   g. Actualizar `last_agent_update` y `agent_status_note` con el estado actual tras cada cambio real.
   h. Mover a `testing` cuando el trabajo este hecho pero pendiente de validacion.
   i. Mover a `done` cuando el trabajo este completo y validado.
5. **Tras marcar una historia como `done`:** releer el proyecto para detectar si alguna historia que estaba bloqueada por esta ha quedado desbloqueada. Si esa historia tiene `agent_owner == propia identidad`, incorporarla al ciclo inmediatamente. Si tiene un `agent_owner` distinto, actualizar `agent_status_note` de esa historia con una nota de que el bloqueo se ha resuelto para que el orquestador o el otro especialista lo detecten.
6. Repetir desde el paso 4. **El especialista no se detiene voluntariamente** entre historias; el ciclo es continuo hasta que se cumpla una condicion de parada valida (ver "Politica de iteracion continua").
7. Si quedan historias propias pero todas bloqueadas:
   - Actualizar `agent_status_note` de cada una con el impedimento concreto y detallado.
   - Si el bloqueo es una duda o falta de contexto, no parar: describirlo en `agent_status_note` y esperar respuesta del orquestador. Si hay otras historias ejecutables de otro tipo, continuar con ellas.
   - Si el bloqueo requiere accion humana inevitable, documentarlo y detener solo esa historia. Continuar con las demas si las hay.
   - Solo detener la sesion completa cuando no quede ninguna historia ejecutable propia bajo ninguna circunstancia agéntica.
8. Usar la UI solo como verificacion visual final, nunca como base para decidir que escribir.

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
- No marcar `status: done` con subtareas que tengan `done: false`; todas deben estar completadas antes.
- No marcar `status: done` con `done_criteria` manuales sin verificar; todos deben estar en `checked: true`.
- No dejar subtareas a medias al final de la historia: cada subtarea completada se marca en el momento en que se completa, no agrupadas al finalizar.
- No cambiar `status` sin actualizar simultaneamente `last_agent_update` y `agent_status_note`.
- No omitir `agent_status_note` durante la ejecucion; el orquestador y otros agentes dependen de esa nota para conocer el estado real.
- No escribir `last_agent_update` por adelantado o por convenio; debe reflejar el momento real de la ultima accion.
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
- No asignar `execution_mode: human` sin justificacion explicita en el cuerpo de la historia; `human` es una excepcion, no un default seguro.
- No crear IDs de historia o epica sin seguir el patron `STO-*` / `EPI-*` a menos que haya razon explicita.
- No usar valores de enum fuera de los listados en "Contrato estricto de valores permitidos"; el backend puede aceptarlos silenciosamente con un default, corrompiendo el dato sin error visible.
- No inventar variantes de `status` (`in_progress`, `in-review`, `doing`...): solo `backlog`, `developing`, `testing`, `done`.
- No inventar variantes de `priority` (`urgent`, `critical`, `p0`...): solo `low`, `medium`, `high`.
- No inventar variantes de `execution_mode` (`autonomous`, `ai`, `bot`...): solo `human`, `agent`, `hybrid`.
- No inventar variantes de `story_type` (`task`, `improvement`, `spike`...): solo `feature`, `bug`, `tech_debt`, `research`, `chore`.
- No escribir `last_agent_update` con formatos de fecha distintos a ISO 8601 o `null`.
- No detener la ejecucion por incertidumbre o falta de contexto sin haber consultado primero al orquestador via `agent_status_note`.
- No considerar el trabajo terminado al completar una historia; el ciclo continua con las siguientes historias ejecutables.
- No cerrar la sesion del orquestador mientras queden historias `agent` o `hybrid` sin `done`.
