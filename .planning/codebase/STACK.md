# Stack tecnologico

**Fecha del analisis:** 2026-07-14

## Resumen

Local Kanban es una aplicacion web local full-stack escrita en JavaScript.
El navegador presenta y edita el tablero, mientras un unico proceso Node.js expone la API y persiste los cambios en Markdown.
No existe una base de datos: los repositorios monitorizados y sus archivos `docs/kanban/**/*.md` son la fuente de verdad.

## Lenguajes y formatos

- JavaScript moderno con modulos ES (`"type": "module"`) en `package.json`.
- JSX para la interfaz React en `src/App.jsx` y `src/components/*.jsx`.
- CommonJS solo para la configuracion de PM2 en `ecosystem.config.cjs`.
- CSS plano, centralizado en `src/styles.css`.
- JSON para el registro local de proyectos en `config/projects.json` y su plantilla `config/projects.example.json`.
- Markdown con frontmatter YAML para epicas e historias, ejemplificado en `examples/kanban/` y `e2e/fixtures/source-project/docs/kanban/`.
- Shell de macOS para los accesos directos `Launch_Kanban.command` y `Stop_Kanban.command`.

## Runtime y requisitos

- Node.js 18 o superior es el requisito declarado y validado por `scripts/setup.js`.
- npm gestiona dependencias y comandos mediante `package.json`; `package-lock.json` usa lockfile v3.
- El backend usa APIs nativas de Node para archivos, paths, procesos, readline y vigilancia del filesystem.
- El navegador debe soportar `fetch`, `EventSource`, `ResizeObserver`, `localStorage` y SVG.
- En desarrollo, el frontend escucha por defecto en `localhost:5173` y la API en `127.0.0.1:4010`.

## Frontend

- React 18.3 y ReactDOM 18.3 montan la SPA desde `src/main.jsx`.
- `src/App.jsx` concentra el estado de aplicacion, seleccion de proyecto, filtros, edicion, drag and drop y refresco de datos.
- No hay Redux, Zustand ni otra store: el estado usa hooks de React (`useState`, `useEffect`, `useMemo`, `useTransition`, `useRef`).
- No hay router cliente: la aplicacion funciona como una unica vista y Express devuelve `dist/index.html` como fallback.
- `src/lib/api.js` encapsula llamadas HTTP relativas a `/api` usando `fetch` y JSON.
- `src/lib/story.js` contiene derivaciones de identificadores para historias y epicas.
- `src/lib/graph.js` transforma epicas, historias y relaciones en el modelo del grafo.
- `src/components/StoryGraphView.jsx` renderiza un grafo SVG y usa simulacion de fuerzas.
- `d3-force` implementa layout, colisiones, enlaces y centrado; `d3-zoom` aporta el modelo de transformacion.
- `d3-drag` y `d3-selection` estan declarados en `package.json`, aunque no aparecen importados en el codigo fuente actual.
- El drag and drop del tablero se implementa con eventos del navegador y logica de React, no con una libreria de DnD.
- La unica preferencia persistida en navegador detectada es la densidad visual mediante `localStorage` en `src/App.jsx`.

## Backend

- Express 4.21 proporciona el servidor HTTP monolitico en `server/index.js`.
- La API REST lee, enriquece, valida y reescribe epicas e historias.
- `express.json()` procesa los cuerpos JSON; no hay middleware de autenticacion, CORS, sesiones ni cookies.
- `gray-matter` 4.0 analiza y serializa el frontmatter YAML conservando el cuerpo Markdown.
- `node:fs/promises` realiza lectura, creacion y escritura de configuracion y documentos.
- `node:fs.watch` observa configuracion y directorios Kanban para avisar de cambios externos.
- Server-Sent Events en `GET /api/events` notifican al cliente que debe refrescar sus datos.
- El backend calcula bloqueos, readiness, checklists derivados, progreso por epica y referencias entre historias en memoria en cada carga.
- No hay ORM, esquema de base de datos, cache externo, cola de trabajos ni proceso worker separado.
- El mismo servidor Express sirve los assets compilados desde `dist/` en modo de produccion.

## Construccion y desarrollo

- Vite 5.4 compila la SPA desde `index.html` y sirve el cliente en desarrollo.
- `@vitejs/plugin-react` transforma JSX y habilita el flujo React de Vite en `vite.config.js`.
- El proxy de Vite dirige `/api` a la API local y admite override con `VITE_API_PROXY_TARGET`.
- `concurrently` levanta `dev:server` y `dev:client` con `npm run dev`.
- `node --watch server/index.js` reinicia el backend durante desarrollo.
- `npm run build` genera el bundle estatico en `dist/`.
- No se detecta TypeScript, ESLint, Prettier, Babel configurado directamente ni framework CSS.

## Ejecucion de produccion local

- PM2 5.4 ejecuta un unico proceso `kanban-server` definido en `ecosystem.config.cjs`.
- `npm start` construye primero el frontend y despues inicia PM2.
- El proceso usa `NODE_ENV=production`, `HOST=127.0.0.1` y `PORT=4010` por defecto.
- `Launch_Kanban.command` construye si hace falta, arranca PM2, sondea el servidor con `curl` y abre el navegador con `open`.
- `Stop_Kanban.command` delega la parada en `npm stop` y PM2.
- Estos accesos directos son especificos de macOS por el uso de archivos `.command` y del comando `open`.

## Pruebas

- Playwright 1.59 es el unico framework de tests configurado en `playwright.config.js`.
- Las pruebas E2E viven en `e2e/tests/` y se ejecutan en serie con un solo worker.
- `e2e/helpers/fixture.js` copia un proyecto fuente a `.e2e/workspace/` antes de probar para aislar datos locales reales.
- La configuracion E2E levanta Express en el puerto 4011 y Vite en el 4173 con un proxy dedicado.
- La suite valida tanto la UI como la persistencia real en los Markdown de la fixture.
- No se detecta suite unitaria o de integracion separada ni herramienta de cobertura.

## Configuracion por entorno

- `KANBAN_CONFIG_PATH` permite sustituir `config/projects.json`, principalmente para tests.
- `PORT` y `HOST` controlan el listener Express.
- `VITE_PORT` controla el servidor Vite de desarrollo.
- `VITE_API_PROXY_TARGET` configura el destino del proxy `/api`.
- `LOCAL_KANBAN_SETUP_INTERACTIVE=1` fuerza el wizard de setup incluso fuera de un TTY normal.
- No se detectan archivos `.env`, gestor de secretos ni variables con credenciales externas.

