# Installation And Setup

Esta guía sirve para clonar `Local Kanban` en otro PC, configurarlo con rutas locales nuevas y arrancarlo sin depender del entorno original.

## Requisitos

- Node.js 18 o superior
- npm
- Uno o más proyectos locales que vayan a ser monitorizados por el Kanban

Comprueba el entorno:

```bash
node --version
npm --version
```

## Instalación

```bash
git clone <repo-url> local-kanban
cd local-kanban
npm install
```

## Configuración de proyectos

1. Copia `config/projects.example.json` sobre `config/projects.json`.
2. Edita `config/projects.json`.
3. Sustituye `rootPath` por la ruta absoluta real de cada proyecto en esa máquina.
4. Mantén `docsPath` como `docs/kanban`, salvo que quieras usar otra carpeta por proyecto.

Ejemplo:

```json
[
  {
    "id": "billing-api",
    "name": "Billing API",
    "rootPath": "/Users/alguien/Code/billing-api",
    "docsPath": "docs/kanban"
  },
  {
    "id": "frontend-app",
    "name": "Frontend App",
    "rootPath": "/Users/alguien/Code/frontend-app",
    "docsPath": "docs/kanban"
  }
]
```

## Estructura esperada en cada proyecto

Cada proyecto monitorizado debe tener:

```text
docs/
  kanban/
    epics/
    stories/
```

La guía operativa para preparar esos repositorios está en [PROJECT_KANBAN_SETUP.md](PROJECT_KANBAN_SETUP.md).

## Arranque

Modo desarrollo:

```bash
npm run dev
```

Esto levanta:
- frontend Vite en `http://localhost:5173`
- API local en `http://localhost:4010`

Modo servidor API solo:

```bash
npm run start
```

## Verificación mínima

1. Abre `http://localhost:5173`.
2. Comprueba que aparece al menos un proyecto en el sidebar izquierdo.
3. Comprueba que las épicas e historias del proyecto se visualizan en el board.
4. Abre una historia y verifica que el detalle coincide con su `.md`.

## Si un proyecto no aparece bien

Revisa, en este orden:

1. `config/projects.json`
   - `rootPath` debe ser absoluto y existir en esa máquina.
2. Estructura `docs/kanban`
   - deben existir `epics/` y `stories/`
3. Frontmatter YAML
   - `id`, `title`, `status` y `type` deben ser válidos
4. Estados soportados
   - `backlog`
   - `developing`
   - `testing`
   - `done`

## Distribución

Si vas a compartir el proyecto por GitHub o como plantilla:

- no publiques tus rutas locales reales en `config/projects.json`
- publica `config/projects.example.json`
- documenta siempre que cada usuario debe crear su propio `config/projects.json`
- distribuye también la skill de agentes incluida en [skills/local-kanban-agent/SKILL.md](../skills/local-kanban-agent/SKILL.md)
