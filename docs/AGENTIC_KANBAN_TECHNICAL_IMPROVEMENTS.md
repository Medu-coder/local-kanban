# Mejoras técnicas para un Kanban agéntico world class

**Estado del documento:** borrador para revisión  
**Fecha:** 2026-07-14  
**Ámbito:** metodología, runtime de coordinación, integridad, interfaces para agentes, verificabilidad y control humano  
**Fuera de ámbito:** rediseño estético de la aplicación web

## 1. Propósito

Este documento define la evolución de Local Kanban desde un tablero local basado en Markdown hasta un sistema operativo agéntico capaz de coordinar proyectos de desarrollo largos, complejos y ejecutados en paralelo por múltiples agentes.

El usuario principal del sistema no es el humano que mueve tarjetas. Los usuarios principales son:

- El **orquestador**, que descompone, prioriza, asigna, monitoriza, integra y replanifica.
- Los **especialistas**, que reclaman unidades de trabajo acotadas, las ejecutan de extremo a extremo y aportan evidencia verificable.
- Los **verificadores**, cuando el riesgo exige revisión independiente.
- El **humano**, que observa, resuelve excepciones, aprueba decisiones y gobierna riesgos.

La interfaz web es un plano de observación y control. La metodología debe poder ejecutarse completamente sin abrir la UI.

Este documento está pensado para ser anotado antes de implementar. No constituye todavía un plan cerrado ni autoriza cambios de arquitectura.

## 2. Cómo revisar y anotar este documento

Cada propuesta tiene un identificador estable. El campo `Estado` puede cambiarse a uno de estos valores:

- `propuesta`: pendiente de decisión.
- `aceptada`: se incorporará al roadmap.
- `modificar`: la dirección es válida, pero requiere cambios.
- `rechazada`: no se implementará.
- `diferida`: válida, pero fuera del horizonte actual.

Las anotaciones pueden escribirse directamente bajo `Notas de Eduardo`. Las dudas transversales o decisiones que afecten a varias propuestas pueden añadirse a la sección de decisiones abiertas.

## 3. Punto de partida

Local Kanban ya tiene fundamentos valiosos que deben preservarse:

- Markdown legible y versionable como representación portable del trabajo.
- Separación entre el repositorio del Kanban y los proyectos gestionados.
- Contrato normativo importado desde `AGENTS.md`.
- Roles diferenciados de orquestador y especialista.
- Historias con ownership, dependencias, contexto, subtareas y criterios ready/done.
- Edición directa por agentes y sincronización visual mediante watchers y SSE.
- Ejecución end to end y obligación de dejar trazabilidad.

La principal limitación actual es que muchas reglas existen solo en `skills/local-kanban-agent/SKILL.md`. El backend representa la coordinación, pero no garantiza sus invariantes. Además, varias escrituras concurrentes sobre Markdown pueden pisarse silenciosamente.

El diagnóstico técnico detallado está en:

- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONCERNS.md`
- `.planning/codebase/TESTING.md`

## 4. Qué significa “world class” en este producto

Local Kanban será world class cuando la metodología sea:

- **Determinista:** el mismo estado y la misma política producen el mismo trabajo elegible y el mismo orden recomendado.
- **Segura bajo concurrencia:** ningún agente pierde, pisa o duplica trabajo silenciosamente.
- **Ejecutable:** las reglas normativas se validan en el núcleo, no solo en prompts o documentación.
- **Auditable:** cada transición, intento, decisión, override y validación tiene actor, causa, momento y evidencia.
- **Reanudable:** otro agente puede continuar después de una caída o compactación sin reconstruir el chat anterior.
- **Portable:** puede instalarse y operar en repositorios y runtimes distintos sin rutas absolutas frágiles.
- **Evaluable:** se mide el cumplimiento del protocolo agéntico, no solo el funcionamiento de la UI.
- **Gobernable:** el humano ve excepciones y puede aprobar, pausar, reasignar, reintentar o cancelar de forma auditada.
- **Local-first:** no exige infraestructura remota para coordinar varios procesos locales.

## 5. Principios normativos objetivo

1. Una historia es un contrato de resultado verificable, no una conversación ni una lista informal.
2. Asignación no equivale a claim; el trabajo activo requiere adquisición exclusiva.
3. Todo trabajo activo tiene identidad de agente, sesión, intento, lease y revisión.
4. Ningún agente ejecuta sin readiness, alcance, autoridad y definición de terminado.
5. El orquestador optimiza el flujo global y no absorbe trabajo delegable salvo override explícito.
6. El especialista no amplía el alcance silenciosamente.
7. Paralelizar exige independencia lógica y física de los cambios.
8. Todo bloqueo tiene tipo, evidencia, responsable y siguiente acción.
9. El contexto se entrega mínimo, versionado e incrementalmente ampliable.
10. Finalizar código no equivale a cerrar una historia: integración, revisión y validación son gates separados.
11. Todo fallo, retry, handoff y abandono es un dato de primera clase.
12. El estado debe sobrevivir a la caída o sustitución de cualquier agente.
13. El mismo núcleo de dominio gobierna Markdown, API, CLI, MCP y UI.
14. La UI nunca es obligatoria para ejecutar la metodología.

## 6. Decisión arquitectónica principal

### DEC-001 — Autoridad transaccional y papel de Markdown

**Estado:** `propuesta`  
**Recomendación:** adoptar un modelo híbrido.

#### Problema

Markdown es excelente como formato portable y revisable en Git, pero no proporciona por sí solo transacciones, compare-and-swap, claims atómicos, leases, idempotencia, journaling ni recuperación robusta. Implementar todas estas capacidades sobre archivos convertiría el backend en una base de datos incompleta y frágil.

#### Arquitectura recomendada

- Markdown conserva el plan, las historias, los criterios, las decisiones y los resultados portables.
- Un sidecar local con SQLite en modo WAL mantiene el estado transaccional de ejecución: comandos, eventos, revisiones, claims, leases, intentos, locks, evidencias y outbox.
- El núcleo de dominio procesa todos los comandos y persiste evento más estado en una transacción.
- Markdown se actualiza como proyección durable y exportable.
- Los cambios externos en Markdown se validan e importan como comandos reconciliados.
- Una edición externa basada en una revisión antigua genera conflicto; nunca pisa silenciosamente trabajo nuevo.

```text
Agente / Orquestador / Humano
        │
        ├── CLI JSON
        ├── MCP
        ├── API HTTP v1
        └── Web UI
                 │
          Command Gateway
   identidad · esquema · revisión · idempotencia
                 │
          Núcleo de dominio
      invariantes · DAG · estados · políticas
                 │
       SQLite WAL + Event Journal
    commands · events · state · leases · outbox
                 │
       Projection / Reconciliation
          ├── Markdown portable
          ├── stream de eventos para UI
          └── snapshots y exportación
