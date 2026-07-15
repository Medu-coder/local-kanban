---
name: local-kanban
description: Esta skill debe usarse cuando el usuario pida "dar de alta este proyecto en Local Kanban", "inicializar Local Kanban", "crear épicas o tarjetas", "gestionar el backlog", planificar, priorizar, delegar, ejecutar o verificar trabajo mediante Local Kanban, o cuando un agente reciba ownership de una historia STO-*.
---

# Local Kanban

Coordinar trabajo de desarrollo agéntico manteniendo el Kanban como contrato operativo. Optimizar simultáneamente flujo global, seguridad de concurrencia y consumo de contexto.

## Arranque autónomo sin contexto previo

Tratar esta skill como la única fuente de contexto necesaria para adoptar y operar Local Kanban. No exigir al usuario que conozca IDs, enums, rutas internas, schemas ni el checkout proveedor.

Para dar de alta un repositorio consumidor nuevo:

1. Situarse en cualquier directorio dentro de su árbol Git y ejecutar `local-kanban --help`.
2. Ejecutar `local-kanban init --json` sin inventar `--id` ni `--name` salvo que el usuario los haya pedido. La CLI deriva ambos de la raíz Git y el comando es idempotente.
3. Seguir `guidance.command` de la respuesta y ejecutar `local-kanban doctor --json`.
4. Inspeccionar los comandos de validación y archivos de contexto reales del proyecto antes de crear trabajo.
5. Crear épicas e historias exclusivamente con `create-epic` y `create-story`; no escribir frontmatter manualmente.
6. Versionar los contratos Markdown creados antes de preparar un worktree basado en ellos.
7. Ejecutar `local-kanban next --json` y seguir el `guidance.command` devuelto por la CLI.

Flujo mínimo para un proyecto vacío, sustituyendo únicamente el contenido específico entre comillas:

```bash
local-kanban init --json
local-kanban doctor --json
local-kanban create-epic EPI-001 --title "Entrega inicial" --objective "Entregar un resultado observable" --json
local-kanban create-story STO-001 --title "Implementar entrega" \
  --objective "Crear y verificar el resultado" \
  --acceptance "Resultado observable" \
  --validation-command "COMANDO_REAL_DEL_PROYECTO" \
  --context "ARCHIVO_REAL_DEL_PROYECTO" \
  --subtasks "Implementar" --epic EPI-001 --json
local-kanban validate --json
local-kanban next --json
```

Usar los defaults de planificación cuando el usuario no haya pedido otra semántica: `priority=medium`, `risk=standard`, `execution-mode=agent` y `story-type=feature`. Valores admitidos:

- `priority`: `low`, `medium`, `high`;
- `risk`: `standard`, `high`;
- `execution-mode`: `human`, `agent`, `hybrid`;
- `story-type`: `feature`, `bug`, `tech_debt`, `research`, `chore`.

Representar un spike exploratorio como `--story-type research`; `spike` no es un valor válido. Ante `option_invalid` u `option_unknown`, corregir el comando usando `details.allowed` o la ayuda y repetirlo. Confirmar que un fallo de creación no dejó documento parcial con `local-kanban validate --json`.

## Reglas innegociables

1. Tratar al agente principal como **orquestador** y a cada subagente asignado como **especialista**.
2. Mutar el Kanban únicamente mediante la CLI de Local Kanban gobernada por esta skill. No editar `docs/kanban` ni SQLite directamente durante el flujo normal.
3. Leer solo la historia activa, sus dependencias relevantes y el contexto imprescindible. No cargar el tablero o el historial completo salvo necesidad explícita.
4. No iniciar una historia sin readiness, scope, validación y dependencias satisfechas.
5. No ampliar scope silenciosamente. Registrar trabajo descubierto como nueva historia o escalar una decisión material.
6. No cerrar sin criterios, subtareas, validación y evidencia vigentes.
7. Mantener trazabilidad suficiente para reanudar sin consultar el chat anterior.
8. Reservar la edición manual de Markdown para recuperación o mantenimiento excepcional; reconciliarla antes de continuar.
9. No tolerar degradaciones silenciosas: todo warning o fallo debe conservar causa, impacto, acción, comando y verificación. Un `fail` bloquea ejecución; un warning declara qué garantía se reduce.
10. El checkout proveedor de Local Kanban no puede ser simultáneamente proveedor y consumidor: no usar Local Kanban para gestionar su propio desarrollo, no ejecutar `local-kanban init` sobre ese checkout, no registrarlo como proyecto consumidor y no crear en él `docs/kanban` ni `.local-kanban/runtime.sqlite` para ese fin. El dogfooding solo puede ejecutarse sobre copias, fixtures o proyectos temporales descartables, con `KANBAN_CONFIG_PATH` y `HOME` aislados del usuario y del checkout proveedor.

