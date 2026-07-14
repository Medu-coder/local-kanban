# Segunda auditoría exhaustiva y registro de desalineamientos — 2026-07-14

## Resultado

Se ejecutó una segunda prueba integral sobre repositorios consumidores temporales reales,
usando la skill y la CLI para el flujo normal y edición manual únicamente para provocar y
recuperar cuarentenas. Todos los fallos observados quedaron corregidos y convertidos en
regresiones automatizadas.

El gate final `npm run release:verify` terminó correctamente:

- 82 tests unitarios/integración, 82 superados.
- 7 tests de calidad, 7 superados.
- 6 evals agénticas críticas, 6 superadas.
- 34 E2E HTTP/UI, 34 superados.
- Build de producción correcto.
- Benchmark determinista: 1.000 historias, 100 iteraciones, 20 selecciones por iteración.
- Skill local verificada como symlink a la fuente canónica del repo.

## Matriz funcional ejecutada

| Área | Casos positivos, negativos y recuperación |
|---|---|
| Bootstrap | `init` real, idempotencia, registro, contrato `AGENTS.md`, Git y SQLite local |
| Entidades | creación/retry, CAS, conflicto de idempotencia, épica huérfana, dependencia huérfana, self-cycle, ciclo DAG y aislamiento de documentos inválidos |
| Scheduler | rank, prioridad, desbloqueos, WIP, dependencias, colas de implementación, verificación y atención |
| Ownership | claim, dos procesos concurrentes, lease, renovación, stale, fencing incorrecto, release, handoff y reclaim |
| Ejecución | checkpoint, bloqueos tipados, resolución, resume, marcado monotónico y worktree por intento |
| Validación | fallo real recuperable, evidencia por intento/commit, validación en worktree e integrada en principal |
| Riesgo | standard y high; implementador, reviewer independiente y cierre final del orquestador |
| Cierre | rol inválido, cierre prematuro sin mutación, DoD incompleta, review ausente y cierre correcto |
| Git | creación idempotente de worktree, rechazo de worktree sucio, commit, integración y limpieza de branch |
| Recovery | journal pending, rename interrumpido, target corrupto, divergencia, cuarentena, reparación exacta e incremental |
| Diagnóstico | schemas, DAG, rutas, SQLite, recovery, Git, skill, métricas y `doctor` sin UI |
| HTTP/UI | CAS/idempotencia, deep links, drag gates, timeline, resolve/release, SSE CLI→web, cuarentena visible y reparación |
| Seguridad | IDs/rutas, escapes, symlinks, tamaño máximo, runtime SQLite regular y escritura atómica |
| Escala | scheduler determinista sobre 1.000 historias |

La carrera de claim por procesos se repitió diez veces adicionalmente para comprobar que
la contención SQLite no reaparecía.

## Desalineamientos encontrados y corregidos

| ID | Severidad | Comportamiento observado | Corrección | Estado |
|---|---|---|---|---|
| DOG2-001 | Crítica | Una historia `high` quedaba en `testing` sin forma de ser reclamada para review independiente. | `claim` admite verificación, `next.verification` la expone y la skill define implementador → reviewer → orquestador. | Resuelto y probado |
| DOG2-002 | Crítica | CRUD podía persistir épicas/dependencias huérfanas o ciclos y detectarlos solo después. | Validación previa de relaciones y ciclos introducidos por la candidata. | Resuelto y probado |
| DOG2-003 | Alta | `doctor` no reconciliaba documentos; la cuarentena dependía de que el watcher web hubiese arrancado. | Recovery → reconciliación → validación dentro de `doctor`. | Resuelto y probado |
| DOG2-004 | Crítica | `complete` podía ejecutarse desde `developing`, añadir evidencia y fallar después por DoD incompleta. | Preflight sin mutación: exige `testing`, gates completos, evidencia y review cuando aplica. | Resuelto y probado |
| DOG2-005 | Alta | Trabajo `developing` liberado/bloqueado desaparecía de `next`; la cápsula omitía el `block.id` necesario para resolver. | Nueva cola `attention` y bloques accionables completos en la cápsula. | Resuelto y probado |
| DOG2-006 | Alta | `show` marcaba dependencias como pendientes sin consultar su estado canónico. | Evaluación contra todas las historias válidas del proyecto. | Resuelto y probado |
| DOG2-007 | Crítica | En claims concurrentes reales, el perdedor podía recibir `database is locked`. | `busy_timeout` se aplica antes de inicializar WAL/schema; queda un ganador y un conflicto de dominio estable. | Resuelto y probado |
| DOG2-008 | Media | Tras resolver o liberar desde UI, el estado cambiaba pero el timeline abierto quedaba obsoleto. | Refresco explícito del timeline después de mutaciones operativas. | Resuelto y probado live |
| DOG2-009 | Alta | Una historia podía mostrar simultáneamente `Cuarentena` y `Ready`. | Cuarentena fuerza readiness y validación de cierre a `false`. | Resuelto y probado E2E/live |
| DOG2-010 | Alta | Restaurar exactamente un documento válido no limpiaba su cuarentena. | Reconciliación `unchanged` limpia la cuarentena y audita `document_quarantine_resolved`. | Resuelto y probado |
| DOG2-011 | Media | Eventos con el mismo timestamp se ordenaban por UUID y podían invertir causalidad. | Desempate por orden de inserción SQLite (`rowid`). | Resuelto y probado |
| DOG2-012 | Crítica | Un documento inválido/cuarentenado bloqueaba crear o actualizar entidades sanas no relacionadas. | Validación incremental: solo se rechazan referencias/ciclos introducidos por la candidata. | Resuelto y probado |
| DOG2-013 | Crítica | El drag legacy evaluaba un candidato ya marcado `developing` y podía saltarse readiness. | El gate evalúa el estado canónico actual; solo omite readiness si ya estaba realmente en `developing`. | Resuelto y probado E2E |
| DOG2-014 | Media | Una validación fallida no dejaba garantizada la renovación inicial del lease. | `validate` renueva el claim antes de ejecutar comandos, también si luego fallan. | Resuelto y probado |

## Prueba live final

Sobre un consumidor Git aislado se verificó con navegador real:

1. Historias backlog y developing con un bloqueo humano activo.
2. Deep link con `story` y `attempt`.
3. Resolución del bloqueo y cambio inmediato `waiting → running`.
4. Liberación del claim y cambio `running → unclaimed`.
5. Timeline actualizado sin reabrir, incluidos `block_resolved` y `claim_released`.
6. Creación por CLI visible por SSE sin recargar.
7. Corrupción manual controlada, cuarentena visible y ausencia de señal `Ready`.
8. Reparación excepcional con revisión incremental y limpieza de cuarentena.
9. `doctor`: `healthy`, schemas/DAG válidos, SQLite íntegra, 0 claims abiertos,
   0 intentos abiertos, 0 bloqueos y 0 cuarentenas.

El consumidor, navegador, servidor y artefactos temporales se eliminaron al terminar.

## Riesgo residual conocido

No quedan comportamientos inesperados abiertos de los observados. La cobertura es exhaustiva
sobre el espacio funcional definido y sus invariantes, no sobre todas las combinaciones
teóricas de entradas. El gate se ejecutó en macOS; un corte físico de alimentación se modeló
mediante inyección de fallos antes/después de rename, y la expiración de 30 minutos mediante
reloj determinista, sin esperar tiempo real.

## Comando reproducible

```bash
npm run test:dogfood
npm run release:verify
```

