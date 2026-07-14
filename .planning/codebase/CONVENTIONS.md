# Convenciones de código

**Fecha de análisis:** 2026-07-14

## Patrones de nombres

**Archivos:**
- Usa `PascalCase.jsx` para componentes React, por ejemplo `src/components/StoryEditor.jsx` y `src/components/KanbanBoard.jsx`.
- Usa nombres funcionales en minúsculas para módulos JavaScript, como `src/lib/api.js`, `src/lib/story.js` y `src/lib/graph.js`.
- Usa `*.spec.js` para pruebas Playwright dentro de `e2e/tests/` y nombres de dominio para fixtures Markdown: `STO-001.md` y `EPI-001.md`.

**Funciones y variables:**
- Usa `camelCase` para funciones, handlers y variables: `sanitizeStoryPayload`, `handleSaveStory`, `resetFixtureWorkspace`.
- Prefija handlers de UI con `handle` y setters derivados de estado con el patrón de React `setX`, como en `src/App.jsx`.
- Usa nombres booleanos con `is`, `has`, `can` o `show`: `isBlocked`, `hasNoEpicStories`, `canMoveToDeveloping`, `showRelated`.
- Conserva `snake_case` únicamente en el frontmatter Markdown y tradúcelo explícitamente a `camelCase` en la API mediante `sanitizeStoryFrontmatter` en `server/index.js`.

**Tipos y constantes:**
- No hay TypeScript ni tipos declarados; la forma de los datos se expresa con objetos literales y funciones de coerción en `server/index.js`.
- Usa `PascalCase` para componentes exportados y `UPPER_SNAKE_CASE` para constantes realmente globales de módulo, como `DENSITY_STORAGE_KEY` en `src/App.jsx`.
- Los catálogos locales estables suelen ser `const` en `camelCase`, por ejemplo `statuses`, `storyTypes` y `derivedCriteriaRules` en `server/index.js`.

## Estilo de código

**Formato:**
- Mantén módulos ESM (`import`/`export`), comillas dobles, punto y coma y sangría de dos espacios, como en `vite.config.js` y `src/lib/api.js`.
- Añade coma final en objetos, arrays y llamadas multilínea. Divide expresiones largas con una condición o argumento por línea.
- Usa optional chaining (`?.`) y nullish coalescing (`??`) para valores opcionales; evita depender de coerciones implícitas.
- No existe configuración de Prettier o formatter en el repositorio. El formato se mantiene manualmente siguiendo el código existente.

**Linting:**
- No existe `eslint.config.*`, `.eslintrc*`, script `lint` ni dependencia ESLint en `package.json`.
- La verificación automatizada actual se limita a `npm run build` y `npm run test:e2e`; cualquier código nuevo debe respetar manualmente estas convenciones.

## Organización de imports

**Orden observado:**
1. Dependencias del runtime o paquetes externos (`react`, `express`, `gray-matter`, `@playwright/test`).
2. Módulos internos relativos (`./lib/api`, `../helpers/fixture.js`).
3. Assets o estilos con efectos laterales, como `./styles.css` al final de `src/main.jsx`.

**Rutas:**
- Usa rutas relativas; no hay aliases configurados en `vite.config.js`, `jsconfig.json` ni `tsconfig.json`.
- En Node, incluye la extensión `.js` en imports locales; en el frontend Vite se omite habitualmente para módulos y componentes.
- Para derivar rutas desde módulos ESM usa `fileURLToPath(import.meta.url)`, como en `server/index.js`, `scripts/setup.js` y `e2e/helpers/fixture.js`.

## Manejo de errores

**Backend y scripts:**
- Valida y normaliza entradas en funciones puras antes de escribir: `sanitizeStoryPayload`, `coerceCriteria` y `normalizeProject`.
- Lanza `Error` con mensajes operativos en español cuando falla una precondición y conviértelo en respuesta JSON en el borde HTTP.
- En rutas Express, responde pronto con `400`, `404` o `409` para errores esperados y envuelve I/O en `try/catch`; las respuestas incluyen `error` estable y `detail` técnico en `server/index.js`.
- Captura sin propagar solo fallos esperados y recuperables: `ENOENT` en `safeReadDir`, ausencia de rutas observables en `watchPath`, o configuración temporalmente ilegible al sincronizar watchers.
- En CLI, termina con código `1` y muestra un resumen breve mediante `console.error`, como hace `scripts/setup.js`.

**Frontend:**
- Centraliza la interpretación de respuestas HTTP en `handleJson` de `src/lib/api.js`; intenta leer JSON y usa un mensaje fallback si el cuerpo no es válido.
- Los handlers asíncronos de `src/App.jsx` limpian el error antes de operar, capturan `Error.message`, actualizan el estado visible y restauran/refrescan datos cuando falla una actualización optimista.
- Para efectos asíncronos desmontables usa una bandera `cancelled`; para `EventSource`, cierra la conexión en el cleanup de `useEffect`.

## Logging

**Framework:** consola nativa.

**Patrones:**
- Reserva `console.log` para estado de arranque/setup en `scripts/setup.js` y para la URL de escucha en `server/index.js`.
- Reserva `console.error` para fallos terminales de la CLI. El frontend comunica errores mediante estado y UI, no mediante logs de consola.
- No hay logger estructurado, niveles ni correlación de peticiones; no introduzcas logs ruidosos en helpers puros o renders.

## Comentarios y documentación inline

- Los comentarios son escasos y delimitan secciones o justifican una recuperación no obvia, como los bloques SSE y los `catch` de watchers en `server/index.js`.
- No hay JSDoc/TSDoc. Prefiere nombres explícitos y funciones pequeñas; comenta únicamente reglas de dominio o decisiones que no se deduzcan del código.
- La documentación normativa y operativa vive en `docs/` y `skills/`, especialmente `skills/local-kanban-agent/SKILL.md`; no dupliques ese contrato en comentarios dispersos.

## Diseño de funciones y módulos

- Mantén transformación y coerción en funciones puras antes de los efectos de filesystem o red, siguiendo `coerceSubtasks`, `hydrateCriteria` y `buildStoryGraph`.
- Usa guard clauses para entradas inválidas o contexto ausente y devuelve estructuras normalizadas, no formas parcialmente válidas.
- En React, pasa callbacks y datos por props; conserva el estado coordinador y las operaciones de API en `src/App.jsx`, y la representación/interacción local en `src/components/`.
- Exporta funciones nombradas en librerías y componentes; `src/App.jsx` es la excepción con `export default` por ser la raíz de la aplicación.
- No se usan barrel files (`index.js`) para reexportar. Importa cada módulo desde su archivo real.

---

*Análisis de convenciones: 2026-07-14*
