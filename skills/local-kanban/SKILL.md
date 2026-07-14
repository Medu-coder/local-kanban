---
name: local-kanban
description: Metodología Codex-first para planificar, priorizar, delegar, ejecutar y verificar trabajo de desarrollo largo mediante Local Kanban. Usar cuando un repositorio gestione épicas e historias en docs/kanban, cuando el agente principal deba orquestar subagentes, o cuando un especialista reciba una historia de Local Kanban.
---

# Local Kanban

Coordinar trabajo de desarrollo agéntico manteniendo el Kanban como contrato operativo. Optimizar simultáneamente flujo global, seguridad de concurrencia y consumo de contexto.

## Reglas innegociables

1. Tratar al agente principal como **orquestador** y a cada subagente asignado como **especialista**.
2. Mutar el Kanban únicamente mediante la CLI de Local Kanban gobernada por esta skill. No editar `docs/kanban` ni SQLite directamente durante el flujo normal.
3. Leer solo la historia activa, sus dependencias relevantes y el contexto imprescindible. No cargar el tablero o el historial completo salvo necesidad explícita.
4. No iniciar una historia sin readiness, scope, validación y dependencias satisfechas.
5. No ampliar scope silenciosamente. Registrar trabajo descubierto como nueva historia o escalar una decisión material.
6. No cerrar sin criterios, subtareas, validación y evidencia vigentes.
7. Mantener trazabilidad suficiente para reanudar sin consultar el chat anterior.
8. Reservar la edición manual de Markdown para recuperación o mantenimiento excepcional; reconciliarla antes de continuar.

Antes de operar, ejecutar `local-kanban --help` y usar únicamente los subcomandos que anuncie la versión instalada. Si la CLI no está disponible, detener la mutación y reportar el problema. No sustituirla por edición directa de Markdown, SQLite o llamadas HTTP improvisadas.

## Activación

1. Trabajar desde la raíz del repositorio consumidor.
2. Leer su `AGENTS.md` y obedecer cualquier regla más específica que no contradiga esta metodología.
3. Detectar el rol actual:
   - **Orquestador:** no se ha recibido ownership exclusivo de una historia concreta.
   - **Especialista:** se ha recibido una historia, alcance y ownership concretos.
4. Inicializar, validar o diagnosticar el proyecto solo con los comandos que exponga `local-kanban --help`.
5. Consultar mediante la CLI solo el estado necesario para el rol.
6. Mantener una cápsula operativa compacta con:
   - historia, estado, owner e intento;
   - objetivo y scope;
   - gates, bloqueos y restricciones relevantes;
   - validación exigida;
   - siguiente acción.

Regenerar la cápsula completa tras resume, compactación o handoff. Tras una operación normal, devolver principalmente el delta, el gate vigente y la siguiente acción. Ampliar contexto cuando sea necesario; no aplicar un límite de tokens que elimine información crítica.

## Interfaz agent-first

Usar este flujo mínimo; la CLI genera internamente IDs, timestamps y claves de idempotencia:

```text
local-kanban create-epic EPI-... --title "..." --objective "..." --json
local-kanban create-story STO-... --title "..." --objective "..." \
  --acceptance "..." --validation "..." --context "..." --json
local-kanban next --json
local-kanban show STO-... --json
local-kanban claim STO-... --agent AGENT_ID --json
local-kanban worktree STO-... --attempt-id ID --fencing-token N --json
local-kanban checkpoint STO-... --attempt-id ID --fencing-token N --summary "..." --json
local-kanban block STO-... --attempt-id ID --fencing-token N --type TYPE \
  --description "..." --owner "..." --action "..." --resume-condition "..." --json
local-kanban resolve STO-... --attempt-id ID --fencing-token N --block-id ID --json
local-kanban check STO-... --attempt-id ID --fencing-token N --subtask ID --json
local-kanban check STO-... --attempt-id ID --fencing-token N --criterion ID --json
local-kanban validate STO-... --attempt-id ID --fencing-token N --json
local-kanban complete STO-... --attempt-id ID --fencing-token N --role orchestrator --json
local-kanban worktree-remove STO-... --attempt-id ID --delete-branch --json
local-kanban release STO-... --attempt-id ID --fencing-token N --outcome released --json
```

Crear trabajo nuevo mediante `create-epic` y `create-story`; no generar sus Markdown manualmente. Conservar el `attemptId` y `fencingToken` devueltos por `claim`; toda mutación posterior de ejecución los exige y renueva el lease. No inventarlos ni reutilizarlos en otra historia. Usar `show` para regenerar la cápsula tras resume. Marcar únicamente trabajo realmente terminado con `check`; repetirlo es seguro y no desmarca. Resolver un bloqueo con `resolve` antes de continuar y usar `release` para handoff, abandono o recuperación explícita. `validate` sin `STORY_ID` valida globalmente los documentos del proyecto; con `STORY_ID` ejecuta los comandos declarados por la historia, registra evidencia durable vinculada al commit y al intento, y entrega en `testing/verifying`. Solo el orquestador usa `complete`, después de integrar: el comando vuelve a validar sobre el checkout principal, registra evidencia del commit integrado y después cierra. Retirar el worktree limpio con `worktree-remove` tras el cierre.

## Flujo del orquestador

1. Reconciliar repositorio, estado durable y runtime antes de asignar trabajo.
2. Resolver resultados, leases expirados, bloqueos y conflictos pendientes.
3. Consultar historias elegibles, entregas pendientes y trabajo que requiere intervención con `local-kanban next --json`. La respuesta separa `stories` para implementación, `verification` para revisión/cierre y `attention` para claims stale, bloqueos o intentos liberados que deben reanudarse. Las colas se ordenan de forma determinista:
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