```

#### Alternativa transitoria

Mantener Markdown como autoridad inicial e introducir:

- Mutex por entidad.
- Lock interproceso.
- Escritura temporal, `fsync` y rename atómico.
- Revisión y compare-and-swap.
- Creación exclusiva.
- Journal append-only independiente.

Esta alternativa reduce el riesgo inmediato, pero no debe cerrar la puerta a SQLite. Hay que evitar primitives temporales incompatibles con la arquitectura objetivo.

#### Criterios para decidir

- El estado del proyecto debe seguir siendo legible sin arrancar Local Kanban.
- Debe existir exportación y reconstrucción verificable.
- Un proyecto clonado debe poder recrear el runtime local.
- El sidecar no se versionará en Git; las proyecciones portables sí.
- La aplicación debe explicar claramente si DB y Markdown están sincronizados.

#### Notas de Eduardo

> Escribir aquí.

#### Decisión final

> Pendiente.

---

# 7. Mejoras P0 — Safety baseline

Estas mejoras deben completarse antes de considerar segura la ejecución paralela real.

## AK-001 — Esquema canónico versionado y validación estricta

**Estado:** `propuesta`  
**Prioridad:** P0  
**Dependencias:** ninguna

### Problema

El modelo actual normaliza silenciosamente valores inválidos, permite referencias inconsistentes y duplica parte del contrato entre backend, frontend, ejemplos y skill. Los `PUT` pueden borrar campos desconocidos o resetear datos omitidos.

### Mejora recomendada

Crear esquemas machine-readable versionados para proyecto, épica, historia, criterio, subtarea, dependencia, bloqueo, intento, evidencia, comando y evento.

Campos base recomendados:

- `schema_version` y `contract_version`.
- ID interno inmutable y clave humana estable.
- `revision` monotónica.
- `created_at`, `created_by`, `updated_at`, `updated_by`.
- IDs estables para subtareas y criterios; no volver a mutar por índice.
- `rank` explícito para orden.
- Campos de extensión con política explícita de conservación.

Los tipos de código, OpenAPI, CLI, MCP y documentación deben generarse o validarse desde el mismo contrato.

### Criterios de aceptación

- Todo documento y payload se valida contra una versión conocida.
- Los errores indican campo, valor, regla y acción correctiva.
- Se rechazan IDs, enums, timestamps, referencias y transiciones inválidas.
- Nombre de archivo e ID coinciden obligatoriamente.
- Se detectan duplicados, autorreferencias, épicas inexistentes y ciclos.
- Los campos desconocidos se conservan o se rechazan; nunca desaparecen sin aviso.
- Existe migración desde el formato actual con dry-run y backup.

### Alternativas o tradeoffs

- JSON Schema mantiene neutralidad de lenguaje.
- Zod u otra librería puede complementar el runtime, pero no debería convertirse en el único contrato portable.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-002 — Confinamiento completo del filesystem

**Estado:** `propuesta`  
**Prioridad:** P0  
**Dependencias:** AK-001

### Problema

IDs, `docsPath` y otras rutas pueden escapar de los directorios autorizados. La API local se usa directamente por agentes y no puede confiar en que la UI genere valores seguros.

### Mejora recomendada

- Validar IDs con patrones cerrados.
- Resolver cada destino con `path.resolve` y verificar confinamiento.
- Rechazar `..`, separadores, rutas absolutas no permitidas y escapes por symlink.
- Validar que `docsPath` permanezca dentro de `rootPath`.
- Limitar tamaño de archivos, YAML, arrays y payloads.
- Aislar proyectos inseguros sin derribar el resto.
- Redactar rutas internas y datos sensibles en errores públicos.

### Criterios de aceptación

- Ninguna operación puede leer o escribir fuera del proyecto registrado.
- Existen pruebas de traversal, symlink escape, Unicode, casing y TOCTOU.
- La creación concurrente de un ID tiene un único ganador.
- Un proyecto con configuración insegura queda deshabilitado con diagnóstico accionable.
- El servidor no expone mutaciones fuera de loopback sin autenticación explícita.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-003 — Escritura atómica, revisiones e idempotencia

**Estado:** `propuesta`  
**Prioridad:** P0  
**Dependencias:** AK-001

### Problema

Las mutaciones actuales siguen el patrón `leer → modificar → sobrescribir`. Dos agentes o la UI y un agente pueden perder cambios sin recibir ningún error.

### Mejora recomendada

- Revisión monotónica o hash por entidad.
- `expectedRevision` o `If-Match` en toda mutación.
- Compare-and-swap y respuesta `409 revision_conflict`.
- Mutex por entidad y protección interproceso.
- Archivo temporal en el mismo filesystem, `fsync`, rename atómico y `fsync` del directorio.
- Creación exclusiva con `wx`.
- Clave de idempotencia para comandos reintentables.
- Sustituir el `PUT` full-replace habitual por comandos o `PATCH` tipado.

### Criterios de aceptación

- Dos writers sobre la misma revisión no pueden producir last-write-wins silencioso.
- Un retry con la misma clave devuelve el mismo resultado sin duplicar efectos.
- Una caída durante la escritura conserva el documento anterior o el nuevo, nunca uno parcial.
- Un conflicto devuelve revisión esperada, revisión actual y datos útiles para reconciliar.
- Hay tests multiproceso y de fault injection.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-004 — Núcleo de dominio único e invariantes ejecutables

**Estado:** `propuesta`  
**Prioridad:** P0  
**Dependencias:** AK-001, AK-003

### Problema

La skill exige reglas que el backend no impone. Actualmente se puede llegar a `done` incompleto, y `/move` puede eludir el gate de entrada en `developing`.

### Mejora recomendada

Extraer un núcleo de dominio independiente de Express, React, Markdown y SQLite. Toda superficie debe invocar las mismas reglas.

Invariantes mínimas:

- No iniciar sin Definition of Ready completa.
- No ejecutar historias `human` desde identidad de especialista.
- No avanzar con dependencias duras abiertas.
- No cerrar con bloqueos, subtareas o criterios pendientes.
- No cerrar sin evidencia exigida.
- No mutar ejecución reclamada por otro agente.
- No aceptar relaciones huérfanas, ciclos o épicas inexistentes.
- No reabrir, cancelar o forzar una transición sin causa y autoridad.
- Las reglas derivadas de cierre deben ser monotónicas.

### Criterios de aceptación

- API, CLI, MCP, UI e importación Markdown obtienen la misma decisión.
- Cada denegación tiene código estable y remediation hints legibles por agentes.
- Las transiciones se prueban mediante tablas y tests negativos.
- Ninguna superficie puede eludir un gate mediante un endpoint alternativo.
- Los overrides privilegiados exigen razón y generan auditoría.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-005 — Separar estado funcional y estado de ejecución

**Estado:** `propuesta`  
**Prioridad:** P0  
**Dependencias:** AK-004

### Problema

`backlog`, `developing`, `testing` y `done` mezclan progreso del producto con situación operativa del agente. No expresan claim, ejecución, espera humana, retry, abandono o cancelación.

### Mejora recomendada

Conservar una proyección visual simple y añadir un estado operativo independiente.

Ejemplo inicial:

```text
unplanned → ready → claimed → running → verifying → completed
                           ├──→ blocked
                           ├──→ waiting_human
                           ├──→ retryable
                           ├──→ abandoned
                           └──→ cancelled
