# Local Kanban

Kanban local multiproyecto inspirado en Jira para gestionar épicas e historias definidas en Markdown.

## Qué hace

- Lee proyectos configurados en `config/projects.json`.
- Escanea `docs/kanban/epics/*.md` y `docs/kanban/stories/*.md` dentro de cada proyecto.
- Agrupa historias por épica.
- Muestra el Kanban en swimlanes por épica, con progreso agregado por cada épica.
- Filtra por épica y busca por texto dentro del proyecto activo.
- Permite crear y editar historias desde la UI.
- Permite crear y editar épicas desde la UI.
- Permite crear historias rápidamente dentro de una épica concreta y en un estado concreto.
- Mueve historias entre `backlog`, `developing`, `testing` y `done` con drag and drop.
- Persiste el nuevo estado directamente en el `.md` original.
- Soporta ownership agéntico, dependencias entre historias y contexto operativo.
- Soporta `ready_criteria` y `done_criteria` como checklist interactivo con validación mixta.
- Bloquea el paso a `developing` cuando una historia no cumple sus dependencias o criterios de ready.

## Arranque

```bash
npm install
npm run setup
npm run dev
```

- Frontend: `http://localhost:5173`
- API local: `http://localhost:4010`

## Instalación Y Setup

La guía completa está en [docs/INSTALLATION_AND_SETUP.md](docs/INSTALLATION_AND_SETUP.md).

Resumen rápido:

```bash
git clone <repo-url> local-kanban
cd local-kanban
npm install
npm run setup
# editar config/projects.json con rutas absolutas reales si aún no lo has hecho
npm run dev
```

No hace falta construir un ejecutable nativo. El flujo recomendado es `clone -> npm install -> npm run setup`.

`npm run setup` abre un asistente guiado cuando detecta una terminal interactiva. Para agentes o automatizaciones, usa `npm run setup -- --no-interactive`.

Si un agente ya te ha preguntado qué proyectos quieres conectar, puede dejarlo configurado directamente con:

```bash
npm run setup -- --projects-json '[{"name":"Mi proyecto","rootPath":"/ruta/absoluta/al/proyecto"}]'
```

## Tests E2E

```bash
npm run test:e2e
```

La suite E2E usa Playwright con un workspace aislado en `.e2e/` y no depende de proyectos locales reales del usuario.

Cobertura actual:
- carga del proyecto y cierre de sidebars
- creación y edición de historias
- creación rápida desde el board
- validaciones agénticas de bloqueo y readiness
- checklists `ready` y `done`
- filtros y búsqueda
- creación de épicas

## Contrato de trabajo

Las features relevantes por volumen de código o por impacto funcional deben venir acompañadas de pruebas end-to-end o de la ampliación de la suite existente.

En este proyecto, el criterio por defecto es:
- si una feature cambia flujos principales de usuario, debe quedar cubierta por Playwright
- si una feature modifica creación, edición, movimiento o validación de historias/épicas, debe añadir o actualizar tests E2E
- no se da por cerrada una feature relevante si `npm run test:e2e` no pasa

## Configuración de proyectos

Edita `config/projects.json`:

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

Para distribución, usa [config/projects.example.json](config/projects.example.json) como plantilla y no publiques rutas locales reales.

## Skill Para Agentes

La skill distribuible y normativa para que cualquier agente entienda cómo operar con este Kanban está en:

[skills/local-kanban-agent/SKILL.md](skills/local-kanban-agent/SKILL.md)

La skill específica para instalar el repositorio desde Git y dejarlo listo está en:

[skills/local-kanban-installer/SKILL.md](skills/local-kanban-installer/SKILL.md)

Uso previsto:
- el agente trabaja sobre los `.md` como fuente de verdad
- la UI del Kanban se usa como espejo visual para humanos
- la skill es el unico punto de consulta para semantica y politica operativa

## Formato recomendado

Revisa [docs/PROJECT_KANBAN_SETUP.md](docs/PROJECT_KANBAN_SETUP.md), la skill de [skills/local-kanban-agent/SKILL.md](skills/local-kanban-agent/SKILL.md) y los ejemplos de [examples/kanban](examples/kanban).
