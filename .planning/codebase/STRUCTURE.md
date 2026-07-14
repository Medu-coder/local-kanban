# Estructura del repositorio Local Kanban

**Fecha del análisis:** 2026-07-14

## Mapa de alto nivel

```text
kanban-local/
├── src/                         SPA React
│   ├── components/              Vistas, paneles y editores
│   └── lib/                     Cliente API, IDs y proyección a grafo
├── server/                      API Express y persistencia Markdown
├── scripts/                     Bootstrap local
├── skills/                      Contratos operativos para agentes
├── docs/                        Guías y plantillas de integración
├── config/                      Registro local de proyectos y ejemplo distribuible
├── examples/                    Ejemplos mínimos de épica e historia
├── e2e/                         Fixtures, helpers y pruebas Playwright
├── .planning/codebase/          Mapa generado del código existente
└── archivos raíz                Build, ejecución, tests y accesos macOS
```

## Entrada y composición de la SPA

`index.html` es el documento HTML de Vite y contiene el nodo de montaje.
`src/main.jsx` inicializa React, importa `src/styles.css` y renderiza `src/App.jsx`.
`src/App.jsx` es el composition root del frontend y el principal coordinador funcional.
No hay rutas frontend, context providers ni carpeta de estado global; toda la sesión se organiza desde hooks en `App`.

Responsabilidades centrales de `src/App.jsx`:

- cargar el snapshot completo y seleccionar el primer proyecto;
- mantener proyecto activo, filtros, búsqueda y vista `kanban`/`graph`;
- coordinar selección de historias y épicas;
- abrir, cerrar y proteger editores con cambios sin guardar;
- realizar actualizaciones optimistas y reconciliar con el backend;
- escuchar SSE y serializar refrescos;
- gestionar lanes colapsadas y paneles redimensionables;
- persistir únicamente la densidad de UI en `localStorage`.

## Componentes de `src/components/`

`src/components/ProjectSidebar.jsx` lista proyectos, selecciona el activo y cambia entre tablero y grafo.
`src/components/Toolbar.jsx` expone búsqueda, filtros de épica y modo de ejecución, conteo visible y acciones de creación.
`src/components/KanbanBoard.jsx` agrupa historias por épica y estado, calcula progreso del conjunto filtrado y recibe drops.
`src/components/StoryCard.jsx` representa la unidad draggable y resume estado operativo, prioridad, owner, bloqueos y validación.
`src/components/StoryDetail.jsx` presenta metadatos, relaciones, subtareas y checklists; emite toggles manuales al padre.
`src/components/StoryEditor.jsx` gestiona el formulario completo de historia, criterios y subtareas, y devuelve payload camelCase.
`src/components/EpicDetail.jsx` resume una épica y sus historias y permite editar o crear trabajo asociado.
`src/components/EpicManager.jsx` lista épicas y abre creación/edición.
`src/components/EpicEditor.jsx` gestiona el formulario completo de épica.
`src/components/StoryGraphView.jsx` renderiza y opera el SVG interactivo con simulación D3.

Los componentes no acceden directamente al filesystem.
Salvo `App`, tampoco llaman a la API; reciben entidades y callbacks por props.
Esta estructura mantiene las operaciones remotas centralizadas, aunque concentra bastante lógica de aplicación en un solo archivo.

## Utilidades de `src/lib/`

`src/lib/api.js` contiene el cliente HTTP basado en `fetch`.
Cada función corresponde a un endpoint de proyectos, historias, épicas, subtareas o criterios.
`handleJson()` normaliza errores del backend priorizando `detail`, luego `error` y después el mensaje fallback.
`updateStoryStatus()` existe como cliente, pero el flujo visible de drag usa `moveStory()` para soportar estado y épica a la vez.

`src/lib/story.js` contiene `toStorySlug()`, `deriveStoryId()` y `deriveEpicId()`.
La UI usa esas derivaciones para detectar colisiones antes de crear; el backend repite la derivación como autoridad final.

`src/lib/graph.js` transforma un proyecto enriquecido en `{nodes, edges, stats}`.
Genera posiciones iniciales, radios, progreso y aristas deduplicadas para membresía, `blocked_by`, `blocks` y `related_to`.
Su salida es independiente del DOM y se consume desde `StoryGraphView`.

## Backend en `server/`

`server/index.js` es el único archivo del backend y contiene todas sus capas funcionales:

1. constantes de dominio y valores válidos;
2. coerción y normalización de input/Markdown;
3. evaluación de criterios derivados;
4. enriquecimiento de historias y agregación de épicas;
5. carga de configuración y colecciones Markdown;
6. localización y escritura de archivos;
7. watchers de configuración y proyectos;
8. canal SSE;
9. rutas REST;
10. servicio de `dist/` y arranque HTTP.

La configuración se resuelve desde `KANBAN_CONFIG_PATH` o, por defecto, `config/projects.json`.
Las escrituras usan `gray-matter` y `fs/promises`; los watchers usan `node:fs` porque requieren `fs.watch`.
El servidor escucha en `127.0.0.1:4010` salvo override de `HOST` o `PORT`.
Después de las rutas API sirve `dist/` y devuelve `index.html` como fallback de SPA.

## Configuración en `config/`

`config/projects.example.json` es la plantilla distribuible sin rutas privadas.
`config/projects.json` es la configuración local efectiva creada por setup y está ignorada por Git.
Cada elemento apunta a un repositorio externo mediante `rootPath` absoluto y un `docsPath` relativo.
La aplicación no valida un esquema formal al arrancar; los errores emergen al leer JSON o resolver directorios.

