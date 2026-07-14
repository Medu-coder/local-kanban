# Mejoras técnicas para un Kanban agéntico world class

- **Estado:** decisiones cerradas; preparado para planificación.
- **Fecha:** 2026-07-14.
- **Objetivo:** evolucionar Local Kanban hacia una metodología simple, segura y eficiente para proyectos largos ejecutados con Codex.
- **Fuera de alcance:** rediseño estético, otros runtimes agénticos y soporte multiplataforma.

## 1. Visión

Local Kanban no es principalmente una aplicación web. Es una metodología de trabajo para que un agente orquestador de Codex descomponga, priorice, delegue, supervise, verifique e integre trabajo ejecutado por especialistas durante proyectos largos.

Los usuarios del sistema son:

- El **orquestador**, responsable del flujo global.
- Los **especialistas**, responsables de historias concretas end to end.
- El **verificador**, utilizado únicamente para trabajo de riesgo alto.
- El **humano**, responsable de decisiones, excepciones y gates explícitos.

La UI es un plano de observación y control. Los agentes deben poder ejecutar toda la metodología con la UI apagada.

## 2. Principios no negociables

1. **Simplicidad:** cada concepto, estado, documento o comando debe justificar su existencia.
2. **Eficiencia de tokens:** el contexto consumido debe crecer con la historia activa, no con el tamaño del proyecto.
3. **Atención persistente:** la skill recuerda al agente el estado, gates, restricciones y siguiente acción sin repetir el contrato completo.
4. **Skill como entrada única:** toda operación agéntica se realiza mediante `$local-kanban`.
5. **Robustez invisible:** concurrencia, revisiones, leases y auditoría se resuelven internamente y no contaminan el contexto normal.

Una mejora se rechaza o difiere si añade más coste operativo, documental o de tokens del que elimina.

## 3. Decisiones arquitectónicas

### 3.1 Fuente durable y runtime local

- Los Markdown del proyecto continúan siendo la representación durable, legible y versionable del trabajo.
- Cada proyecto tiene una SQLite operativa en `.local-kanban/runtime.sqlite`.
- `.local-kanban/` está ignorado por Git y nunca se añade al contexto del agente.
- SQLite guarda coordinación efímera: claims, leases, intentos, revisiones, idempotencia y auditoría local.
- Si SQLite se elimina, el Kanban se reconstruye desde Markdown.
- Al reconstruir se pierde el historial operativo local, pero no las historias, épicas ni resultados durables.

```text
TU_PROYECTO/
├── AGENTS.md
├── .gitignore
├── .local-kanban/
│   └── runtime.sqlite        # local, ignorada por Git
└── docs/kanban/
    ├── epics/
    └── stories/
```

### 3.2 Sin daemon obligatorio

El flujo de agentes utiliza una CLI efímera:

```text
$local-kanban
  → CLI local-kanban
  → localizar raíz Git
  → abrir SQLite
  → ejecutar transacción e invariantes
  → escribir Markdown atómicamente
  → devolver cápsula operativa
  → terminar
```

No hay daemon por proyecto ni servicio central obligatorio. El servidor Express solo se mantiene activo cuando se utiliza la UI. CLI y servidor reutilizan el mismo núcleo de dominio.

### 3.3 Skill canónica y sincronización local

La fuente única de la skill vive en este repo:

```text
kanban-local/skills/local-kanban/SKILL.md
```

La instalación personal de Codex es un symlink:

```text
~/.agents/skills/local-kanban
  → /Users/Eduardo/Documents/Dev/kanban-local/skills/local-kanban
```

Reglas:

- `npm run skill:install` crea o repara el enlace de forma idempotente.
- `npm run skill:verify --local` comprueba destino, estructura y versión en el Mac local.
- La CI valida la skill sin exigir que exista el home personal.
- Cambiar el fichero canónico actualiza inmediatamente el target del symlink.
- Una tarea que ya cargó la skill conserva esa versión; una nueva invocación o tarea carga la vigente.
- No existen copias en `~/.codex/skills`, otros repos o marketplaces.

### 3.4 Registro de proyectos

`kanban-local/config/projects.json` continúa siendo el registro central de la UI.

- `$local-kanban init` registra o actualiza el proyecto actual.
- Ejecutar `init` varias veces no crea duplicados.
- La UI muestra solo proyectos registrados.
- No se escanea el disco para descubrir repositorios.
- Los agentes no editan el registro manualmente.

