# Integraciones externas

**Fecha del analisis:** 2026-07-14

## Resumen

La integracion central de Local Kanban no es un servicio remoto, sino el sistema de archivos local.
La aplicacion registra repositorios externos por ruta absoluta, consume sus documentos Kanban y escribe sobre esos mismos archivos.
Los agentes tambien operan sobre esa fuente de verdad, mientras la UI actua como espejo humano sincronizado.

## Repositorios de proyecto monitorizados

- El registro de proyectos esta en `config/projects.json`; `config/projects.example.json` define el esquema distribuible.
- Cada entrada contiene `id`, `name`, `rootPath` absoluto y `docsPath`, cuyo default funcional es `docs/kanban`.
- El servidor resuelve cada proyecto desde `rootPath/docsPath` en `server/index.js`.
- Las epicas se leen de `<rootPath>/<docsPath>/epics/*.md`.
- Las historias se leen de `<rootPath>/<docsPath>/stories/*.md`.
- El fichero de cada entidad se identifica por su nombre o por el campo `id` del frontmatter.
- Las operaciones de creacion y actualizacion escriben directamente en los Markdown del repositorio externo.
- El registro de un nuevo proyecto no tiene endpoint REST: se hace editando `config/projects.json` o ejecutando el setup.
- `config/projects.json` esta ignorado en `.gitignore` para evitar publicar rutas locales reales.
- La aplicacion tolera directorios de epicas o historias inexistentes al leerlos, y los crea de forma recursiva al escribir.

## Contrato Markdown y YAML

- `gray-matter` conecta el modelo HTTP con archivos Markdown mediante parseo y serializacion de frontmatter.
- En disco, los campos operativos usan `snake_case`, por ejemplo `agent_owner`, `execution_mode` y `blocked_by`.
- En la API, los cuerpos usan `camelCase`, por ejemplo `agentOwner`, `executionMode` y `blockedBy`.
- `server/index.js` normaliza tipos, listas, timestamps, subtareas y criterios antes de persistir.
- El cuerpo libre de cada documento se mantiene como Markdown fuera del frontmatter.
- No hay validacion mediante JSON Schema o YAML Schema; las reglas estan codificadas en funciones de saneado del servidor.
- Los documentos de referencia de esta integracion estan en `docs/PROJECT_KANBAN_SETUP.md` y `skills/local-kanban-agent/SKILL.md`.

## API HTTP local

- El frontend se integra con Express a traves de rutas relativas implementadas en `src/lib/api.js`.
- `GET /api/projects` devuelve catalogos y todos los proyectos con epicas e historias enriquecidas.
- `POST /api/projects/:projectId/stories` crea una historia y su archivo Markdown.
- `PUT /api/projects/:projectId/stories/:storyId` reemplaza los datos editables de una historia existente.
- `POST /api/projects/:projectId/stories/:storyId/status` cambia solo el estado y valida la entrada a `developing`.
- `POST /api/projects/:projectId/stories/:storyId/move` cambia estado y asociacion de epica.
- Los endpoints `/subtasks/:subtaskIndex/toggle` y `/criteria/:criteriaType/:criteriaIndex/toggle` persisten cambios atomicos de checklist.
- `POST /api/projects/:projectId/epics` y `PUT /api/projects/:projectId/epics/:epicId` crean y actualizan epicas.
- `GET /api/health` permite comprobar que el proceso esta disponible.
- No existen endpoints de borrado ni de alta de proyectos en la implementacion actual.
- No hay versionado de API, autenticacion, autorizacion por proyecto ni rate limiting.

## Sincronizacion con cambios externos

- El servidor observa `config/projects.json`, cada `docsPath` y sus subdirectorios `epics/` y `stories/` usando `node:fs.watch`.
- Los watchers se recalculan cuando cambia la configuracion o aparecen directorios relevantes.
- Los cambios Markdown disparan un refresco con debounce de 250 ms.
- `GET /api/events` mantiene conexiones Server-Sent Events con los navegadores abiertos.
- `src/App.jsx` crea un `EventSource` y vuelve a pedir `GET /api/projects` al recibir `refresh`.
- Esta via hace visible en la UI el trabajo que un agente o editor realiza directamente sobre los `.md`.
- SSE es unidireccional; todas las mutaciones del navegador siguen pasando por la API REST.
- Los watchers usan `{ persistent: false }`, por lo que no mantienen por si solos vivo el proceso Node.