Antes de operar, ejecutar `local-kanban --help` y usar únicamente los subcomandos y opciones que anuncie la versión instalada. Si la CLI no está disponible, resolver el destino de `~/.agents/skills/local-kanban`, subir dos niveles desde `<checkout>/skills/local-kanban` hasta la raíz del checkout, comprobar allí `package.json` y ejecutar `npm link`. Repetir después el preflight. Si la skill no es un enlace canónico, no se encuentra el checkout o la reparación falla, detener la mutación y reportar el problema. No sustituirla por edición directa de Markdown, SQLite o llamadas HTTP improvisadas.

## Activación

1. Trabajar desde la raíz del repositorio consumidor.
2. Leer su `AGENTS.md` y obedecer cualquier regla más específica que no contradiga esta metodología.
3. Detectar el rol actual:
   - **Orquestador:** no se ha recibido ownership exclusivo de una historia concreta.
   - **Especialista:** se ha recibido una historia, alcance y ownership concretos.
4. Como orquestador, si el repositorio todavía no está registrado, ejecutar `local-kanban init --json`; el comando deriva ID y nombre de la raíz Git, instala el contrato local de la metodología y es idempotente. Un especialista no reinicializa el proyecto: escala la ausencia del contrato.
5. Validar o diagnosticar el proyecto solo con los comandos que exponga `local-kanban --help`.
6. Consultar mediante la CLI solo el estado necesario para el rol.
7. Mantener una cápsula operativa compacta con:
   - historia, estado, owner e intento;
   - objetivo y scope;
   - gates, bloqueos y restricciones relevantes;
   - validación exigida;
   - siguiente acción.

Regenerar la cápsula completa tras resume, compactación o handoff. Tras una operación normal, devolver principalmente el delta, el gate vigente y la siguiente acción. Ampliar contexto cuando sea necesario; no aplicar un límite de tokens que elimine información crítica.

## Interfaz agent-first

Usar este flujo mínimo. Proporcionar IDs legibles `EPI-*` y `STO-*`; la CLI genera timestamps, revisiones, claves de idempotencia, IDs de intentos y fencing tokens:

```text
local-kanban create-epic EPI-... --title "..." --objective "..." --json
local-kanban create-story STO-... --title "..." --objective "..." \
  --acceptance "..." --validation-command "..." --context "..." --json
local-kanban next --json
local-kanban show STO-... --json
local-kanban claim STO-... --agent AGENT_ID --json
local-kanban worktree STO-... --attempt-id ID --fencing-token N --json
local-kanban checkpoint STO-... --attempt-id ID --fencing-token N --summary "..." --json
local-kanban block STO-... --attempt-id ID --fencing-token N --type TYPE \
  --description "..." --owner "..." --action "..." --resume-condition "..." --json
local-kanban resolve STO-... --attempt-id ID --fencing-token N --block-id ID \
  --resolution "Qué cambió" --json
local-kanban check STO-... --attempt-id ID --fencing-token N --subtask ID --json
local-kanban check STO-... --attempt-id ID --fencing-token N --criterion ID --json
local-kanban validate STO-... --attempt-id ID --fencing-token N --json
local-kanban complete STO-... --attempt-id ID --fencing-token N --role orchestrator --json
local-kanban worktree-remove STO-... --attempt-id ID --delete-branch --json
local-kanban release STO-... --attempt-id ID --fencing-token N --outcome released \
  --summary "Estado" --next-action "Cómo reanudar" --json
local-kanban reconcile --json
```

`--validation COMMAND[,COMMAND]` conserva el formato CSV histórico. Cuando un comando
contenga comas, usar `--validation-command COMMAND`; el flag es repetible y cada valor se
conserva literalmente. Si se combinan ambos formatos, primero se ejecutan los comandos CSV
y después los literales en el orden en que aparecieron.

