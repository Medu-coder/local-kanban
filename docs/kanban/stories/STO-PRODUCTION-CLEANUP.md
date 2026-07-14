---
schema_version: 1
revision: 15
id: STO-PRODUCTION-CLEANUP
type: story
project: kanban-local
title: Auditar y limpiar el repositorio para producción
objective: >-
  Consolidar el repositorio en una única implementación y documentación
  vigentes, sin artefactos de trabajo ni legacy innecesario
scope:
  - documentación
  - artefactos versionados
  - código legacy o no usado
  - configuración de distribución
non_scope: []
epic: EPI-PRODUCTION-READINESS
status: testing
priority: high
risk: high
rank: 1
execution_mode: agent
acceptance_criteria:
  - id: no-quedan-documentos-de-trabajo-u-obsoletos-versio
    label: No quedan documentos de trabajo u obsoletos versionados
    kind: manual
    checked: true
  - id: no-quedan-artefactos-locales-versionados-ni-legacy
    label: No quedan artefactos locales versionados ni legacy sin uso
    kind: manual
    checked: true
  - id: la-documentacion-canonica-describe-con-precision-i
    label: >-
      La documentación canónica describe con precisión instalación operación
      arquitectura y verificación
    kind: manual
    checked: true
  - id: la-suite-completa-de-release-supera-todos-los-gate
    label: La suite completa de release supera todos los gates
    kind: manual
    checked: true
  - id: el-diff-final-no-incluye-cambios-ajenos-no-relacio
    label: El diff final no incluye cambios ajenos no relacionados
    kind: manual
    checked: true
readiness_criteria: []
dependencies: []
context_files:
  - README.md
  - package.json
  - docs
  - src
  - core
  - server
  - scripts
  - skills/local-kanban/SKILL.md
validation:
  commands:
    - 'npm run release:verify'
    - local-kanban doctor --json
subtasks:
  - id: inventariar-documentacion-y-artefactos
    title: Inventariar documentación y artefactos
    done: true
  - id: detectar-referencias-y-codigo-legacy
    title: Detectar referencias y código legacy
    done: true
  - id: aplicar-limpieza-y-consolidacion
    title: Aplicar limpieza y consolidación
    done: true
  - id: actualizar-documentacion-canonica
    title: Actualizar documentación canónica
    done: true
  - id: ejecutar-verificacion-completa
    title: Ejecutar verificación completa
    done: true
  - id: revisar-y-commitear-cambios
    title: Revisar y commitear cambios
    done: true
updated_at: '2026-07-14T11:47:26.327Z'
evidence:
  - id: evidence-4368fb90-c954-478d-a2fc-c2d8a2110ef8
    type: test
    story_id: STO-PRODUCTION-CLEANUP
    attempt_id: f1cd807e-3d24-4ed7-96c5-c852b8817e16
    commit: a46e90bd29cda63adac1c48e378c20f4e352aae7
    command: 'npm run release:verify'
    exit_code: 0
    summary: Gate completo de producción superado
    recorded_at: '2026-07-14T11:47:26.311Z'
    actor: codex-root
  - id: evidence-08eb3587-223f-4ebb-b926-f8c734ac3cc4
    type: test
    story_id: STO-PRODUCTION-CLEANUP
    attempt_id: f1cd807e-3d24-4ed7-96c5-c852b8817e16
    commit: a46e90bd29cda63adac1c48e378c20f4e352aae7
    command: local-kanban doctor --json
    exit_code: 0
    summary: Gate completo de producción superado
    recorded_at: '2026-07-14T11:47:26.311Z'
    actor: codex-root
---