## 4. Experiencia agent-first

### 4.1 Flujo normal

```text
invocar skill
→ reconciliar proyecto
→ obtener siguiente historia
→ claim
→ ejecutar
→ checkpoint cuando aporte valor
→ validar
→ revisar si riesgo high
→ cerrar
→ reevaluar trabajo desbloqueado
```

La skill es la única vía normal de mutación. Los agentes no editan frontmatter, SQLite ni `config/projects.json`.

### 4.2 Cápsula operativa

La skill devuelve una vista compacta con:

- Historia, estado y revisión.
- Owner, intento y lease.
- Objetivo y scope relevante.
- Gates pendientes.
- Restricciones aplicables.
- Contexto imprescindible.
- Siguiente acción.

Después de cada comando se devuelve principalmente el delta, el gate actual y la siguiente acción. Tras compactación, resume o handoff se regenera la cápsula completa.

Los presupuestos de tokens son orientativos. Se elimina repetición, pero nunca contexto necesario, restricciones importantes o evidencia requerida.

### 4.3 Mutaciones mínimas

El agente expresa intención; la CLI genera internamente IDs, timestamps, actor, sesión, intento, idempotency key y correlation ID.

Ejemplos de comandos internos:

```bash
local-kanban init
local-kanban next --json
local-kanban claim STO-123 --json
local-kanban checkpoint STO-123 --json
local-kanban block STO-123 --json
local-kanban validate STO-123 --json
local-kanban complete STO-123 --json
local-kanban doctor
```

La skill ejecuta estos comandos. No se espera que el agente construya payloads extensos ni invoque HTTP directamente.

## 5. Modelo funcional simplificado

### 5.1 Identidad

- Historias: `STO-*`.
- Épicas: `EPI-*`.
- El ID es estable, único dentro del proyecto y coincide con el nombre del Markdown.
- No existe un segundo ID interno para historias o épicas.
- Comandos, eventos, claims e intentos pueden usar ULID internos no visibles normalmente.

### 5.2 Estados

Estado funcional visible:

```text
backlog → developing → testing → done
```

Estado operativo mínimo:

```text
unclaimed → running → waiting → verifying
```

Conceptos derivados:

- `ready` e `isBlocked` son condiciones calculadas.
- `claimed` vive en el lease.
- `failed`, `retryable` y `abandoned` son resultados de un intento.
- Espera humana es `waiting` con bloqueo tipado.
- Cierre operativo equivale a `done`.

### 5.3 Contrato mínimo de historia

Una historia agéntica ready debe contener:

- Título y objetivo observable.
- Scope y no-scope cuando sean necesarios para evitar ambigüedad.
- Criterios de aceptación.
- Dependencias.
- Contexto o referencias imprescindibles.
- Validación esperada.
- Riesgo `standard` o `high`.

Puede contener `rank` entero para imponer orden manual y prioridad `high`, `medium` o `low`. Sin `rank`, la historia se ordena después de las que sí lo tienen; sin prioridad, se asume `medium`. El número de historias desbloqueadas se calcula desde el DAG y el ID resuelve cualquier empate restante.

Branch, worktree, base commit, intento y lease se derivan al claim; no se duplican en el contrato durable.

### 5.4 Dependencias

La primera versión soporta solo:

- `hard`: impide comenzar hasta completarse.
- `related`: relación informativa.

Las dependencias hard deben formar un DAG. Los conflictos de archivos son gates de runtime, no relaciones persistentes adicionales. `blocks` se deriva y no se mantiene como segundo dato editable.

### 5.5 Bloqueos

Un bloqueo contiene únicamente:

- Tipo breve: `human`, `dependency`, `credential`, `environment`, `conflict`, `external` o `technical`.
- Descripción o evidencia mínima.
- Responsable.
- Acción necesaria.
- Condición de reanudación.

Retry, backoff y límite se añaden solo a bloqueos técnicos reintentables.

### 5.6 Checkpoints y handoffs

No existe un documento de contexto adicional por historia. La cápsula se deriva de la historia y SQLite.

Se crea checkpoint únicamente:

- En un hito significativo.
- Antes de una pausa larga.
- Antes de handoff.
- Cuando cambia una decisión o aparece un riesgo relevante.

