# Registro de dogfooding y desalineamientos — 2026-07-14

## Resultado

Local Kanban se probó como metodología real sobre un repositorio Git consumidor aislado,
sin editar manualmente sus Markdown ni SQLite. El flujo terminó con dos historias `done`,
dependencias resueltas, código integrado y validado, runtime `healthy`, checkout limpio y
ningún claim, bloqueo, intento o cuarentena abierto.

Repositorio de prueba durante la ejecución:
`/private/tmp/local-kanban-dogfood-real.jDe3Nm`.

## Cobertura ejecutada

1. Instalación local y resolución de la skill canónica.
2. `init` idempotente, contrato `AGENTS.md`, `.gitignore`, registro y SQLite local.
3. Creación exclusiva por CLI de una épica y dos historias con dependencia hard.
4. Validación de schema y DAG.
5. Scheduler: `STO-002` quedó inelegible hasta cerrar `STO-001`.
6. Claim, intento, lease, fencing y transición automática a `developing`.
7. Creación de branch/worktree y ejecución real dentro del checkout especialista.
8. Implementación, tests y commit del especialista.
9. Checkpoint, bloqueo estructurado, cápsula de reanudación y resolución del bloqueo.
10. Marcado monotónico de subtareas y criterios.
11. Validación en el worktree y evidencia ligada al commit especialista.
12. Integración en `main`, validación integrada y evidencia ligada al `HEAD` integrado.
13. Cierre exclusivo por orquestador, liberación del claim y desbloqueo inmediato del DAG.
14. Segundo flujo con escritor único en el workspace principal.
15. Limpieza idempotente del worktree y branch terminados.
16. UI real sobre el proyecto consumidor: deep link, estado, timeline y datos operativos.
17. Actualización live CLI → watcher/SSE → React, sin recargar la página.
18. `doctor` final y repositorio consumidor limpio.

Resultado final de `doctor`:

- `health: healthy`.
- 2 historias y 1 épica válidas.
- 19 operaciones canónicas completadas.
- 31 eventos de auditoría.
- 3 claims liberados y 0 activos.
- 0 intentos abiertos.
- 0 bloqueos abiertos.
- 0 cuarentenas.
- 1 único worktree Git tras la limpieza, el principal.
- `next.count: 0` tras completar todo el trabajo.

## Desalineamientos encontrados

| ID | Severidad | Comportamiento observado | Expectativa normativa | Resolución | Estado |
|---|---|---|---|---|---|
| DOG-001 | Crítica | La skill prohibía editar Markdown, pero la CLI no podía crear épicas/historias ni marcar criterios, resolver bloqueos o liberar intentos. | Todo el flujo normal debe poder ejecutarse exclusivamente mediante la skill y la CLI. | Se añadieron `create-epic`, `create-story`, `show`, `check`, `resolve`, `release` y `worktree`. Commit `e5679a0`. | Resuelto y probado |
| DOG-002 | Crítica | Desde un worktree, el repo no coincidía con el `rootPath` registrado; además `validate` habría ejecutado comandos en el checkout principal. | El estado durable permanece en el proyecto principal, pero la implementación, Git y validación deben operar en el checkout especialista. | Resolución mediante `git --git-common-dir`; comandos y commit se ejecutan en el worktree verificado. Commit `b88a521`. | Resuelto y probado |
| DOG-003 | Alta | Un bloqueo SQLite aparecía en `blocks`, pero no en `gates.activeBlockers`; `isReady` podía seguir siendo `true`. | La cápsula debe presentar un único gate coherente y no inducir al agente a continuar bloqueado. | La cápsula fusiona bloqueos durables y operativos y fuerza `isReady/isDone=false`. Commit `6a0ea9e`. | Resuelto y probado |
| DOG-004 | Crítica | `check` utilizaba toggle; repetir el comando podía desmarcar una subtarea o criterio ya satisfecho. | Las intenciones agent-first y sus retries deben ser monotónicos e idempotentes. | `check` devuelve `changed:false` cuando el objetivo ya está marcado. Commit `6a0ea9e`. | Resuelto y probado |
| DOG-005 | Crítica | `complete` aceptaba la evidencia del commit especialista sin volver a validar el resultado integrado. Un cherry-pick produce otro hash. | Solo se puede cerrar tras validar el resultado integrado y registrar evidencia vigente de ese commit. | `complete` ejecuta de nuevo todos los comandos en el checkout principal, registra evidencia de su `HEAD` y después transiciona a `done`. Commit `6a0ea9e`. | Resuelto y probado |
| DOG-006 | Media | Tras cerrar una historia, el worktree y branch especialista permanecían registrados. | El flujo terminado no debe acumular checkouts abandonados. | `worktree-remove` comprueba limpieza, elimina el worktree de forma idempotente y puede eliminar la branch. Commit `27bd90b`. | Resuelto y probado |
| DOG-007 | Baja | La UI mostraba `Ready` en historias `done`, junto a `Done validado`. | `Ready` debe señalar trabajo de backlog elegible, no una propiedad histórica de una historia cerrada. | El indicador se limita a historias en `backlog`. | Resuelto y probado en build/E2E |

## Comportamientos revisados y aceptados

- `doctor` informa un worktree sucio pero no degrada por ello automáticamente: durante una
  ejecución normal puede haber cambios legítimos sin commit. El dato queda visible y el gate
  de cierre/validación aporta la protección efectiva.
- Una historia cerrada conserva su último checkpoint y timeline: es continuidad/auditoría,
  no estado activo.
- Markdown recibe varias revisiones durante `check`, evidencia y transición. Es deliberado:
  cada CAS mantiene trazabilidad y evita agrupar mutaciones independientes.
- La actualización UI live se verificó reclamando `STO-002`: pasó de backlog a developing y
  mostró `running` sin `page.reload()`.

## Conclusión

No quedan desalineamientos críticos o altos abiertos de los observados en la prueba. Los
hallazgos quedaron convertidos en regresiones automatizadas dentro de las suites del repo.
