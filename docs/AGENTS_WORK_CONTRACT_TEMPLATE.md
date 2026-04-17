# Agent Work Contract Template

Usa este contenido como base para `TU_PROYECTO/AGENTS.md`.

Sustituye `KANBAN_ROOT` por la ruta absoluta real al repositorio `Local Kanban`.

```md
# Agent Work Contract

Este repositorio trabaja bajo el contrato operativo definido por Local Kanban.

Referencia normativa obligatoria:
- `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md`

Importacion de reglas:
- Todas las reglas, obligaciones, restricciones, politicas de ejecucion y criterios de actualizacion definidos en `KANBAN_ROOT/skills/local-kanban-agent/SKILL.md` quedan importados por referencia y forman parte de este contrato de trabajo sin excepciones.
- Si este archivo entra en conflicto con esa skill, prevalece la skill de Local Kanban.
- Ningun agente puede empezar trabajo tecnico, crear historias, mover estados ni cerrar tareas sin cumplir antes ese contrato.
- Mantener el Kanban actualizado durante la ejecucion real del trabajo es obligatorio, no opcional.
- El orquestador solo orquesta: lanza especialistas, aporta contexto minimo suficiente, monitoriza y ayuda a desbloquear. No ejecuta historias delegables salvo orden explicita del usuario.
- El especialista ejecuta la historia asignada end to end con el contexto recibido, la valida y la deja cerrada o bloqueada con causa concreta, evidencia y siguiente accion necesaria.
```

Si el repositorio ya tiene un `AGENTS.md`, no lo reemplaces entero. Inserta estas clausulas y conserva las reglas adicionales del propio repositorio, siempre que no contradigan el contrato de `Local Kanban`.