El checkpoint conserva un resumen compacto, commits, validación ejecutada, trabajo restante y siguiente acción. El detalle histórico se consulta bajo demanda.

## 6. Coordinación

### 6.1 Claim, lease y fencing

- Un claim es atómico y tiene un único ganador.
- Cada intento obtiene un fencing token monotónico.
- Solo el claimant vigente puede mutar la ejecución.
- El lease dura 30 minutos por defecto y es configurable por proyecto.
- Cualquier operación o checkpoint renueva el lease.
- No existe heartbeat explícito.
- La cápsula avisa cuando quedan menos de 5 minutos.
- Un lease expirado pasa a stale, pero no se reasigna hasta confirmar que el subagente o proceso anterior terminó. El orquestador inspecciona además branch, worktree y último checkpoint para recuperar trabajo útil.
- Si no puede demostrar que el ejecutor terminó, mantiene la historia stale y solicita intervención humana; un override humano queda auditado.
- Un agente con fencing token antiguo no puede escribir.

### 6.2 Scheduler

Primero se filtra elegibilidad:

- DoR completa.
- Dependencias hard resueltas.
- Sin claim vigente.
- Capacidad WIP disponible.
- Sin conflicto de worktree.
- Sin gate humano pendiente.

Después se ordena de forma determinista:

1. `rank` explícito.
2. Prioridad `high → medium → low`.
3. Número de historias que desbloquea.
4. ID como desempate estable.

No existe score ponderado. Cambiar `rank` registra el motivo.

### 6.3 Autonomía del orquestador

El orquestador autoasigna y lanza trabajo hasta agotar historias elegibles o capacidad WIP. No pide confirmación para asignaciones rutinarias.

Solo se detiene ante:

- Decisión humana.
- Credencial o acceso externo.
- Cambio material de alcance.
- Riesgo que exige aprobación.
- Conflicto no resoluble.
- Ausencia de trabajo ejecutable.

### 6.4 Aislamiento Git

- Un único especialista escritor puede usar el workspace actual.
- Dos o más especialistas escritores requieren branch y worktree independientes.
- El orquestador crea worktrees antes del lanzamiento.
- Cada intento registra base commit, branch y commits producidos.
- Superficies incompatibles se serializan aunque exista WIP.
- El orquestador integra; los especialistas no integran trabajo ajeno.

### 6.5 Riesgo y revisión

- `standard`: el especialista implementa, se autovalida y entrega en `verifying`.
- `high`: el especialista entrega en `verifying` y exige un verificador independiente.
- Solo el orquestador marca `done`, después de integrar y validar el resultado integrado. Si no hay worktree separado, conserva igualmente esta responsabilidad de cierre.

Riesgo high se aplica a seguridad, autenticación, persistencia, APIs públicas, cambios destructivos o trabajo marcado expresamente. La aprobación humana es un gate separado.

Mapeo de revisión sin añadir estados:

- Esperando review: `waiting` con gate de revisión.
- Cambios solicitados: `running`.
- Validación activa: `verifying`.
- Integrado y validado por el orquestador: `done`.

## 7. Escritura, reconciliación y auditoría

### 7.1 Escritura segura

- Validación de schema antes de mutar.
- Los campos de dominio durables pertenecen a Markdown; claims, leases, intentos y auditoría local pertenecen a SQLite.
- La operación se valida y se registra primero en una transacción SQLite corta como pendiente, incluyendo revisión anterior y payload Markdown objetivo.
- Después se escribe Markdown mediante fichero temporal, `fsync` y rename atómico, y finalmente se marca la operación como completada en SQLite.
- El comando solo confirma éxito después de completar ambos pasos.
- Al arrancar o ejecutar `doctor`, la recuperación compara revisión y hash: si Markdown conserva la versión anterior, aplica el payload objetivo; si ya coincide con el objetivo, solo marca la operación como completada; si no coincide con ninguno, la pone en cuarentena para resolución explícita.
- Eliminar SQLite puede descartar únicamente operaciones que nunca llegaron a confirmarse; Markdown sigue siendo la fuente durable reconstruible.
- Revisión y compare-and-swap.
- Creación exclusiva.
- Idempotencia para retries.
- Conflictos devuelven revisión actual y datos mínimos para resolver.

### 7.2 Edición manual excepcional

El watcher detecta cambios manuales:

