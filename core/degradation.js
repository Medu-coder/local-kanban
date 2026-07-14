import { evaluateStoryGates } from "./story.js";

const quarantineGuidance = Object.freeze({
  invalid_document: {
    summary: "El documento no cumple el contrato canónico.",
    impact: "La entidad no es fiable y queda excluida de planificación, ejecución y edición.",
    action: "Corrige el fichero señalado, valida el proyecto y repite el diagnóstico.",
    command: "local-kanban validate --json && local-kanban doctor --json",
  },
  revision_divergence: {
    summary: "Markdown y el runtime conservan revisiones diferentes.",
    impact: "No se puede decidir automáticamente qué versión es la correcta; la entidad queda bloqueada.",
    action: "Revisa el documento y la auditoría. Si Markdown es la fuente correcta, acéptalo explícitamente.",
    command: null,
  },
  active_claim: {
    summary: "El documento cambió mientras existía un claim activo.",
    impact: "Aceptar el cambio podría sobrescribir trabajo concurrente; la entidad queda bloqueada.",
    action: "Inspecciona el intento, restaura el documento o libera el claim con un handoff explícito.",
    command: null,
  },
  pending_operation: {
    summary: "Hay una operación durable pendiente sobre la entidad.",
    impact: "Otra mutación podría romper CAS o perder una escritura; la entidad queda bloqueada.",
    action: "Ejecuta doctor para completar recovery y revisa cualquier operación que permanezca en cuarentena.",
    command: "local-kanban doctor --json",
  },
  missing_document: {
    summary: "El runtime conoce la entidad, pero su Markdown ya no existe.",
    impact: "La desaparición no se interpreta como borrado intencionado y el flujo queda bloqueado.",
    action: "Restaura el fichero desde Git o escala su eliminación mediante un procedimiento explícito.",
    command: "git status --short && local-kanban doctor --json",
  },
});

export function explainQuarantine(quarantine) {
  const guidance = quarantineGuidance[quarantine.reason] ?? {
    summary: "La entidad está en cuarentena por una condición no reconocida.",
    impact: "El flujo no puede garantizar una mutación segura y queda bloqueado.",
    action: "Conserva los artefactos, ejecuta doctor y escala el diagnóstico con sus detalles.",
    command: "local-kanban doctor --json",
  };
  const entityId = quarantine.entityId;
  const previewCommand = entityId ? `local-kanban reconcile ${entityId} --json` : guidance.command;
  return {
    id: `quarantine:${quarantine.entityType}:${entityId}`,
    severity: "fail",
    code: quarantine.reason,
    scope: quarantine.entityType,
    entityType: quarantine.entityType,
    entityId,
    summary: guidance.summary,
    cause: quarantine.details?.message ?? guidance.summary,
    impact: guidance.impact,
    action: guidance.action,
    command: guidance.command ?? previewCommand,
    verification: "La entidad desaparece de quarantine y local-kanban doctor devuelve health=healthy.",
    details: quarantine.details ?? {},
    detectedAt: quarantine.detectedAt ?? null,
  };
}

function explainDiagnosticCheck(item) {
  const commandByCheck = {
    schema_dag: "local-kanban validate --json",
    paths: "local-kanban doctor --json",
    sqlite: "local-kanban reconcile --json",
    recovery: "local-kanban doctor --json",
    git: "git status --short && local-kanban doctor --json",
    skill: "npm run skill:install && npm run skill:verify",
  };
  return {
    id: `diagnostic:${item.id}`,
    severity: item.status === "warning" ? "warning" : "fail",
    code: item.id,
    scope: "project",
    summary: item.summary,
    cause: item.summary,
    impact: item.status === "warning"
      ? "El flujo sigue disponible, pero con una garantía reducida que debe quedar visible."
      : "El flujo agéntico no debe continuar hasta resolver esta condición.",
    action: item.action ?? "Revisa los detalles y repite local-kanban doctor.",
    command: commandByCheck[item.id] ?? "local-kanban doctor --json",
    verification: "local-kanban doctor devuelve este check en estado pass.",
    details: item.details ?? {},
  };
}

export function explainProblemOperation(operation) {
  const entityType = operation.entity_type;
  const entityId = operation.entity_id;
  const pending = operation.status === "pending";
  return {
    id: `operation:${operation.id}`,
    severity: "fail",
    code: pending ? "pending_operation" : "quarantined_operation",
    scope: entityType ?? "project",
    entityType,
    entityId,
    summary: pending
      ? "El runtime conserva una escritura pendiente."
      : "Una escritura durable terminó en cuarentena.",
    cause: operation.error ?? (pending
      ? "La operación no alcanzó un estado terminal antes de la última lectura."
      : "Recovery no pudo completar la operación de forma segura."),
    impact: "Nuevas mutaciones podrían perder datos o romper el control de concurrencia.",
    action: "Ejecuta recovery con doctor y revisa el resultado antes de continuar.",
    command: "local-kanban doctor --json",
    verification: "La operación deja de figurar como pending/quarantined y doctor devuelve healthy.",
    details: {
      operationId: operation.id,
      status: operation.status,
      createdAt: operation.created_at,
    },
  };
}

export function explainDoneGate(story, gates = evaluateStoryGates(story)) {
  if (story.status !== "done" || gates.isDone) {
    return null;
  }
  return {
    id: `done-gate:${story.id}`,
    severity: "fail",
    code: "done_gate_incomplete",
    scope: "story",
    entityType: "story",
    entityId: story.id,
    summary: "La historia figura como done sin satisfacer su gate canónico.",
    cause: "Falta aceptación, subtareas, dependencias, evidencia válida o revisión independiente.",
    impact: "El cierre no es verificable y bloquea nuevas mutaciones hasta corregir el estado.",
    action: "Reabre la historia en testing y completa los gates sin fabricar evidencia.",
    command: `local-kanban show ${story.id} --json`,
    verification: "show informa gates.isDone=true y doctor vuelve a health=healthy.",
    details: {
      pendingDependencies: gates.pendingDependencies ?? [],
      pendingAcceptance: gates.pendingAcceptance ?? [],
      pendingSubtasks: gates.pendingSubtasks ?? [],
      activeBlockers: gates.activeBlockers ?? [],
      hasEvidence: Boolean(gates.hasEvidence),
      hasIndependentReview: Boolean(gates.hasIndependentReview),
      risk: story.risk,
    },
  };
}

export function collectDoneGateIssues(stories = []) {
  const statuses = new Map(stories.map((story) => [story.id, story.status]));
  return stories
    .map((story) => explainDoneGate(story, evaluateStoryGates(story, statuses)))
    .filter(Boolean);
}

export function degradationEnvelope({ health, checks = [], quarantines = [], issues = [] }) {
  const allIssues = [
    ...issues,
    ...checks.filter((item) => item.status !== "pass").map(explainDiagnosticCheck),
    ...quarantines.map(explainQuarantine),
  ];
  return {
    health,
    canProceed: !allIssues.some((item) => item.severity === "fail"),
    issueCount: allIssues.length,
    issues: allIssues,
    nextAction: allIssues[0]?.action ?? "Continuar con el flujo canónico.",
    verification: health === "healthy"
      ? "No hay degradaciones activas."
      : "Resuelve cada issue y confirma local-kanban doctor health=healthy.",
  };
}
