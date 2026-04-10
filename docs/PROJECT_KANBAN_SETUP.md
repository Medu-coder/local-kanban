# Project Kanban Setup

Este documento esta pensado para preparar cualquier repositorio local para integrarlo con `Local Kanban`.

## Objetivo

Dejar el proyecto con una estructura estandar para que la app lea epicas e historias desde Markdown sin configuracion adicional aparte de la ruta en `config/projects.json`.

La semantica normativa de cada campo y la politica universal para agentes viven en `skills/local-kanban-agent/SKILL.md`. Este documento solo cubre preparacion y formato base.

## Contrato local obligatorio para agentes

Todo repositorio externo que vaya a trabajar con `Local Kanban` debe tener un archivo `AGENTS.md` en su raiz **antes de empezar cualquier trabajo tecnico**.

Ese archivo debe:

- referenciar `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md`
- importar todas sus reglas de trabajo sin excepcion
- declarar que esa skill tiene precedencia sobre cualquier resumen local

Si `AGENTS.md` ya existe, no se reemplaza: se amplia para incluir esta clausula normativa.

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

## Paso 2 — Crear o actualizar `AGENTS.md` en el proyecto

Dentro del repositorio externo crea `AGENTS.md` en la raiz, o actualizalo si ya existe.

Contenido minimo obligatorio:

```md
# Agent Work Contract

Este repositorio trabaja bajo el contrato operativo definido por Local Kanban.

Referencia normativa obligatoria:
- `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md`

Importacion de reglas:
- Todas las reglas, obligaciones, restricciones, politicas de ejecucion y criterios de actualizacion definidos en `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md` quedan importados por referencia y forman parte de este contrato de trabajo sin excepciones.
- Si este archivo entra en conflicto con esa skill, prevalece la skill de Local Kanban.
- Ningun agente puede empezar trabajo tecnico, crear historias, mover estados ni cerrar tareas sin cumplir antes ese contrato.
- Mantener el Kanban actualizado durante la ejecucion real del trabajo es obligatorio, no opcional.
```

Sustituye `KANBAN_ROOT` por la ruta absoluta real del repositorio `Local Kanban` si el agente ya la conoce. Tambien puedes partir de [AGENTS_WORK_CONTRACT_TEMPLATE.md](AGENTS_WORK_CONTRACT_TEMPLATE.md).

## Paso 3 — Crear la estructura en el proyecto

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
2. Crear o actualizar `AGENTS.md` en la raiz del repo externo para importar `skills/local-kanban-agent/SKILL.md` sin excepciones.
3. Usar un archivo Markdown por epica y un archivo Markdown por historia.
4. Mantener el estado de cada historia en el frontmatter YAML usando **solo** estos valores exactos:
   - `backlog`
   - `developing`
   - `testing`
   - `done`
   Cualquier otro valor es invalido aunque parezca equivalente. Ver contrato completo en SKILL.md.
5. Las historias pueden referenciar una epica mediante el campo `epic`, pero no es obligatorio. Si no lo hacen, el board las agrupa en `Sin epica`.
6. El `id` debe ser estable y unico dentro del proyecto. Patron obligatorio: `STO-*` para historias, `EPI-*` para epicas.
7. El cuerpo Markdown puede contener toda la informacion libre adicional.
8. En proyectos con agentes, todos los campos de ownership, dependencias y checklists son **obligatorios**, no opcionales: `agent_owner`, `execution_mode`, `blocked_by`, `subtasks`, `ready_criteria`, `done_criteria`.

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
4. Crear o actualizar `TU_PROYECTO/AGENTS.md` con una clausula que importe `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md` y todas sus reglas sin excepcion.
5. Crear la estructura `docs/kanban/epics` y `docs/kanban/stories` **dentro del repositorio del proyecto externo**, no en `KANBAN_ROOT`.
6. Añadir este formato base si el proyecto todavia no tiene epicas o historias.
7. Si ya existe documentacion de producto, convertirla a este formato sin perder contenido util.
8. No inventar estados fuera del conjunto soportado. Solo `backlog`, `developing`, `testing`, `done`.
9. Mantener rutas y nombres consistentes para que el Kanban pueda leerlas.
10. Asignar `execution_mode: agent` por defecto a todas las historias que un agente pueda ejecutar de principio a fin. Usar `hybrid` si requiere participacion humana puntual. Reservar `human` solo para trabajo genuinamente imposible para un agente, con justificacion explicita en el cuerpo.
11. **Obligatorio** actualizar `agent_status_note`, `last_agent_update`, subtareas y criterios manuales a medida que el trabajo avanza — no al final. Ver contrato completo en SKILL.md ("Contrato de actualizacion obligatoria durante la ejecucion").
12. Los agentes iteran indefinidamente hasta completar todo el trabajo. Solo se detienen ante bloqueos que requieren intervencion humana real. Ver "Politica de iteracion continua" en SKILL.md.
13. Consultar `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md` para cualquier duda semantica o de politica operativa. Ese documento tiene precedencia sobre cualquier otro.

> El campo `rootPath` de la entrada en `config/projects.json` debe apuntar al directorio raiz del proyecto externo, no a `KANBAN_ROOT`.