```

Cada estado debe definir:

- Transiciones de entrada y salida.
- Actor autorizado.
- Campos obligatorios.
- Timeouts o políticas aplicables.
- Proyección en las columnas humanas.

### Criterios de aceptación

- Toda historia activa tiene un estado operativo inequívoco.
- `running` exige readiness y claim vigentes.
- `blocked` exige un bloqueo estructurado.
- `completed` exige DoD y evidencia.
- Un estado visual nunca oculta una espera humana o un intento abandonado.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

---

# 8. Mejoras P1 — Runtime de coordinación agéntica

## AK-006 — Identidad, sesión, intentos, claim, lease y fencing

**Estado:** `propuesta`  
**Prioridad:** P1 crítica  
**Dependencias:** AK-003, AK-004, AK-005

### Problema

`agent_owner` es una etiqueta, no una exclusión mutua. No existe identidad de ejecución, intento ni mecanismo seguro para recuperar una historia tras la caída de un agente.

### Mejora recomendada

Diferenciar asignación y ejecución efectiva:

- `assigned_agent`.
- `agent_id`, runtime y capacidades.
- `session_id`, `run_id` y `attempt_id`.
- Claim atómico.
- Lease renovable con heartbeat.
- `fencing_token` monotónico.
- Release, handoff, cancelación y recuperación.
- Override del orquestador con razón.

Un agente con lease expirado o fencing token obsoleto no puede seguir mutando el intento.

### Criterios de aceptación

- Dos claims concurrentes producen exactamente un ganador.
- Solo el claimant vigente puede ejecutar mutaciones operativas.
- Un lease expirado inicia recuperación controlada y conserva el intento anterior.
- Reasignación y handoff registran cedente, receptor, actor y causa.
- Toda mutación incluye actor, sesión, intento y clave de idempotencia.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-007 — Scheduler determinista y límites WIP

**Estado:** `propuesta`  
**Prioridad:** P1 crítica  
**Dependencias:** AK-004, AK-005, AK-006, AK-009

### Problema

El orquestador debe descargar el snapshot completo y reconstruir manualmente qué trabajo está listo y en qué orden conviene ejecutarlo.

### Mejora recomendada

Crear un motor consultable de elegibilidad y ranking.

Elegibilidad mínima:

- Modo de ejecución compatible.
- DoR completa.
- Dependencias duras resueltas.
- Sin claim vigente.
- Capacidades compatibles.
- WIP disponible.
- Sin conflicto de workspace o superficie de cambio.
- Gates humanos satisfechos.

Ranking recomendado:

1. Ruta crítica o milestone comprometido.
2. Trabajo que más desbloquea.
3. Prioridad y rank manual.
4. Riesgo que conviene retirar pronto.
5. Antigüedad.
6. Afinidad de contexto y workspace.
7. Coste o tamaño estimado.

El scheduler recomienda y explica. La política del proyecto decide si puede asignar automáticamente.

### Criterios de aceptación

- El mismo snapshot y política producen el mismo ranking.
- Cada candidato explica `why_ready`, `why_blocked` y factores de score.
- Una historia no elegible nunca puede reclamarse.
- Se respetan WIP, capacidades y conflictos físicos.
- Los overrides humanos quedan auditados.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-008 — Contrato ejecutable de historia, DoR y DoD

**Estado:** `propuesta`  
**Prioridad:** P1 crítica  
**Dependencias:** AK-001, AK-004

### Problema

Los checklists actuales no garantizan que una historia defina un resultado observable, límites claros, artefactos esperados o un plan de validación reproducible.

### Mejora recomendada

Una historia ejecutable por agentes debe declarar:

- Objetivo observable.
- Alcance incluido y excluido.
- Criterios de aceptación.
- Restricciones y decisiones previas.
- Artefactos esperados.
- Plan y comandos de validación.
- Nivel de riesgo y revisión requerida.
- Estrategia de rama/worktree.
- Presupuesto de complejidad y contexto.

DoR universal:

- Objetivo, scope, dependencias, contexto y validación definidos.
- Ownership y entorno posibles.
- Tamaño compatible con una unidad de ejecución.

DoD universal:

- Aceptación satisfecha.
- Subtareas y validaciones completas.
- Evidencia persistida y vigente.
- Cambios localizables e integrables.
- Documentación afectada actualizada.
- Sin trabajo residual oculto.
- Handoff final emitido.

### Criterios de aceptación

- Una historia incompleta no puede llegar a `ready`.
- Una historia demasiado grande debe dividirse antes del claim.
- Cada criterio declara si es automático, manual o requiere aprobación.
- El cierre identifica exactamente qué evidencia satisface cada criterio.
- El trabajo descubierto fuera de scope genera nueva historia o replanificación explícita.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-009 — Dependencias tipadas y DAG validado

**Estado:** `propuesta`  
**Prioridad:** P1  
**Dependencias:** AK-001, AK-004

### Problema

`blocked_by`, `blocks` y `related_to` pueden ser asimétricos, duplicados o cíclicos. Tampoco expresan si una relación impide empezar, integrar o solo aporta información.

### Mejora recomendada

Definir relaciones canónicas con ID y tipo:

- `hard`: impide empezar.
- `integration`: permite implementar, pero impide integrar o cerrar.
- `decision`: espera una decisión.
- `resource_conflict`: obliga a serializar.
- `informational`: aporta contexto.

Cada dependencia debe incluir motivo, condición de satisfacción y origen. `blocks` debe ser una proyección derivada, no un segundo dato editable.

### Criterios de aceptación

- Las dependencias duras forman un DAG.
- No existen relaciones duplicadas o contradictorias.
- Cada relación explica por qué existe y cuándo queda satisfecha.
- El scheduler aplica la semántica de cada tipo.
- Cambiar o eliminar una relación genera un evento auditable.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-010 — Bloqueos estructurados, retries y escalado

**Estado:** `propuesta`  
**Prioridad:** P1  
**Dependencias:** AK-005, AK-006

### Problema

Una nota libre no permite distinguir espera humana, dependencia, fallo técnico reintentable o conflicto de integración.

### Mejora recomendada

Cada bloqueo debe registrar:

- Tipo: `human_input`, `credential`, `external_service`, `dependency`, `environment`, `technical`, `merge_conflict`, `policy`, `scope` o `insufficient_context`.
- Descripción y evidencia.
- Responsable de desbloquear.
- Acción solicitada.
- Condición de reanudación.
- Impacto y fecha de inicio.
- Próximo reintento y política de backoff.
- Límite de intentos y regla de escalado.

### Criterios de aceptación

- Ninguna historia queda bloqueada solo con prosa libre.
- Todo bloqueo tiene owner y siguiente acción.
- Los fallos terminales no se reintentan indefinidamente.
- Los bloqueos humanos forman una cola consultable.
- El tiempo bloqueado y el número de intentos son medibles.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-011 — Context manifest, checkpoints, handoff y resume

**Estado:** `propuesta`  
**Prioridad:** P1  
**Dependencias:** AK-006, AK-008

### Problema

`context_files` no indica qué debe leerse, por qué, en qué versión o con qué presupuesto. `agent_status_note` no permite reanudar trabajo largo tras una caída o sustitución.

### Mejora recomendada

Crear un paquete de contexto versionado con:

- Objetivo y no-objetivos.
- Recursos obligatorios y opcionales.
- Motivo, símbolos o rangos relevantes.
- Commit, hash o revisión.
- Decisiones y restricciones.
- Inputs consumidos y outputs esperados.
- Comandos de validación.
- Autoridad concedida.
- Presupuesto orientativo de contexto.

Crear checkpoints con:

- Progreso y decisiones vigentes.
- Cambios, commits y archivos relevantes.
- Tests ejecutados y resultados.
- Trabajo restante.
- Problemas conocidos.
- Siguiente acción exacta.
- Estado de branch/worktree.

### Criterios de aceptación

- Otro especialista puede continuar sin consultar el chat anterior.
- El contexto se puede reconstruir y detectar como obsoleto.
- Toda ampliación se solicita y registra con causa.
- Los handoffs tienen emisor, receptor y aceptación explícita.
- La UI muestra el contexto exacto y la revisión entregada al agente.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-012 — Aislamiento Git y prevención de conflictos

**Estado:** `propuesta`  
**Prioridad:** P1  
**Dependencias:** AK-006, AK-007, AK-008

### Problema

Dos historias lógicamente independientes pueden tocar los mismos archivos, worktrees o subsistemas. La metodología actual no modela esa incompatibilidad física.

### Mejora recomendada

Cada intento debe registrar:

- `base_commit`.
- Branch o worktree.
- Superficie prevista de cambio.
- `conflict_domains`.
- Archivos esperados cuando se conozcan.
- Commits producidos.
- Estrategia y responsable de integración.

El scheduler debe serializar superficies incompatibles o exigir un plan de coordinación explícito.

### Criterios de aceptación

- Se detectan solapamientos entre trabajos activos.
- Un conflicto exige serialización u override justificado.
- Los especialistas no integran cambios ajenos por iniciativa propia.
- Una historia no se cierra si sus cambios no están localizables o integrados según la política.
- Conflictos y fallos de integración son bloqueos estructurados.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-013 — API de comandos agent-first

**Estado:** `propuesta`  
**Prioridad:** P1  
**Dependencias:** AK-001, AK-003, AK-004, AK-006

### Problema

Los endpoints genéricos, toggles por índice y reemplazos completos son difíciles de usar con seguridad desde agentes y poco expresivos para auditoría.

### Mejora recomendada

Introducir `/api/v1` con comandos explícitos, por ejemplo:

- `CreateStory`
- `UpdateStoryMetadata`
- `ClaimStory`
- `StartExecution`
- `CompleteSubtask`
- `RecordCheckpoint`
- `RequestReview`
- `RecordValidation`
- `BlockStory`
- `ResolveBlock`
- `CompleteStory`
- `ReleaseLease`
- `HandoffStory`

Todo comando debe incluir:

- `commandId` e `idempotencyKey`.
- Actor, sesión e intento.
- `expectedRevision`.
- `correlationId`.
- Payload tipado.
- Opción `dryRun` cuando tenga sentido.

### Criterios de aceptación

- Existe OpenAPI versionada.
- Los errores tienen códigos estables y formato machine-readable.
- Ninguna colección se modifica por posición.
- Cada comando es idempotente o declara explícitamente que no lo es.
- `dryRun` devuelve efectos e invariantes sin mutar.
- Cada respuesta incluye nueva revisión, eventos y siguiente acción sugerida.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-014 — CLI y MCP como interfaces de primera clase

**Estado:** `propuesta`  
**Prioridad:** P1  
**Dependencias:** AK-013

### Problema

Los agentes no deberían recordar `curl`, parsear snapshots enormes ni depender de una UI. La skill tampoco debería duplicar manualmente todos los contratos de la API.

### Mejora recomendada

CLI orientativa:

```bash
kanban doctor
kanban project init
kanban work next --json
kanban story show STO-123 --agent-view --json
kanban story claim STO-123 --json
kanban story checkpoint STO-123 --json
kanban story block STO-123 --json
kanban story complete STO-123 --evidence ... --json
kanban events tail --json
```

MCP debe ofrecer recursos compactos y tools de mínimo privilegio para consultar trabajo, claimar, renovar, registrar checkpoint, bloquear, pedir revisión, aportar evidencia y cerrar.

### Criterios de aceptación

- API, CLI y MCP pasan contract tests comunes.
- El flujo completo de un agente no requiere UI ni edición manual.
- Las respuestas son compactas por defecto y expandibles selectivamente.
- Al menos dos runtimes agénticos pasan los mismos escenarios.
- La skill referencia contratos generados en lugar de mantener catálogos divergentes.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

---

# 9. Mejoras P2 — Auditoría, evidencia y recuperación

## AK-015 — Event journal append-only

**Estado:** `propuesta`  
**Prioridad:** P2 alta  
**Dependencias:** DEC-001, AK-003, AK-013

### Problema

El sistema solo conserva principalmente el último estado. No puede reconstruir quién hizo qué, por qué, en qué intento o sobre qué revisión.

### Mejora recomendada

Registrar eventos inmutables para comandos aceptados:

- ID global ordenable y versión de evento.
- Entidad y revisiones previa/nueva.
- Actor, sesión e intento.
- Timestamp del servidor.
- Correlation y causation IDs.
- Causa y efecto.
- Evidencias relacionadas.
- Estado de la proyección Markdown.

Con SQLite, evento y estado materializado deben persistirse en la misma transacción. Una outbox actualiza Markdown y notifica a clientes de forma reintentable.

### Criterios de aceptación

- Todo cambio tiene actor, causa y correlation ID.
- El estado puede reconstruirse desde journal y snapshots.
- Una proyección fallida se reintenta sin perder el comando.
- La auditoría no se modifica mediante endpoints normales.
- Los eventos se exportan a JSONL con redacción de secretos.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-016 — Evidencia verificable y revisión basada en riesgo

**Estado:** `propuesta`  
**Prioridad:** P2 alta  
**Dependencias:** AK-008, AK-013, AK-015

### Problema

Un checkbox o una nota no demuestra que el código haya sido construido, probado, revisado o integrado. El mismo agente puede implementar y autocertificar tareas críticas.

### Mejora recomendada

Modelar evidencia como entidad estructurada:

- Tipo: test, build, lint, screenshot, assertion API, benchmark, security scan, review o aprobación humana.
- Comando o procedimiento.
- Exit code y resumen.
- Artefacto o ubicación.
- Commit y revisión.
- Actor e instante de captura.
- Criterio que satisface.

Definir riesgo:

- Bajo: autoverificación permitida.
- Medio: revisión independiente.
- Alto: revisión independiente más gates específicos o aprobación humana.

Flujo operativo recomendado:

```text
running → awaiting_review → changes_requested
                    └────→ validating → completed