## Bootstrap y operación

`scripts/setup.js` verifica la versión de Node, crea la configuración local y soporta tres modos.
El modo no interactivo copia la plantilla si todavía no hay configuración.
`--projects-json` normaliza una lista suministrada por automatización, deriva IDs y exige rutas absolutas.
El modo interactivo pregunta si se desea configurar proyectos y recopila nombre, ruta y `docsPath`.
`--force` permite restablecer la configuración desde la plantilla.

`package.json` define comandos de setup, desarrollo, build, PM2 y Playwright.
`vite.config.js` configura React, puerto y proxy `/api`.
`ecosystem.config.cjs` describe el proceso PM2 de producción local.
`Launch_Kanban.command` facilita instalar/arrancar/abrir la aplicación desde macOS.
`Stop_Kanban.command` detiene el proceso gestionado por PM2.

## Contratos y documentación en `skills/` y `docs/`

`skills/local-kanban-agent/SKILL.md` es la fuente normativa única para agentes que operan proyectos conectados.
Documenta roles de orquestador y especialista, campos API/Markdown, endpoints, criterios, ownership y cierre.
Es especialmente importante la distinción entre camelCase en API y snake_case en frontmatter.
También advierte que los `PUT` reemplazan todos los campos y que el `move` sin `epicId` desvincula la historia.

`skills/local-kanban-installer/SKILL.md` guía a otro agente para clonar, instalar, configurar y verificar Local Kanban.
`docs/INSTALLATION_AND_SETUP.md` es la guía humana de instalación y ejecución.
`docs/PROJECT_KANBAN_SETUP.md` explica cómo preparar un repositorio externo con su árbol Markdown.
`docs/AGENTS_WORK_CONTRACT_TEMPLATE.md` proporciona el contrato `AGENTS.md` que importa la skill normativa.
`README.md` resume propósito, capacidades, comandos y puntos de entrada de documentación.

## Ejemplos de dominio

`examples/kanban/epics/EPI-001.md` muestra el frontmatter mínimo de una épica y un cuerpo de objetivo.
`examples/kanban/stories/STO-001.md` muestra una historia completa con ownership, relaciones, contexto, subtareas y criterios.
Estos ejemplos documentan el formato, pero no se cargan automáticamente salvo que un proyecto configurado apunte a ellos.

## Pruebas en `e2e/`

`playwright.config.js` levanta una API aislada en 4011 y Vite en 4173, con un único worker para evitar colisiones en filesystem.
`e2e/helpers/prepare-fixture-cli.js` prepara el workspace antes de arrancar el web server de pruebas.
`e2e/helpers/fixture.js` copia el proyecto fuente, escribe `.e2e/projects.json` y ofrece helpers para editar frontmatter.
`e2e/fixtures/source-project/` es el conjunto canónico de dos épicas y tres historias utilizado por los tests.
`.e2e/workspace/` es una copia generada y mutable; no es código fuente ni fuente de verdad del producto.

`e2e/tests/kanban.spec.js` cubre el flujo principal de UI: carga, paneles, creación, edición, drag, filtros, grafo y persistencia.
`e2e/tests/agent-mirror.spec.js` cubre el contrato central: cambios directos de un agente en Markdown reflejados en la UI.
También verifica referencias huérfanas, compatibilidad con criterios legacy y recálculo de validaciones derivadas.
`e2e/tests/install-bootstrap.spec.js` verifica bootstrap, idempotencia, reset forzado y configuración por argumento.
`test-results/` contiene estado generado por Playwright y no forma parte de la arquitectura del producto.

## Archivos generados y locales

`dist/` se genera con `npm run build` y es servido por Express en ejecución PM2.
`node_modules/` contiene dependencias instaladas y no debe editarse.
`.e2e/` y `test-results/` son artefactos de pruebas.
`.DS_Store` y `skills/.DS_Store` son metadatos locales de Finder sin función en el sistema.
`.claude/launch.json` y `.claude/settings.local.json` son configuración local de herramientas, no lógica de aplicación.

## Convenciones de ubicación para nuevos cambios

- Añadir una operación HTTP o regla persistente en `server/index.js` mientras el backend siga siendo monolítico.
- Añadir su wrapper de frontend en `src/lib/api.js`.
- Mantener la coordinación transversal en `src/App.jsx` y la representación específica en `src/components/`.
- Colocar transformaciones puras reutilizables en `src/lib/`, como se hace con IDs y grafo.
- Actualizar `skills/local-kanban-agent/SKILL.md` si cambia la semántica que deben cumplir agentes externos.
- Actualizar `docs/` si cambia instalación, bootstrap o preparación de proyectos.
- Añadir o ampliar Playwright en `e2e/tests/` para cambios de creación, edición, movimiento, validación o sincronización.
- Mantener fixtures fuente en `e2e/fixtures/source-project/`; no editar `.e2e/workspace/` como solución permanente.

## Dependencias estructurales clave

`src/App.jsx` depende de todos los componentes principales y de `src/lib/api.js`.
`src/components/KanbanBoard.jsx` depende de `StoryCard`.
`src/components/StoryGraphView.jsx` depende de `src/lib/graph.js` y de módulos D3.
`server/index.js` depende de Express, `gray-matter` y APIs nativas de Node.
Los proyectos externos no dependen del runtime React: solo del formato Markdown y del contrato importado en `AGENTS.md`.
Las pruebas E2E dependen de la API real, la SPA real y copias temporales de fixtures, por lo que ejercitan la integración completa.
