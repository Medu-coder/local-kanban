# Project Kanban Setup

Este documento está pensado para que otro agente pueda preparar cualquier repositorio local para integrarlo con `Local Kanban`.

## Objetivo

Dejar el proyecto con una estructura estándar para que la app lea épicas e historias desde Markdown sin configuración adicional aparte de la ruta en `config/projects.json`.

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
4. Las historias deben referenciar una épica mediante el campo `epic`.
5. El `id` debe ser estable y único dentro del proyecto.
6. El cuerpo Markdown puede contener toda la información libre adicional.
7. Para workflows con agentes, usar campos explícitos de ownership, dependencias y checklists.

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
