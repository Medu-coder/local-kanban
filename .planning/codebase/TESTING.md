# Patrones de testing

**Fecha de análisis:** 2026-07-14

## Framework de pruebas

**Runner y assertions:**
- Playwright Test `^1.59.1`, declarado en `package.json` y configurado en `playwright.config.js`.
- Las assertions usan `expect` de `@playwright/test`, tanto con locators web-first como con valores Node directos.
- No hay Jest, Vitest, React Testing Library ni runner unitario configurado.

**Comandos:**
```bash
npm run test:e2e          # Ejecuta toda la suite Playwright en modo headless
npm run test:e2e:headed   # Ejecuta toda la suite mostrando el navegador
npx playwright test e2e/tests/kanban.spec.js  # Ejecuta un fichero concreto
npm run build             # Gate de compilación Vite complementario
```

- No existe script de watch ni de coverage. `playwright.config.js` no define umbrales de cobertura.

## Configuración y aislamiento

- `playwright.config.js` fija `testDir: "./e2e/tests"`, `fullyParallel: false`, `workers: 1` y `retries: 0`.
- La suite levanta API y Vite mediante `webServer`: API en `127.0.0.1:4011` y UI en `127.0.0.1:4173`.
- La API recibe `KANBAN_CONFIG_PATH=.e2e/projects.json`, evitando tocar `config/projects.json` real.
- `reuseExistingServer: true` acelera ejecuciones locales; antes de atribuir un fallo al código, comprueba que no haya servidores viejos ocupando esos puertos.
- En fallo se guarda screenshot; el trace está configurado como `on-first-retry`, pero con `retries: 0` no se genera trace en la ejecución normal.

## Organización de archivos

```text
e2e/
├── fixtures/source-project/docs/kanban/
│   ├── epics/EPI-*.md
│   └── stories/STO-*.md
├── helpers/fixture.js
├── helpers/prepare-fixture-cli.js
└── tests/
    ├── agent-mirror.spec.js
    ├── install-bootstrap.spec.js
    └── kanban.spec.js
```

- Las pruebas están separadas del código productivo y se nombran `*.spec.js`.
- Hay 29 casos: 22 de flujo Kanban/UI, 5 de sincronización Markdown-agente y 2 de bootstrap de instalación.
- Agrupa nuevos casos por frontera funcional: UI general en `kanban.spec.js`, cambios externos de Markdown en `agent-mirror.spec.js` y CLI/setup en `install-bootstrap.spec.js`.

## Estructura de una prueba

**Flujo UI habitual:**
```javascript
test.beforeEach(async ({ page }) => {
  await resetFixtureWorkspace();
  await page.goto("/");
  await expect(page.getByTestId("current-project-name")).toHaveText("Proyecto de ejemplo");
});

test("crea una historia desde toolbar y la muestra en el tablero", async ({ page }) => {
  await page.getByTestId("create-story-button").click();
  await page.getByTestId("story-title-input").fill("Nueva historia E2E");
  await page.getByTestId("save-story-button").click();
  await expect(page.getByTestId("story-card-STO-nueva-historia-e2e")).toBeVisible();
});
```

- Empieza cada caso con un fixture conocido; no hagas depender un test del resultado del anterior.
- Usa nombres de test en español que expresen comportamiento observable, no detalles de implementación.
- Prefiere locators `getByTestId` para controles/entidades y `getByText` solo cuando el texto forma parte del contrato visible.
- Usa assertions web-first con `await expect(locator)` para que Playwright espere la convergencia de UI.
- Verifica persistencia crítica leyendo el `.md` resultante, no solo observando el DOM.

## Fixtures y datos de prueba

- La fuente canónica del fixture está en `e2e/fixtures/source-project/`; nunca se modifica durante un caso.
- `resetFixtureWorkspace` de `e2e/helpers/fixture.js` borra `.e2e/workspace/sample-project`, copia la fuente y regenera `.e2e/projects.json`.
- `e2e/helpers/prepare-fixture-cli.js` ejecuta el mismo reset antes de arrancar el web server de pruebas.
- `getStoryPath` y `getEpicPath` construyen rutas del workspace desechable; úsalos en vez de concatenar rutas en cada spec.
- `updateMarkdownFrontmatter` usa `gray-matter` y `structuredClone` para mutar solo el frontmatter relevante conservando el cuerpo.
- Los fixtures Markdown cubren estados, prioridades, ownership, dependencias, subtareas y criterios manuales/derivados en `e2e/fixtures/source-project/docs/kanban/stories/`.

## Mocking

**Framework:** no se usa librería de mocks.

- Las pruebas UI usan servidores reales, filesystem real dentro de `.e2e/` y la API Express real; no interceptan `fetch` ni mockean endpoints.
- Los cambios de un agente se simulan escribiendo Markdown real con `fs`/`gray-matter` en `agent-mirror.spec.js`.
- El setup se prueba como proceso Node real mediante `execFile` o `spawn` en un directorio temporal del sistema.
- No mockees la persistencia Markdown, las transiciones de estado ni el proxy Vite en pruebas de integración: son fronteras funcionales esenciales del producto.
- Para lógica pura nueva y compleja, añade pruebas unitarias solo si se incorpora explícitamente un runner; actualmente `src/lib/graph.js`, `src/lib/story.js` y las coerciones de `server/index.js` no tienen cobertura aislada.

## Patrones asíncronos y de interacción

**Drag and drop:**
```javascript
const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
await source.dispatchEvent("dragstart", { dataTransfer });
await target.dispatchEvent("dragover", { dataTransfer });
await target.dispatchEvent("drop", { dataTransfer });
await source.dispatchEvent("dragend", { dataTransfer });
```

- Reutiliza `dragStory` de `e2e/tests/kanban.spec.js` para transiciones entre estado/épica.
- Para valores que convergen por scroll, render o actualización asíncrona, usa `expect.poll` en vez de sleeps fijos.
- Para procesos hijos, escucha `exit` y `error`, rechaza códigos no cero y limpia siempre el temporal en `finally`.
- No hay timeouts ad hoc ni `waitForTimeout`; conserva ese patrón para evitar flakiness.

## Pruebas de error y regresión

- Comprueba resultados negativos con assertions explícitas, por ejemplo que una historia bloqueada permanezca en backlog y no aparezca en developing.
- Cubre compatibilidad de datos legacy y referencias huérfanas modificando el frontmatter desde `agent-mirror.spec.js`.
- Para errores de API visibles, el patrón actual valida el estado final de la UI; no hay tests HTTP directos de códigos `400/404/409/500`.
- Cuando corrijas una regresión, añade un caso que reproduzca el flujo completo y, si la persistencia es relevante, verifica también el Markdown escrito.

## Cobertura actual y gate recomendado

- No hay medición ni porcentaje mínimo de cobertura.
- La cobertura funcional fuerte está en creación/edición/movimiento de historias, checklists, subtareas, filtros, lanes, vista grafo, sincronización desde Markdown y bootstrap.
- Los huecos principales son pruebas unitarias de transformaciones puras, tests directos de API, fallos de filesystem/config, reconexión SSE y validación exhaustiva de payloads.
- Antes de entregar cambios ejecuta al menos `npm run build` y `npm run test:e2e`; para cambios acotados puede ejecutarse primero el spec relevante, pero la suite completa es el gate final disponible.

---

*Análisis de testing: 2026-07-14*
