# Project Kanban Setup

Este documento está pensado para preparar cualquier repositorio local para integrarlo con `Local Kanban`.

## Objetivo

Dejar el proyecto con una estructura estándar para que la app lea épicas e historias desde Markdown sin configuración adicional aparte de la ruta en `config/projects.json`.

La semantica normativa de cada campo y la politica universal para agentes viven en `skills/local-kanban-agent/SKILL.md`. Este documento solo cubre preparacion y formato base.

## Estructura esperada

```text
docs/
  kanban/
    epics/
      EPI-001.md
    stories/
      STO-001.md
```

## Reglas

1. Crear `docs/kanban/epics` y `docs/kanban/stories` si no existen.
2. Usar un archivo Markdown por épica y un archivo Markdown por historia.
3. Mantener el estado de cada historia en el frontmatter YAML usando solo estos valores:
   - `backlog`
   - `developing`
   - `testing`
   - `done`
4. Las historias pueden referenciar una épica mediante el campo `epic`, pero no es obligatorio. Si no lo hacen, el board las agrupa en `Sin épica`.
5. El `id` debe ser estable y único dentro del proyecto.
6. El cuerpo Markdown puede contener toda la información libre adicional.
7. Para workflows con agentes, usar campos explícitos de ownership, dependencias y checklists.

## Regla de uso

- Usa siempre el contrato normativo para decidir semantica, ownership y permisos de ejecucion.
- Este documento solo define estructura minima y recomendaciones de preparacion.

## Plantilla de épica

```md
---
id: EPI-001
type: epic
project: mi-proyecto
title: Plataforma de autenticación
description: Base funcional para login, sesiones y permisos.
labels:
  - auth
  - foundation
---

## Objetivo

Centralizar el acceso de usuarios.

## Alcance

- Login
- Logout
- Gestión de sesión
```

## Plantilla de historia

```md
---
id: STO-001
type: story
project: mi-proyecto
title: Implementar login con email
description: Formulario inicial de acceso con validaciones.
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
context_files:
  - src/auth/login.ts
agent_status_note: Esperando credenciales OAuth
last_agent_update: 2026-04-09T10:30:00.000Z
labels:
  - auth
subtasks:
  - title: Diseñar formulario
    done: false
  - title: Validar payload
    done: false
ready_criteria:
  - id: deps-cleared
    label: Dependencias completadas
    kind: derived
    rule: dependencies_done
  - id: env-ready
    label: Variables de entorno disponibles
    kind: manual
    checked: false
done_criteria:
  - id: impl-complete
    label: Implementacion completada
    kind: manual
    checked: false
  - id: subtasks-done
    label: Todas las subtareas completadas
    kind: derived
    rule: all_subtasks_done
---

## Contexto

La autenticación inicial se hará con email y password.

## Criterios de aceptación

- El usuario puede autenticarse
- Los errores de validación se muestran en UI
```

## Qué debe hacer el agente en cada proyecto

1. Crear la estructura `docs/kanban`.
2. Añadir este formato base si el proyecto todavía no tiene épicas o historias.
3. Si ya existe documentación de producto, convertirla a este formato sin perder contenido útil.
4. No inventar estados fuera del conjunto soportado.
5. Mantener rutas y nombres consistentes para que el Kanban pueda leerlas.
6. Si la historia va a ser ejecutada por un agente, usar `agent_owner`, `execution_mode`, dependencias y checklists desde el inicio.
7. Si el trabajo avanza, actualizar tambien `agent_status_note`, `last_agent_update`, subtareas y criterios manuales.
8. Consultar `skills/local-kanban-agent/SKILL.md` para cualquier duda semantica o de politica operativa.
