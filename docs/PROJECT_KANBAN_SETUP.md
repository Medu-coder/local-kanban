# Preparar un proyecto para Local Kanban

Esta guía explica cómo adoptar la metodología en un repositorio de desarrollo. La semántica normativa vive en la skill canónica `$local-kanban`; este documento conserva únicamente el setup y las comprobaciones útiles para humanos.

## Resultado esperado

```text
TU_PROYECTO/
├── AGENTS.md
├── .gitignore
├── .local-kanban/
│   └── runtime.sqlite       # local, ignorada por Git
└── docs/kanban/
    ├── epics/
    └── stories/
```

Los Markdown son la representación durable y versionable. SQLite conserva coordinación
operativa local; su esquema puede regenerarse, pero su historial no. No debe commitearse ni
editarse manualmente y debe respaldarse si se quieren conservar claims, intentos y auditoría.

## 1. Comprobar la instalación

```bash
local-kanban --help
```

En Codex debe estar disponible `$local-kanban`. Si falta, vuelve al repositorio Local Kanban y ejecuta:

```bash
npm run skill:install
npm run skill:verify
npm link
```

## 2. Inicializar desde la raíz Git

```bash
cd /ruta/al/proyecto
local-kanban init --json
```

Sin `--id` ni `--name`, la CLI deriva ambos de la raíz Git. La respuesta JSON incluye el
comando de diagnóstico que debe ejecutarse a continuación. Los overrides siguen disponibles
cuando el humano necesita una identidad distinta.

El comando:

- localiza la raíz Git;
- registra o actualiza el proyecto de forma idempotente;
- crea `docs/kanban/epics` y `docs/kanban/stories`;
- prepara `.local-kanban/` y su exclusión de Git;
- crea o amplía `AGENTS.md` con la activación de `$local-kanban`.

No hace falta que un agente conozca la ruta del checkout de Local Kanban, edite su registro central ni copie la skill al proyecto consumidor.

## 3. Contrato de `AGENTS.md`

Si el proyecto ya tiene `AGENTS.md`, se conservan sus instrucciones. `local-kanban init`
añade de forma idempotente esta cláusula mínima, que coincide con el contrato generado por
la implementación:

```md
<!-- local-kanban-contract -->
## Local Kanban

- Invocar `$local-kanban` para planificar, reclamar, ejecutar y cerrar trabajo agéntico.
- No editar manualmente `docs/kanban`, `.local-kanban` ni el registro central salvo recuperación excepcional.
- El orquestador es el único rol que integra y marca historias como `done`.
```

La invocación por nombre permite que Codex resuelva la skill personal vigente mediante su symlink; no se añade una referencia absoluta específica de una máquina.
Las reglas operativas completas no se copian al proyecto: se cargan desde la
[skill canónica](../skills/local-kanban/SKILL.md) para evitar contratos divergentes.

## 4. Verificar

```bash
local-kanban validate
local-kanban doctor
```

La inicialización queda correcta cuando:

- el proyecto está registrado una sola vez;
- los documentos cumplen el schema vigente;
- el DAG de dependencias no contiene ciclos ni referencias inválidas;
- el runtime es accesible y está ignorado por Git.

La instalación personal de la skill se verifica por separado, desde el repositorio Local Kanban, con `npm run skill:verify`.

## Reglas para agentes

1. Invocar `$local-kanban` antes de planificar u operar el tablero.
2. Consultar `local-kanban --help` y usar solo comandos anunciados por la versión instalada.
3. Mutar historias, épicas, estados, criterios, bloqueos y ownership exclusivamente mediante la skill y la CLI.
4. No editar directamente Markdown, SQLite, `config/projects.json` ni invocar HTTP como atajo.
5. No inventar comandos o estados cuando una operación todavía no exista; detener la mutación y comunicar el bloqueo.
6. Mantener contexto compacto, pero conservar objetivo, scope, restricciones, gates y evidencia necesarios.
7. El especialista entrega la historia funcional en `testing`; el intento queda operacionalmente
   en `verifying`. Solo el orquestador integra, valida el resultado integrado y marca `done`.

## Reglas durables básicas

- Historias: `STO-*` y fichero `<ID>.md`.
- Épicas: `EPI-*` y fichero `<ID>.md`.
- Estados funcionales: `backlog`, `developing`, `testing`, `done`.
- Dependencias: `hard` o `related`; `blocks` se deriva.
- Riesgo: `standard` o `high`; `high` requiere verificador independiente.
- Tipo de historia: `feature`, `bug`, `tech_debt`, `research` o `chore`; usar `research`
  para un spike exploratorio.
- Modo de ejecución: `human`, `agent` o `hybrid`.
- Una historia ready necesita objetivo observable, criterios de aceptación, dependencias, contexto relevante y validación ejecutable.

Consultar siempre `local-kanban --help` en vez de inferir valores. La CLI falla con
`option_invalid` y `details.allowed` ante un enum no soportado, y con `option_unknown` ante
un flag desconocido; ninguno de esos errores debe crear un Markdown parcial.

El schema versionado es la referencia de formato. No mantengas plantillas copiadas en cada proyecto: deja que la versión instalada de `$local-kanban` genere y valide los documentos.

## Edición manual excepcional

Un humano puede editar un Markdown para recuperación o mantenimiento. Antes de hacerlo debe detener el trabajo concurrente sobre esa entidad y conservar su revisión vigente.

Después:

```bash
local-kanban validate
local-kanban doctor
local-kanban reconcile --json
```

Una edición válida y no conflictiva puede reconciliarse. Una edición obsoleta, inválida,
concurrente o desaparecida queda en cuarentena con causa, impacto y salida concreta. Solo
`revision_divergence` admite aceptar el Markdown actual, siempre con revisión humana y
`--reason`; nunca se fuerza sobrescribiendo SQLite.

## Operación humana útil

- La UI permite observar estados, bloqueos, claims, validaciones y cuarentenas.
- La UI puede gobernar excepciones y aprobaciones con auditoría.
- El registro central puede inspeccionarse manualmente para diagnóstico, pero los agentes lo mantienen mediante `local-kanban init`.
- Si se mueve físicamente el proyecto a otra ruta, vuelve a ejecutar `local-kanban init` desde la nueva raíz y después `doctor`.