```

### Criterios de aceptación

- Cada criterio declara la evidencia aceptada.
- Evidencia obsoleta por cambios posteriores se invalida.
- Una historia que exige review no puede cerrarse sin aprobación vigente.
- El verificador recibe criterios y evidencia, no necesita la conversación completa del implementador.
- Los rechazos vuelven a ejecución con hallazgos estructurados.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-017 — Reconciliación, doctor, backups y modo degradado

**Estado:** `propuesta`  
**Prioridad:** P2 alta  
**Dependencias:** DEC-001, AK-001, AK-003, AK-015

### Problema

Un documento inválido puede derribar la carga completa. Los watchers no se recuperan bien de directorios inexistentes o recreados y no existe una reparación operativa formal.

### Mejora recomendada

- Cuarentena por entidad; un archivo corrupto no bloquea los sanos.
- Estado `healthy`, `degraded` y `out_of_sync`.
- Watchers reiniciables con backoff y watch de ancestros.
- Reconciliación periódica además de eventos filesystem.
- Fingerprints y revisiones para cambios externos.
- `kanban doctor` para schema, DAG, IDs, permisos, watchers, DB, leases y proyecciones.
- Snapshots antes de migraciones y restore verificable.
- Soft delete, tombstones y archivado.
- Rebuild de proyecciones desde journal.

### Criterios de aceptación

- Un Markdown defectuoso solo aísla esa entidad.
- Directorios creados o recreados después del arranque vuelven a sincronizarse.
- Un evento perdido se recupera por reconciliación.
- Restore y rebuild se prueban automáticamente.
- La UI y CLI explican degradación y acciones de reparación.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-018 — Streams incrementales y límites de escala medidos

**Estado:** `propuesta`  
**Prioridad:** P2  
**Dependencias:** DEC-001, AK-015, AK-017

### Problema

Cada lectura y evento relee y transmite todos los proyectos. El coste crece con proyectos, historias, agentes y pestañas abiertas.

### Mejora recomendada

- Índices por proyecto, historia, estado, dependencia y owner.
- Lectura individual y consultas paginadas/filtradas.
- Snapshot inicial más stream de deltas.
- SSE con `eventId`, cursor, replay y `Last-Event-ID`.
- ETag para lecturas.
- Backpressure y coalescing.
- Estado derivado calculado una sola vez en el backend.
- Benchmarks y soak tests con límites publicados.

### Criterios de aceptación

- Mutar una historia no relee ni retransmite todo el sistema.
- Un cliente reconecta desde cursor o solicita snapshot si ha expirado.
- Los eventos duplicados no generan mutaciones dobles.
- Se publica un límite soportado de proyectos, historias, clientes y filesystem.
- Objetivo inicial a validar: p95 menor de 100 ms en comandos y 250 ms hasta reflejo UI con 10.000 historias locales.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-019 — Observabilidad operativa

**Estado:** `propuesta`  
**Prioridad:** P2  
**Dependencias:** AK-006, AK-015, AK-017

### Problema

No existe una forma directa de diagnosticar claims atascados, watchers caídos, conflictos, proyecciones pendientes o fallos recurrentes.

### Mejora recomendada

- Logs JSON con IDs de comando, evento, correlación, proyecto, historia, actor e intento.
- Redacción de secretos y rotación.
- Health separado en liveness, readiness y degradación.
- Métricas de cycle time, bloqueo, retries, rework, expiraciones, conflictos y validaciones.
- `kanban status`, `kanban events tail` y bundle de diagnóstico saneado.
- Alertas locales para trabajo stale, colas bloqueadas y sincronización rota.

### Criterios de aceptación

- Un agente o humano puede diagnosticar una historia atascada sin leer código del servidor.
- Todo error devuelve código estable y correlation ID.
- El bundle de soporte no contiene secretos ni cuerpos completos por defecto.
- Las métricas se derivan de eventos, no de timestamps editables por agentes.
- Es posible seguir una historia desde claim hasta integración y validación.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

---

# 10. Mejoras P2 — Calidad, evaluación y distribución

## AK-020 — Pirámide de tests y fault injection

**Estado:** `propuesta`  
**Prioridad:** P2 alta  
**Dependencias:** AK-004

### Problema

La cobertura actual depende casi exclusivamente de Playwright. Faltan pruebas rápidas de dominio, concurrencia, seguridad y recovery.

### Mejora recomendada

- Unitarios para schemas, DAG, transiciones, scheduler y reglas.
- Property-based para invariantes, grafos, round-trip Markdown e idempotencia.
- Integración para filesystem, SQLite, locks, CAS, migraciones y watchers.
- Contract tests compartidos por API, CLI y MCP.
- E2E para flujo humano y flujo agéntico completo.
- Chaos/fault injection: kill durante write, lease expirado, outbox fallida y eventos duplicados.
- Performance y soak.
- Security regression para traversal, exposición de red, payloads y secretos.

### Criterios de aceptación

- Cada invariante P0 tiene al menos un test negativo.
- Los tests SSE verifican actualización live sin `reload`.
- CI no reutiliza servidores preexistentes.
- Existe un test reproducible con múltiples writers y procesos.
- La cobertura alta se exige en el núcleo de dominio, no como cifra global engañosa.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-021 — Harness de evaluación agéntica

**Estado:** `propuesta`  
**Prioridad:** P2 alta  
**Dependencias:** AK-006 a AK-016

### Problema

Los tests de software no demuestran que orquestadores y especialistas cumplan la metodología en proyectos largos.

### Mejora recomendada

Crear escenarios reproducibles como:

1. Dos agentes intentan reclamar la misma historia.
2. Un agente pierde el lease y otro reanuda.
3. Una dependencia se desbloquea y activa nuevo trabajo.
4. Falta contexto crítico.
5. Un agente intenta cerrar sin tests.
6. Aparece una edición externa concurrente.
7. Un especialista falla y realiza handoff.
8. Dos historias tienen conflicto de archivos.
9. Se requiere aprobación humana.
10. Tras cerrar una historia queda nuevo trabajo ejecutable.

Métricas recomendadas:

- Cumplimiento de ownership.
- Cierres válidos.
- Trabajo duplicado.
- Recuperación tras fallo.
- Calidad del handoff.
- Intervenciones humanas.
- Tiempo hasta detectar bloqueo.
- Contexto consumido frente a contexto útil.

### Criterios de aceptación

- Los escenarios se ejecutan con agentes simulados deterministas.
- Opcionalmente pueden ejecutarse con runtimes reales.
- Cada release publica resultados comparables con un baseline.
- Fallar una regla crítica bloquea el release aunque la UI funcione.
- Los fixtures incluyen DAGs amplios, ejecución paralela y proyectos prolongados.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-022 — CLI de instalación, doctor y migraciones

**Estado:** `propuesta`  
**Prioridad:** P2  
**Dependencias:** AK-001, AK-014, AK-017

### Problema

La instalación actual depende de setup, edición manual de JSON, rutas absolutas y scripts específicos de macOS. Esto limita la adopción en cualquier repo o runtime.

### Mejora recomendada

```bash
npx local-kanban init
local-kanban add-project .
local-kanban doctor
local-kanban validate
local-kanban migrate --dry-run
local-kanban start
local-kanban export
local-kanban uninstall
```

Todas las operaciones deben ser idempotentes, soportar `--json` y documentar códigos de salida.

Versionar por separado cuando sea necesario:

- Aplicación.
- API.
- Schema.
- Contrato agéntico.

### Criterios de aceptación

- Bootstrap repetido no destruye configuración.
- No es obligatorio editar JSON manualmente.
- Migraciones tienen dry-run, backup, rollback e idempotencia.
- Instalación y upgrade se prueban en workspaces limpios.
- La operación básica no depende de `.command` ni de PM2.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-023 — Contrato vendorizado y compatibilidad multi-runtime

**Estado:** `propuesta`  
**Prioridad:** P2  
**Dependencias:** AK-001, AK-014, AK-022

### Problema

La referencia absoluta a `KANBAN_ROOT/skills/...` es frágil al mover la instalación y asume que todos los runtimes interpretan la misma skill.

### Mejora recomendada

- Vendorizar en cada proyecto un contrato mínimo versionado.
- Registrar origen, checksum y `contract_version`.
- Actualización explícita con diff y preservación de reglas locales.
- Discovery por CLI, config o entorno.
- Contrato neutral como núcleo; skills y `AGENTS.md` como adapters.
- REST/OpenAPI, CLI JSON, Markdown schema y MCP como superficies portables.
- Capability negotiation por runtime: heartbeat, cancelación, artifacts y reporting.

### Criterios de aceptación

- Mover Local Kanban no rompe proyectos ya preparados.
- El proyecto valida offline su contrato.
- Una actualización nunca sobrescribe reglas locales sin confirmación.
- Se detectan contratos antiguos o manipulados.
- Al menos dos adapters pasan los mismos contract tests.
- Ninguna regla del dominio depende de una API concreta de subagentes.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-024 — CI, supply chain y releases reproducibles

**Estado:** `propuesta`  
**Prioridad:** P2  
**Dependencias:** AK-020, AK-022, AK-023

### Mejora recomendada

Pipeline mínimo:

- Format y lint.
- Typecheck o migración progresiva a TypeScript.
- Unitarios e integración.
- Build y E2E.
- Compatibilidad de schema y migraciones.
- Security audit y secret scanning.
- Revisión de dependencias y licencias.
- Matrix de Node y sistemas operativos soportados.
- Smoke test de instalación y packaging.

### Criterios de aceptación

- `npm ci` produce builds reproducibles.
- CI cubre Linux, macOS y Windows cuando sean soportados.
- Los PR no rompen contratos sin migración y nota de breaking change.
- Releases incluyen changelog, checksums y política de compatibilidad.
- Dependencias se actualizan mediante un proceso automatizado y verificable.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

---

# 11. Mejoras P3 — Plano de control humano

## AK-025 — Vista de operaciones y excepciones

**Estado:** `propuesta`  
**Prioridad:** P3  
**Dependencias:** AK-005 a AK-019

### Objetivo

La UI debe responder inmediatamente:

- Qué trabajo está listo ahora.
- Qué agentes están ejecutando y con qué lease.
- Qué trabajo está stale o abandonado.
- Qué bloqueos requieren intervención humana.
- Qué validaciones o revisiones han fallado.
- Qué conflictos o proyecciones están pendientes.
- Qué proyectos están degradados.

Debe permitir pausar, aprobar, rechazar, reasignar, reintentar y cancelar con confirmación y auditoría.

### Criterios de aceptación

- El humano identifica en una sola vista qué requiere acción.
- Cada estado derivado incluye explicación y fuente.
- Los elementos stale muestran última señal y acción de recuperación.
- Todas las acciones administrativas generan eventos.
- La UI no oculta historias huérfanas o inválidas; las presenta como errores reparables.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

## AK-026 — Timeline, evidencia, diff y deep links

**Estado:** `propuesta`  
**Prioridad:** P3  
**Dependencias:** AK-015, AK-016, AK-025

### Objetivo

- Timeline por historia, intento y proyecto.
- Commits, revisiones, evidencias, bloqueos y overrides relacionados.
- Comparación antes/después.
- Diferenciación entre afirmación del agente y hecho verificado por runtime.
- URLs estables para proyecto, historia, intento, filtro e incidente.
- Estado de navegación persistente al recargar.

### Criterios de aceptación

- Un enlace abre exactamente la excepción o intento referido.
- La UI permite reconstruir el recorrido completo de una historia.
- Los conflictos ofrecen diff útil o instrucciones concretas de resolución.
- Las aprobaciones humanas registran qué revisión y evidencia se aprobó.
- Accesibilidad y navegación por teclado forman parte del gate funcional.

### Notas de Eduardo

> Escribir aquí.

### Decisión final

> Pendiente.

---

# 12. Bucle normativo del orquestador

La skill del orquestador debería imponer este ciclo, respaldado por primitives del producto:

1. Reconciliar el estado del repositorio, runtime y Kanban.
2. Detectar resultados, leases vencidos, conflictos y bloqueos.
3. Recalcular DAG, ruta crítica, WIP y trabajo elegible.
4. Resolver o escalar bloqueos.
5. Preparar context manifests versionados.
6. Claimar y lanzar trabajo hasta el límite WIP.
7. Recibir heartbeats, checkpoints, resultados y handoffs.
8. Enviar trabajo a revisión y validación según riesgo.
9. Integrar en orden seguro.
10. Replanificar descubrimientos y cambios de alcance.
11. Reevaluar automáticamente trabajo desbloqueado.
12. Comprobar cierre de milestone o proyecto.
13. Persistir un resumen auditable de la ronda.

Invariantes del orquestador:

- No termina mientras exista trabajo agéntico elegible y capacidad disponible.
- No lanza trabajo sin claim, contexto y gates satisfechos.
- No ejecuta trabajo delegable salvo orden u override explícito.
- Puede justificar por qué lanzó, esperó, bloqueó o priorizó cada historia.
- Reconciliación precede a cada nueva ronda.

## Notas de Eduardo sobre el bucle

> Escribir aquí.

---

# 13. Secuencia de implementación recomendada

## Fase 0 — No perder ni corromper trabajo

Incluye:

- AK-001 a AK-004.
- Corrección inmediata de `/move` y gates de cierre.
- Tests de dominio, seguridad y concurrencia.

**Gate de salida:** ningún agente puede escapar del workspace, pisar trabajo silenciosamente o cerrar una historia inválida.

## Fase 1 — Convertir el tablero en coordinador

Incluye:

- AK-005 a AK-014.
- Claims, leases, scheduler, bloqueos, context packs, aislamiento y comandos agent-first.

**Gate de salida:** varios agentes pueden ejecutar y recuperarse sin coordinación manual externa al sistema.

## Fase 2 — Demostrar qué ocurrió y recuperarse

Incluye:

- DEC-001 si se aprueba el sidecar.
- AK-015 a AK-019.

**Gate de salida:** cualquier cierre explica quién hizo qué, sobre qué revisión, con qué evidencia y cómo recuperar el sistema tras un fallo.

## Fase 3 — Evaluar y distribuir

Incluye:

- AK-020 a AK-024.

**Gate de salida:** un proyecto limpio puede instalar, validar, evaluar, actualizar y migrar Local Kanban de forma reproducible en los entornos soportados.

## Fase 4 — Control plane humano

Incluye:

- AK-025 y AK-026.

**Gate de salida:** el humano gobierna excepciones y riesgos sin editar manualmente Markdown, JSON o SQLite.

---

# 14. Decisiones abiertas

| ID | Decisión | Recomendación inicial | Estado |
|---|---|---|---|
| DEC-001 | Markdown autoritativo o modelo híbrido con SQLite | Modelo híbrido | Pendiente |
| DEC-002 | ID interno UUID/ULID separado de `STO-*` | ULID interno + clave humana | Pendiente |
| DEC-003 | Mantener cuatro columnas como proyección | Sí, separadas del estado operativo | Pendiente |
| DEC-004 | Scheduler solo recomienda o autoasigna | Configurable por proyecto | Pendiente |
| DEC-005 | Heartbeat obligatorio para todos los runtimes | Capability negotiation con modo degradado | Pendiente |
| DEC-006 | Revisión independiente por defecto | Según riesgo | Pendiente |
| DEC-007 | MCP en la primera versión agent-first | Después de API y CLI estables | Pendiente |
| DEC-008 | TypeScript para el nuevo núcleo | Recomendado | Pendiente |
| DEC-009 | Soporte multi-OS inicial | macOS y Linux; Windows tras validar locks/watchers | Pendiente |
| DEC-010 | Git worktree obligatorio o configurable | Obligatorio para trabajo paralelo | Pendiente |

## Anotaciones sobre decisiones abiertas

> Escribir aquí.

---

# 15. Condiciones globales de salida

El producto podrá considerarse world class para ejecución agéntica local cuando:

- No exista pérdida silenciosa de actualizaciones.
- No exista cierre inválido por ninguna superficie.
- Todo trabajo activo tenga identidad, intento, lease y fencing token.
- Todo cambio tenga revisión, actor, causa e idempotencia.
- El estado pueda reconstruirse, migrarse y restaurarse.
- Markdown siga siendo portable y legible.
- Una edición externa conflictiva no pise una revisión posterior.
- API, CLI, MCP, UI y skill compartan un contrato único.
- El orquestador consulte y asigne trabajo listo mediante operaciones compactas.
- Los especialistas reciban contexto mínimo, versionado y suficiente.
- Los fallos de archivos, watchers, agentes o proyecciones se aíslen y recuperen.
- Cada cierre incluya evidencia vigente y trazable al commit correspondiente.
- Los límites de escala estén medidos, probados y publicados.
- Los escenarios agénticos críticos formen parte del gate de release.

## 16. Métricas de éxito

Las métricas deben derivarse de eventos y utilizarse para mejorar políticas, no para puntuar superficialmente a los agentes:

- Lead time y cycle time.
- Tiempo bloqueado por categoría.
- Ratio de claims expirados.
- Reintentos y abandonos.
- Rework tras revisión.
- Fallos de readiness y cierre.
- Conflictos concurrentes detectados y resueltos.
- Tiempo de integración.
- Historias desbloqueadas por unidad terminada.
- Intervenciones humanas por milestone.
- Contexto entregado, ampliado y realmente utilizado.
- Porcentaje de cierres con trazabilidad completa.
- Tiempo de recuperación después de caída de agente o daemon.

## 17. Riesgos de la transformación

- Introducir SQLite puede hacer que Markdown deje de percibirse como fuente de verdad si la reconciliación no es transparente.
- Añadir estados y metadatos sin buenas vistas compactas puede aumentar el contexto consumido por agentes.
- Un scheduler excesivamente complejo puede ser menos predecible que una política simple y explícita.
- Claims y leases mal configurados pueden bloquear trabajo válido o provocar churn.
- MCP, CLI y API pueden divergir si no comparten contract tests.
- Una migración grande del backend monolítico puede ralentizar la entrega si no se hace por slices verticales.
- Las métricas pueden incentivar comportamientos incorrectos si se convierten en objetivos aislados.

Mitigación general: implementar por fases con compatibilidad hacia atrás, migraciones reversibles, feature flags y gates verificables.

## 18. Registro de revisión

| Fecha | Autor | Cambio o decisión |
|---|---|---|
| 2026-07-14 | Codex | Borrador inicial para revisión de Eduardo |