## Integracion con agentes de desarrollo

- `skills/local-kanban-agent/SKILL.md` es el contrato normativo distribuido para agentes que trabajan en proyectos monitorizados.
- Cada repositorio externo debe incorporar un `AGENTS.md` que importe esa skill, segun `docs/PROJECT_KANBAN_SETUP.md`.
- Los agentes pueden operar mediante la API REST local o editar los Markdown directamente segun el flujo autorizado.
- Ownership, modo de ejecucion, contexto, dependencias, subtareas y criterios se expresan como datos del frontmatter.
- El backend deriva `isBlocked`, `isReadyForDeveloping` y progreso de criterios para que agentes y UI compartan la misma semantica.
- No existe una conexion programatica a un proveedor concreto de IA: Codex, Claude u otros agentes consumen el contrato y los archivos desde fuera del proceso.
- `skills/local-kanban-installer/SKILL.md` documenta el flujo agéntico para clonar, instalar y configurar esta aplicacion.

## Integracion de desarrollo y pruebas

- Vite sirve el frontend y proxifica `/api` hacia Express, configurado en `vite.config.js`.
- El destino normal es `http://localhost:4010`; `VITE_API_PROXY_TARGET` permite apuntar a otra instancia.
- Playwright levanta una API aislada con `KANBAN_CONFIG_PATH=.e2e/projects.json` en `playwright.config.js`.
- `e2e/helpers/fixture.js` integra las pruebas con copias reales de Markdown, no con mocks de red o memoria.
- Los tests verifican cambios externos de archivos y su reflejo en UI en `e2e/tests/agent-mirror.spec.js`.
- No se detecta integracion con CI en archivos del repositorio, aunque los scripts npm son aptos para ejecutarse en CI.

## Integracion operativa local

- PM2 administra el proceso Express mediante `ecosystem.config.cjs` y los scripts `start`, `stop`, `restart`, `status` y `logs` de `package.json`.
- `Launch_Kanban.command` usa `curl` como health probe y `open` para lanzar el navegador en macOS.
- El bundle de Vite en `dist/` se sirve desde Express, por lo que produccion local necesita un solo puerto HTTP.
- El servidor escucha en loopback por defecto (`127.0.0.1`), limitando el acceso a la maquina local salvo cambio explicito de `HOST`.
- No hay TLS local, reverse proxy, contenedor Docker ni servicio systemd configurado.

## Servicios y dependencias ausentes

- No hay base de datos SQL, NoSQL ni almacenamiento cloud.
- No hay integracion con Jira, GitHub Issues, Linear, Trello u otro gestor remoto.
- No hay OAuth, SSO, proveedor de identidad ni gestion de usuarios.
- No hay servicios de email, calendario, webhooks, telemetria o analitica.
- No hay llamadas salientes desde el backend a APIs de terceros.
- No hay secretos de proveedor ni credenciales requeridas por el codigo actual.
- El unico acceso de red funcional es local: navegador, Vite y Express en la misma maquina.

## Limites funcionales de las integraciones

- La aplicacion confia en que `rootPath` sea correcto, absoluto y accesible con permisos de lectura y escritura.
- No hay bloqueo de archivos ni control de concurrencia; UI y agentes pueden reescribir el mismo Markdown simultaneamente.
- Las actualizaciones `PUT` son reemplazos completos: un cliente que omita campos puede restaurarlos a defaults.
- Los endpoints de estado y movimiento devuelven error de servidor para algunas validaciones de dominio, aunque el fallo sea funcional y no de infraestructura.
- El esquema de frontmatter y el contrato de la skill deben mantenerse sincronizados manualmente con `server/index.js`.
- La disponibilidad de `fs.watch` y su comportamiento dependen del sistema de archivos que aloja cada repositorio externo.

