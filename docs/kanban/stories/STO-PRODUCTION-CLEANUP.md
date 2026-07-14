---
schema_version: 1
revision: 2
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
status: developing
priority: high
risk: high
rank: 1
execution_mode: agent
acceptance_criteria:
  - id: no-quedan-documentos-de-trabajo-u-obsoletos-versio
    label: No quedan documentos de trabajo u obsoletos versionados
    kind: manual
    checked: false
  - id: no-quedan-artefactos-locales-versionados-ni-legacy
    label: No quedan artefactos locales versionados ni legacy sin uso
    kind: manual
    checked: false
  - id: la-documentacion-canonica-describe-con-precision-i
    label: >-
      La documentación canónica describe con precisión instalación operación
      arquitectura y verificación
    kind: manual
    checked: false
  - id: la-suite-completa-de-release-supera-todos-los-gate
    label: La suite completa de release supera todos los gates
    kind: manual
    checked: false
  - id: el-diff-final-no-incluye-cambios-ajenos-no-relacio
    label: El diff final no incluye cambios ajenos no relacionados
    kind: manual
    checked: false
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
    done: false
  - id: detectar-referencias-y-codigo-legacy
    title: Detectar referencias y código legacy
    done: false
  - id: aplicar-limpieza-y-consolidacion
    title: Aplicar limpieza y consolidación
    done: false
  - id: actualizar-documentacion-canonica
    title: Actualizar documentación canónica
    done: false
  - id: ejecutar-verificacion-completa
    title: Ejecutar verificación completa
    done: false
  - id: revisar-y-commitear-cambios
    title: Revisar y commitear cambios
    done: false
updated_at: '2026-07-14T11:32:51.847Z'
---