Crear trabajo nuevo mediante `create-epic` y `create-story`; no generar sus Markdown manualmente. Conservar el `attemptId` y `fencingToken` devueltos por `claim`; toda mutación posterior de ejecución los exige y renueva el lease. No inventarlos ni reutilizarlos en otra historia. Usar `show` para regenerar la cápsula tras resume. Marcar únicamente trabajo realmente terminado con `check`; repetirlo es seguro y no desmarca. Resolver un bloqueo con `resolve` explicando la resolución. `release` exige checkpoint vigente o handoff con resumen y siguiente acción. `validate` sin `STORY_ID` valida globalmente los documentos del proyecto; con `STORY_ID` ejecuta los comandos declarados por la historia, registra evidencia durable vinculada al commit y al intento, y entrega en `testing/verifying`; un fallo también queda auditado con la siguiente acción. Solo el orquestador usa `complete`, después de integrar: el comando vuelve a validar sobre el checkout principal, registra evidencia del commit integrado y después cierra. Retirar el worktree limpio con `worktree-remove` tras el cierre.

## Flujo del orquestador

1. Ejecutar `doctor --json` y `reconcile --json` antes de asignar trabajo. `next` y `claim` fallan cerrados si el runtime conserva una degradación bloqueante.
2. Resolver resultados, leases expirados, bloqueos y conflictos pendientes.
3. Consultar `local-kanban next --json`. La respuesta separa `stories`, `verification`, `attention`, `active` y `deferred`; cada cola declara total, elementos devueltos y si hay más. Seguir `guidance.command` y no interpretar una cola vacía como ausencia de trabajo sin revisar el resumen. Las colas se ordenan de forma determinista:
   - `rank` ascendente;
   - prioridad `high`, `medium`, `low`;
   - mayor número de historias desbloqueadas;
   - ID como desempate estable.
4. Autoasignar con `claim` y lanzar trabajo mientras exista capacidad WIP y no haya gate humano real.
5. Crear branch y worktree por especialista cuando haya dos o más escritores concurrentes. Permitir el workspace actual con un único escritor.
6. Serializar historias con superficies de cambio incompatibles.
7. Integrar, revisar y validar resultados; reevaluar inmediatamente el trabajo desbloqueado.
8. Continuar hasta agotar el trabajo elegible. Pausar solo por credenciales, aprobación, decisión material, cambio de alcance o conflicto no resoluble.

No absorber trabajo delegable por conveniencia. Registrar la causa de overrides, repriorizaciones y decisiones excepcionales.

## Flujo del especialista

1. Confirmar historia, ownership, claim/lease, scope y Definition of Ready.
2. Leer la cápsula y únicamente los archivos necesarios para comenzar.
3. Ejecutar la historia end to end dentro del scope concedido.
4. Registrar `checkpoint` solo en hitos significativos, pausas largas, handoffs o bloqueos. Incluir progreso, cambios relevantes, validación realizada, trabajo restante y siguiente acción.
5. Renovar el lease implícitamente mediante actividad normal de la interfaz. No generar heartbeats conversacionales.
6. Ante un bloqueo real, usar `block` con tipo, evidencia, responsable, acción solicitada y condición de reanudación; tras atenderlo usar `resolve`.
7. Marcar subtareas y criterios satisfechos con `check`, y después usar `validate STORY_ID`; no registrar manualmente evidencia ni omitir los comandos definidos.
8. Para riesgo `standard`, entregar en `verifying` al superar los gates. Para riesgo `high`, liberar el intento tras validar; el orquestador reclama la historia en `testing` con otro agente, que ejecuta `validate --evidence-type review`, libera su intento y deja la entrega disponible para el claim final del orquestador.
9. Entregar un handoff compacto que permita al orquestador localizar cambios, pruebas, decisiones y trabajo residual. No marcar `done`.

No continuar mutando después de perder el lease. No declarar éxito basándose solo en inspección cuando exista una validación ejecutable.

## Estados mínimos

Conservar las columnas funcionales:

```text
backlog -> developing -> testing -> done
```

Usar solo estos estados operativos:

```text
unclaimed -> running -> waiting -> verifying
```

Representar readiness y bloqueo como condiciones derivadas; claim mediante lease; fallo o abandono como resultado del intento; aprobación humana mediante gate. No inventar estados adicionales.

## Atención y escalado

Mantener visibles solo las reglas aplicables al paso actual. Escalar al humano cuando se requiera nueva autoridad, credenciales, una decisión irreversible o un cambio material de alcance. Resolver de forma autónoma ambigüedades menores y problemas técnicos dentro del scope.

Al finalizar una intervención, dejar el Kanban en un estado coherente: trabajo cerrado con evidencia, activo con checkpoint vigente o bloqueado con siguiente acción concreta.