- Si la revisión es vigente, el schema es válido, se cumplen invariantes y no hay claim conflictivo, se importa automáticamente como `manual_edit`.
- Si es inválido, obsoleto o conflictivo, queda en cuarentena.
- El estado válido no se sobrescribe.
- La UI muestra diff y acción de resolución.
- Una entidad en cuarentena no bloquea las entidades sanas.

### 7.3 Auditoría mínima

SQLite mantiene append-only mientras exista el runtime:

- Comandos y transiciones.
- Claims y expiraciones.
- Inicio y resultado de intentos.
- Bloqueos, overrides y aprobaciones.
- Evidencias de validación.

No hay caducidad, compactación, snapshots ni replay completo en v1. El historial no entra en contexto salvo consulta explícita.

## 8. Bucle normativo

### 8.1 Orquestador

1. Reconciliar Markdown, SQLite, Git y claims stale.
2. Resolver o escalar bloqueos.
3. Listar trabajo elegible en orden determinista.
4. Preparar cápsula de contexto.
5. Crear worktree cuando haya escritores concurrentes.
6. Claimar y lanzar hasta el límite WIP.
7. Recibir checkpoints, resultados y handoffs.
8. Enviar trabajo high a verificación independiente.
9. Integrar en orden seguro.
10. Validar el resultado integrado y marcar `done`.
11. Crear historias nuevas para descubrimientos fuera de scope.
12. Repetir mientras exista trabajo ejecutable.

El orquestador no ejecuta trabajo delegable salvo orden o override explícito.

### 8.2 Especialista

1. Recibir una historia reclamada y su cápsula.
2. Verificar objetivo, scope y gates.
3. Ejecutar únicamente la historia asignada.
4. Registrar checkpoint cuando aporte continuidad real.
5. Ejecutar la validación definida.
6. Entregar commits y evidencia.
7. Entregar en `verifying` o `waiting` con bloqueo estructurado; nunca marcar `done`.

## 9. UI humana

### 9.1 Actualización inmediata

Flujo normal:

```text
skill → CLI → núcleo → SQLite + Markdown → watcher/SSE → React
```

Flujo manual excepcional:

```text
edición Markdown → watcher → reconciliación → SQLite → SSE → React
```

Una edición o comando debe aparecer sin `page.reload()` ni intervención humana.

### 9.2 Control de excepciones

La UI prioriza:

- Trabajo ready.
- Claims activos y stale.
- Bloqueos humanos.
- Validaciones o reviews fallidos.
- Conflictos y cuarentenas.
- Proyectos degradados.

Permite pausar, aprobar, reasignar, reintentar y cancelar con auditoría.

### 9.3 Timeline

La historia muestra intentos, transiciones, commits, evidencias y decisiones. Timeline y diff se cargan bajo demanda para no afectar al flujo normal de agentes.

## 10. Mejoras aprobadas

### P0 — Integridad

#### AK-001 — Schema canónico

- JSON Schema versionado para proyecto, épica, historia, bloqueo, criterio y evidencia.
- Validación estricta; no coerción silenciosa.
- Actualizar ejemplos y fixtures actuales. No existe migración histórica en v1.
- Conservar `schema_version` para upgrades futuros.

#### AK-002 — Confinamiento filesystem

- Validar IDs, roots, `docsPath`, symlinks y límites de tamaño.
- Ninguna operación puede escapar del proyecto registrado.
- Un proyecto inseguro se aísla sin derribar los demás.

#### AK-003 — Atomicidad y concurrencia

- SQLite WAL, journal mínimo de operaciones pendientes, revisiones, CAS, escritura atómica e idempotencia.
- Recuperación determinista completa la escritura Markdown o pone una divergencia en cuarentena.
- Dos writers concurrentes producen ganador y conflicto, nunca pérdida silenciosa.

#### AK-004 — Núcleo de dominio

- Extraer reglas fuera del monolito Express.
- Skill, CLI, servidor y UI invocan las mismas invariantes.
- JavaScript, JSON Schema y JSDoc selectivo; sin migración a TypeScript.

#### AK-005 — Estados mínimos

- Cuatro estados funcionales y cuatro operativos.
- El resto se deriva o pertenece a intentos, leases y bloqueos.

### P1 — Coordinación

#### AK-006 — Claims y leases

- Identidad de agente, sesión, intento, claim, lease y fencing.
- Renovación implícita; timeout de 30 minutos.

