# Project Kanban Setup

Este documento esta pensado para preparar cualquier repositorio local para integrarlo con `Local Kanban`.

## Objetivo

Dejar el proyecto con una estructura estandar para que la app lea epicas e historias desde Markdown sin configuracion adicional aparte de la ruta en `config/projects.json`.

La semantica normativa de cada campo y la politica universal para agentes viven en `skills/local-kanban-agent/SKILL.md`. Este documento solo cubre preparacion y formato base.

## Arquitectura: Kanban y proyectos son directorios separados

`Local Kanban` vive en su propio directorio (`KANBAN_ROOT`) y monitoriza otros repositorios como proyectos externos. Cada proyecto monitorizado es un repositorio independiente.

```
KANBAN_ROOT/              ← app Local Kanban (este repositorio)
  config/projects.json    ← lista de proyectos monitorizados
  skills/local-kanban-agent/SKILL.md  ← contrato normativo para agentes

TU_PROYECTO/              ← repositorio externo (CWD del agente)
  docs/kanban/
    epics/
    stories/
```

Un agente que trabaja en `TU_PROYECTO` opera sobre **dos rutas distintas**:
- Escribe en `KANBAN_ROOT/config/projects.json` para registrar el proyecto.
- Escribe en `TU_PROYECTO/docs/kanban/` para crear epicas e historias.

Nunca escribir `.md` de historias o epicas dentro de `KANBAN_ROOT`.

## Paso 1 — Registrar el proyecto en el Kanban

Edita `KANBAN_ROOT/config/projects.json` y añade una entrada:

```json
[
  {
    "id": "mi-proyecto",
    "name": "Mi proyecto",
    "rootPath": "/ruta/absoluta/al/proyecto",
    "docsPath": "docs/kanban"
  }
]
```

Este paso es obligatorio. Sin el, el Kanban no sabe que el proyecto existe. No hay endpoint de API para registrar proyectos; la unica forma es editar este archivo.

Si `config/projects.json` no existe todavia, ejecuta `npm run setup -- --no-interactive` en `KANBAN_ROOT` para crearlo desde la plantilla antes de editarlo.

## Paso 2 — Crear la estructura en el proyecto

Dentro del repositorio del proyecto, crea las carpetas que el Kanban espera:

```text
docs/
  kanban/
    epics/
      EPI-001.md
    stories/
      STO-001.md
```

Las carpetas `epics/` y `stories/` deben existir aunque esten vacias para que el Kanban las encuentre.

## Reglas

1. Crear `docs/kanban/epics` y `docs/kanban/stories` si no existen.
2. Usar un archivo Markdown por epica y un archivo Markdown por historia.
3. Mantener el estado de cada historia en el frontmatter YAML usando solo estos valores:
   - `backlog`
   - `developing`
   - `testing`
   - `done`
4. Las historias pueden referenciar una epica mediante el campo `epic`, pero no es obligatorio. Si no lo hacen, el board las agrupa en `Sin epica`.
5. El `id` debe ser estable y unico dentro del proyecto.
6. El cuerpo Markdown puede contener toda la informacion libre adicional.
7. Para workflows con agentes, usar campos explicitos de ownership, dependencias y checklists.

## Regla de uso

- Usa siempre el contrato normativo para decidir semantica, ownership y permisos de ejecucion.
- Este documento solo define estructura minima y recomendaciones de preparacion.

## Plantilla de epica

```md
---
id: EPI-001
type: epic
project: mi-proyecto
title: Plataforma de autenticacion
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
- Gestion de sesion
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

La autenticacion inicial se hara con email y password.

## Criterios de aceptacion

- El usuario puede autenticarse
- Los errores de validacion se muestran en UI
```

## Que debe hacer el agente en cada proyecto

1. Conocer la ruta absoluta de `KANBAN_ROOT` (donde esta instalado Local Kanban). Si no la tiene, pedirla antes de continuar.
2. Leer `KANBAN_ROOT/config/projects.json` (leer primero, nunca sobrescribir sin leer).
3. Registrar el proyecto en `config/projects.json` si aun no aparece: añadir la entrada al array existente y escribir el archivo completo de vuelta.
4. Crear la estructura `docs/kanban/epics` y `docs/kanban/stories` **dentro del repositorio del proyecto externo**, no en `KANBAN_ROOT`.
5. Anadir este formato base si el proyecto todavia no tiene epicas o historias.
6. Si ya existe documentacion de producto, convertirla a este formato sin perder contenido util.
7. No inventar estados fuera del conjunto soportado.
8. Mantener rutas y nombres consistentes para que el Kanban pueda leerlas.
9. Si la historia va a ser ejecutada por un agente, usar `agent_owner`, `execution_mode`, dependencias y checklists desde el inicio.
10. Si el trabajo avanza, actualizar tambien `agent_status_note`, `last_agent_update`, subtareas y criterios manuales.
11. Consultar `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md` para cualquier duda semantica o de politica operativa.

> El campo `rootPath` de la entrada en `config/projects.json` debe apuntar al directorio raiz del proyecto externo, no a `KANBAN_ROOT`.
