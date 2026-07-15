# Pruebas y gates de release

Esta es la referencia operativa para verificar Local Kanban. La fuente ejecutable permanece en
`package.json`, `playwright.config.js` y `.github/workflows/ci.yml`.

## Gate completo

Desde un checkout limpio, con Node.js 22.13+ o Node.js 24 LTS:

```bash
npm ci
npm run release:verify
```

`release:verify` falla al primer gate incumplido y ejecuta, en este orden:

1. checks estáticos y sintaxis;
2. todos los tests Node con cobertura mínima de 85 % en líneas, 65 % en ramas y 90 % en funciones;
3. evaluaciones deterministas de invariantes agénticas;
4. benchmark semántico reproducible de 1.000 historias;
5. `npm audit` para vulnerabilidades altas o críticas;
6. build de producción;
7. E2E Playwright sobre un workspace aislado;
8. tests de instalación y smoke de la skill en un HOME temporal.

## Matriz de cobertura funcional

| Capa | Comando | Garantías principales |
| --- | --- | --- |
| Estática | `npm run check` | Sintaxis de JS y scripts de entrada |
| Dominio | `npm run test:coverage` | schemas, DAG, gates, CAS, filesystem, recovery, claims, leases, fencing, migración de fixtures y CLI |
| Agéntica | `npm run eval` | concurrencia, checkpoint/handoff, bloqueo humano y cierre exclusivo del orquestador |
| Escala | `npm run benchmark` | ranking y resultado semántico del scheduler con 1.000 historias |
| Dependencias | `npm audit --audit-level=high` | ausencia de vulnerabilidades high/critical conocidas |
| Build | `npm run build` | bundle Vite que el servidor exige antes de arrancar |
| HTTP/UI | `npm run test:e2e` | bootstrap, tablero, grafo, SSE, degradación visible, mutaciones fail-closed, recuperación y seguridad loopback |
| Skill | `npm run test:skill` | symlink canónico, instalación idempotente, alta sin ID/nombre, épica e historia tipada, errores fail-closed y flujo consumidor aislado hasta `done` |

La suite E2E crea `.e2e/` desde `e2e/fixtures/source-project`; nunca opera sobre proyectos
reales registrados por el usuario. Los documentos de ese directorio son fixtures, no
documentación de producto ni planificación activa.

## Aislamiento obligatorio del dogfooding

El checkout proveedor de Local Kanban no puede ser simultáneamente proveedor y consumidor.
Está prohibido usar la aplicación para gestionar su propio desarrollo sobre ese checkout:
no se ejecuta `local-kanban init`, no se registra como proyecto consumidor y no se crean en
él `docs/kanban` ni `.local-kanban/runtime.sqlite` para representar este repositorio.

El dogfooding y las pruebas de integración solo pueden operar sobre copias, fixtures o
proyectos temporales descartables. Cada ejecución debe usar un `KANBAN_CONFIG_PATH` dentro
del entorno temporal y un `HOME` aislado, sin leer ni modificar la configuración, los
proyectos o el runtime reales del usuario. El entorno se elimina al terminar la prueba.

## Comandos parciales

Para iterar localmente puede ejecutarse una capa concreta:

```bash
npm run test:coverage
npm run eval
npm run benchmark
npm run test:e2e
npm run test:e2e:headed
npm run test:skill
```

`test:unit`, `test:quality` y `test:dogfood` son subconjuntos útiles durante desarrollo; no
sustituyen el gate completo. `npm run skill:verify` comprueba el symlink personal de la máquina
y se mantiene fuera del gate hermético porque depende del HOME real.

El smoke aislado parte de un `HOME`, un registro y un repositorio Git temporales. Ejecuta
`init` sin conocimiento de ID o nombre, crea una épica, comprueba que `spike` ofrece
`research` como corrección sin persistir, rechaza un flag desconocido, crea una historia
`research` válida y completa el flujo hasta `done` con `doctor=healthy` y colas vacías.

## CI y criterio de release

GitHub Actions ejecuta la verificación principal en macOS con Node.js 22 y 24 y el smoke de la
skill en un job aislado. El job de secretos descarga Gitleaks 8.30.1, verifica su SHA-256 antes
de ejecutarlo y escanea el historial completo. Las acciones externas restantes están fijadas
por SHA. Un release solo está listo cuando:

- `npm run release:verify` termina con código 0;
- el worktree contiene únicamente los cambios previstos;
- los jobs remotos `verify`, `skill` y `secrets` quedan verdes;
- `local-kanban doctor` devuelve `health: healthy` en cada proyecto consumidor que se quiera usar.

Si un gate no puede ejecutarse, el release no se considera verificado: documenta el bloqueo y
no sustituyas el resultado por una comprobación manual parcial.
