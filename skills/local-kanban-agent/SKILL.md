---
name: "local-kanban-agent"
description: "Usa Local Kanban como sistema operativo agéntico basado en Markdown para leer, ejecutar y actualizar historias y épicas dentro de proyectos locales."
---

# Local Kanban Agent Skill

Usa esta skill cuando trabajes en un repositorio que esté monitorizado por `Local Kanban` o cuando tengas que preparar un proyecto para que se integre con este sistema.

Esta skill debe ser autocontenida: el agente no debería necesitar leer otros documentos del repositorio para entender cómo operar con Local Kanban.

## Objetivo

Trabajar sobre historias y épicas definidas en Markdown, tratando esos `.md` como fuente de verdad. La UI del Kanban es un espejo para humanos; el agente debe operar pensando en el estado real de los archivos.

## Reglas base

1. La fuente de verdad son los archivos Markdown en `docs/kanban/epics` y `docs/kanban/stories`.
2. Nunca inventes estados fuera de:
   - `backlog`
   - `developing`
   - `testing`
   - `done`
3. Antes de empezar una historia, revisa:
   - `blocked_by`
   - `ready_criteria`
   - `context_files`
   - `agent_owner`
   - `execution_mode`
4. No muevas una historia a `developing` si no está lista.
5. Si terminas trabajo real en una historia:
   - actualiza subtareas
   - actualiza `agent_status_note`
   - actualiza `last_agent_update`
   - mueve el `status` si corresponde

## Dónde leer

### Épicas

```text
docs/kanban/epics/*.md
```

### Historias

```text
docs/kanban/stories/*.md
```

## Campos importantes de historia

### Operativos

- `status`
- `epic`
- `priority`
- `assignee`
- `agent_owner`
- `execution_mode`
- `story_type`

### Dependencias

- `blocked_by`
- `blocks`
- `related_to`

### Ejecución

- `context_files`
- `agent_status_note`
- `last_agent_update`
- `subtasks`
- `ready_criteria`
- `done_criteria`

## Cómo decidir si puedes empezar

Una historia está lista para pasar a `developing` cuando:

1. no está bloqueada por `blocked_by`
2. sus `ready_criteria` están cumplidos

Si no se cumplen esas condiciones:
- no la muevas a `developing`
- deja una nota breve en `agent_status_note`
- si hace falta, mantén `status: backlog`

## Cómo decidir si has terminado

Una historia puede considerarse lista para cierre cuando:

1. el trabajo real está hecho
2. las subtareas aplicables están completadas
3. los `done_criteria` están cumplidos

En ese punto:
- puedes moverla a `testing` o `done` según el flujo del proyecto
- deja trazabilidad breve en `agent_status_note`

## Cómo preparar un proyecto nuevo para Local Kanban

1. Crea:

```text
docs/kanban/epics
docs/kanban/stories
```

2. Si el repo ya tiene documentación de producto:
- conviértela a épicas e historias Markdown
- no pierdas contexto técnico útil
- asigna IDs estables

3. Usa este esquema mínimo de historia:

```md
---
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
---

Detalle libre en Markdown.
```

## Forma de trabajo recomendada para agentes

1. Leer la historia Markdown.
2. Verificar bloqueos y criterios de ready.
3. Revisar `context_files` antes de explorar el repo completo.
4. Ejecutar el trabajo.
5. Actualizar subtareas, criterios manuales y nota de estado.
6. Persistir cambios en el `.md`.
7. Solo entonces revisar la UI del Kanban si hace falta comprobar el espejo humano.

## Qué no hacer

- No usar la UI como fuente de verdad.
- No dejar el `.md` desactualizado respecto al trabajo real.
- No borrar dependencias o criterios sin motivo claro.
- No reasignar `agent_owner` sin reflejar el relevo en `agent_status_note`.