#### AK-007 — Scheduler determinista

- Elegibilidad por gates.
- Orden por rank opcional, prioridad con default `medium`, desbloqueos e ID.
- Autonomía por defecto.

#### AK-008 — Contrato de historia

- Objetivo, scope necesario, aceptación, dependencias, contexto, validación y riesgo.
- Rank y prioridad son durables pero opcionales, con defaults deterministas.
- DoR y DoD ejecutables.

#### AK-009 — DAG mínimo

- Relaciones hard y related.
- Detección de ciclos y referencias huérfanas.

#### AK-010 — Bloqueos estructurados

- Tipo, owner, acción y condición de reanudación.
- Retry solo cuando aplica.

#### AK-011 — Cápsulas y handoff

- Sin documentos auxiliares por tarea.
- Cápsula derivada y checkpoint solo en hitos, pausa o relevo.

#### AK-012 — Worktrees

- Obligatorios únicamente para escritores concurrentes.
- Integración propiedad del orquestador.

#### AK-013 — Servicio interno de comandos

- Comandos tipados e idempotentes en el núcleo.
- Skill usa CLI; UI usa adaptador HTTP interno.
- HTTP no es interfaz pública para agentes en v1.

#### AK-014 — Skill y CLI

- `$local-kanban` como entrada única.
- `local-kanban` como ejecutable interno.
- Symlink personal, instalación y verificación idempotentes.

### P2 — Evidencia, recovery y calidad

#### AK-015 — Auditoría mínima

- Append-only local en SQLite.
- Sin event sourcing ni políticas de retención en v1.

#### AK-016 — Evidencia y revisión

- Evidencia vinculada a historia, intento y commit.
- Review independiente solo para riesgo high.

#### AK-017 — Reconciliación y doctor

- Cuarentena por entidad.
- Watchers recuperables.
- `local-kanban doctor` valida schema, DAG, permisos, symlink, SQLite y sincronización.

#### AK-018 — Medir antes de optimizar

- Fixture de proyecto largo y benchmark reproducible.
- Optimizar lectura o streaming solo si el benchmark demuestra necesidad.
- Consultas para agentes siempre compactas.

#### AK-019 — Observabilidad mínima

- Logs estructurados con IDs de correlación internos.
- Estado healthy/degraded y diagnóstico accionable.
- Métricas básicas: tiempo, bloqueos, retries, expiraciones y conflictos.

#### AK-020 — Tests por capas

- Unitarios del dominio y schemas.
- Integración de SQLite, filesystem, CAS y watchers.
- Concurrencia, traversal, crash durante escritura y SSE real.
- E2E del flujo de agente y de la UI.

#### AK-021 — Evaluaciones agénticas

- Escenarios deterministas para claim concurrente, lease expirado, cierre inválido, handoff, bloqueo humano y conflicto Git.
- Fallar una invariante crítica bloquea el release.

#### AK-022 — Instalación y upgrades

- `local-kanban init`, `doctor`, `validate` y `skill:install` idempotentes.
- Primera versión: Codex en macOS.
- Sin framework de migraciones hasta que exista un schema publicado que migrar.

#### AK-023 — Versionado de skill

- Skill y contrato versionados en este repo.
- Symlink local sin copias divergentes.
- Verificación local obligatoria en el flujo de versionado/release.

#### AK-024 — CI

- JavaScript static checks, schemas, unitarios, integración, build y E2E.
- Tests de instalación limpia y skill.
- macOS y versiones Node soportadas.
- Security audit y secret scanning.

### P3 — Control humano

#### AK-025 — Vista operativa

- Ready, running, stale, waiting, verifying, conflictos y degradación.
- Acciones administrativas auditadas.

#### AK-026 — Timeline y diff

- Intentos, commits, evidencias y cambios bajo demanda.
- Deep links estables para proyecto, historia e intento.

## 11. Alcance de la primera versión

### Incluido

- Codex en macOS.
- Skill canónica por symlink.
- CLI efímera.
- Markdown durable y SQLite operativa por proyecto.
- Núcleo JS con schemas e invariantes.
- Claims, leases, scheduler, cápsulas y bloqueos.
- Worktrees para concurrencia.
- Evidencia standard/high.
- Reconciliación, doctor y auditoría mínima.
- UI actualizada en directo y vista básica de excepciones.
- Tests de dominio, concurrencia, seguridad, agent flow y UI.

