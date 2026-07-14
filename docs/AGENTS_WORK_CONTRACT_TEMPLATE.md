# Plantilla de contrato para AGENTS.md

`local-kanban init` añade esta cláusula de forma idempotente al `AGENTS.md` del proyecto consumidor. Si necesitas incorporarla manualmente, conserva el resto de instrucciones existentes.

```md
<!-- local-kanban-contract -->
## Local Kanban

- Invocar `$local-kanban` para planificar, reclamar, ejecutar y cerrar trabajo agéntico.
- Seguir la metodología y los comandos que anuncie la skill instalada; consultar `local-kanban --help` antes de operar.
- Mutar el Kanban únicamente mediante `$local-kanban`. No editar directamente `docs/kanban`, `.local-kanban`, SQLite, el registro central ni llamar a HTTP como atajo.
- Reservar la edición manual de Markdown para recuperación o mantenimiento excepcional autorizado por el humano; reconciliar y validar después.
- El orquestador delega trabajo elegible, controla concurrencia, integra y es el único rol que marca historias como `done`.
- El especialista trabaja solo sobre la historia reclamada, respeta scope y lease, valida el resultado y entrega en `verifying` o `waiting` con un bloqueo estructurado.
- No ampliar scope silenciosamente, inventar estados ni cerrar sin evidencia vigente ligada al resultado integrado.
- Mantener el contexto mínimo suficiente para reanudar: objetivo, gates, restricciones, progreso, validación, trabajo restante y siguiente acción.
```

Las reglas específicas del proyecto continúan aplicándose. Si parecen incompatibles con la metodología, el agente debe detener la mutación y solicitar una decisión en lugar de elegir una regla silenciosamente.