### Diferido

- MCP, Claude Code, Cursor u otros runtimes.
- Linux y Windows.
- TypeScript.
- API pública agent-first.
- Event sourcing, replay, snapshots y compactación.
- Streaming incremental complejo, índices o caché sin benchmark.
- Métricas avanzadas, alertas externas y observabilidad distribuida.
- Migraciones hasta que exista una versión publicada que migrar.

## 12. Secuencia de implementación

### Fase 0 — Integridad y núcleo

- AK-001 a AK-005.
- SQLite por proyecto.
- Escritura atómica y reconciliación básica.
- Tests negativos de invariantes y seguridad.

**Gate:** no existe corrupción, traversal, pérdida silenciosa ni cierre inválido.

### Fase 1 — Skill y coordinación

- AK-006 a AK-014.
- Rename de `skills/local-kanban-agent` a `skills/local-kanban`.
- Symlink, CLI, claims, leases, scheduler, cápsulas y worktrees.

**Gate:** el orquestador ejecuta autónomamente trabajo paralelo seguro sin UI.

### Fase 2 — Evidencia y recovery

- AK-015 a AK-019.
- Auditoría mínima, review high, doctor, cuarentena y UI live.

**Gate:** cada resultado es verificable y los fallos se aíslan y recuperan.

### Fase 3 — Calidad y distribución local

- AK-020 a AK-024.
- Evaluaciones agénticas, instalación limpia, CI y versionado.

**Gate:** un repo nuevo puede adoptar la metodología y pasar sus escenarios críticos de forma reproducible.

### Fase 4 — Control humano

- AK-025 y AK-026.

**Gate:** el humano gobierna excepciones sin editar SQLite o JSON manualmente.

## 13. Registro de decisiones cerradas

| ID | Decisión |
|---|---|
| DEC-001 | Markdown durable + SQLite operativa por proyecto |
| DEC-002 | Solo IDs humanos para historias y épicas |
| DEC-003 | Cuatro estados funcionales + cuatro operativos |
| DEC-004 | Orquestador autónomo hasta agotar trabajo elegible |
| DEC-005 | Lease de 30 minutos renovado por actividad |
| DEC-006 | Review independiente solo para riesgo high |
| DEC-007 | Primera versión Codex-only |
| DEC-008 | Mantener JavaScript |
| DEC-009 | Primera versión macOS-only |
| DEC-010 | Worktrees obligatorios solo para escritores concurrentes |
| DEC-011 | Skill canónica en este repo y symlink personal |
| DEC-012 | CLI efímera; servidor solo para UI |
| DEC-013 | Registro central explícito en `config/projects.json` |
| DEC-014 | Auditoría local sin caducidad ni compactación |
| DEC-015 | Ejecutable `local-kanban`; skill `$local-kanban` |

## 14. Condiciones globales de terminado

El sistema se considerará preparado cuando:

- Ninguna mutación pueda perder o corromper trabajo silenciosamente.
- Ninguna superficie pueda saltarse las invariantes.
- Toda ejecución activa tenga claim, lease, intento y fencing válidos.
- El orquestador encuentre y lance trabajo de forma determinista.
- Un agente reciba contexto suficiente sin leer el tablero completo.
- Otro agente pueda reanudar desde la cápsula y el último checkpoint.
- Todo cierre tenga evidencia vigente y ligada al commit.
- La UI refleje comandos y ediciones manuales válidas sin recarga.
- Un documento defectuoso no derribe el proyecto completo.
- La skill instalada resuelva al fichero canónico de este repo.
- Los escenarios críticos agénticos formen parte del gate de release.

## 15. Riesgos residuales a controlar durante la planificación

- Hacer que SQLite sea demasiado autoritativa y debilitar la portabilidad de Markdown.
- Añadir metadatos operativos a las respuestas del agente sin necesidad.
- Convertir la cápsula en otro documento persistente y duplicado.
- Introducir abstracciones multi-runtime o multi-OS antes de necesitarlas.
- Hacer el scheduler menos predecible mediante heurísticas ocultas.
- Confiar en el watcher como única garantía de sincronización.
- Prometer actualización de una skill dentro de una tarea que ya la cargó.
- Expandir el alcance de las historias durante la ejecución en vez de replanificar.
