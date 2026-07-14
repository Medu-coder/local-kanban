import { evaluateCriterion } from "./story.js";

const priorityOrder = Object.freeze({ high: 0, medium: 1, low: 2 });

function hardDependencies(story) {
  return (story.dependencies ?? []).filter((dependency) => dependency.type === "hard");
}

function readinessSatisfied(story, storiesById) {
  if ((story.blockers ?? []).length > 0) {
    return false;
  }
  if (
    hardDependencies(story).some(
      (dependency) => storiesById.get(dependency.story_id)?.status !== "done",
    )
  ) {
    return false;
  }
  const dependencyStatuses = Object.fromEntries(
    hardDependencies(story).map((dependency) => [
      dependency.story_id,
      storiesById.get(dependency.story_id)?.status,
    ]),
  );
  return (story.readiness_criteria ?? []).every((criterion) =>
    evaluateCriterion(criterion, story, dependencyStatuses),
  );
}

export function scheduleStories(stories, options = {}) {
  const storiesById = new Map(stories.map((story) => [story.id, story]));
  const claimed = new Set(options.claimedStoryIds ?? []);
  const conflicts = new Set(options.conflictingStoryIds ?? []);
  const capacity = Math.max(0, (options.wipLimit ?? Number.POSITIVE_INFINITY) - (options.activeCount ?? 0));

  const unlockCount = new Map(stories.map((story) => [story.id, 0]));
  for (const candidate of stories) {
    if (candidate.status === "done") {
      continue;
    }
    const dependencies = hardDependencies(candidate);
    for (const dependency of dependencies) {
      const otherDependenciesDone = dependencies.every(
        (other) =>
          other.story_id === dependency.story_id ||
          storiesById.get(other.story_id)?.status === "done",
      );
      if (otherDependenciesDone) {
        unlockCount.set(dependency.story_id, (unlockCount.get(dependency.story_id) ?? 0) + 1);
      }
    }
  }

  return stories
    .filter((story) => {
      if (story.status !== "backlog") {
        return false;
      }
      if (!["agent", "hybrid"].includes(story.execution_mode ?? "human")) {
        return false;
      }
      if (claimed.has(story.id) || conflicts.has(story.id)) {
        return false;
      }
      return readinessSatisfied(story, storiesById);
    })
    .map((story) => ({ story, unlockCount: unlockCount.get(story.id) ?? 0 }))
    .sort((left, right) => {
      const rank = (left.story.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.story.rank ?? Number.MAX_SAFE_INTEGER);
      if (rank !== 0) {
        return rank;
      }
      const priority = (priorityOrder[left.story.priority] ?? 1) -
        (priorityOrder[right.story.priority] ?? 1);
      if (priority !== 0) {
        return priority;
      }
      if (left.unlockCount !== right.unlockCount) {
        return right.unlockCount - left.unlockCount;
      }
      return left.story.id.localeCompare(right.story.id);
    })
    .slice(0, capacity)
    .map(({ story, unlockCount: count }) => ({
      story,
      unlockCount: count,
      whyReady: "ready, unclaimed, compatible con WIP",
    }));
}

export function buildOperationalCapsule({ story, coordination, gates = {}, nextAction = null }) {
  const claim = coordination?.claim ?? null;
  const attempt = coordination?.attempt ?? null;
  const checkpoint = coordination?.checkpoint ?? null;
  const blocks = coordination?.blocks ?? [];
  const operationalBlockTypes = blocks.map((block) => block.type);
  const effectiveGates = {
    ...gates,
    activeBlockers: [...new Set([...(gates.activeBlockers ?? []), ...operationalBlockTypes])],
    ...(Object.hasOwn(gates, "isReady") ? { isReady: gates.isReady && blocks.length === 0 } : {}),
    ...(Object.hasOwn(gates, "isDone") ? { isDone: gates.isDone && blocks.length === 0 } : {}),
  };
  const guidance = deriveOperationalGuidance({
    story,
    coordination,
    gates: effectiveGates,
    requestedAction: nextAction,
  });
  return {
    story: {
      id: story.id,
      title: story.title,
      status: story.status,
      revision: story.revision,
      priority: story.priority,
      risk: story.risk,
      executionMode: story.execution_mode ?? "human",
    },
    execution: {
      operationalStatus: coordination?.operationalStatus ?? "unclaimed",
      claimStatus: claim?.status ?? null,
      agentId: claim?.agentId ?? null,
      attemptId: attempt?.id ?? null,
      fencingToken: claim?.fencingToken ?? null,
      leaseExpiresAt: claim?.leaseExpiresAt ?? null,
    },
    objective: story.objective,
    scope: story.scope ?? [],
    nonScope: story.non_scope ?? [],
    contextFiles: story.context_files ?? [],
    validation: story.validation?.commands ?? [],
    dependencies: story.dependencies ?? [],
    readinessCriteria: story.readiness_criteria ?? [],
    acceptanceCriteria: story.acceptance_criteria ?? [],
    subtasks: story.subtasks ?? [],
    gates: effectiveGates,
    blocks: blocks.map((block) => ({
      id: block.id,
      type: block.type,
      description: block.description,
      owner: block.owner,
      action: block.action,
      resumeCondition: block.resumeCondition,
      evidence: block.evidence ?? null,
    })),
    checkpoint: checkpoint
      ? {
          summary: checkpoint.summary,
          nextAction: checkpoint.payload?.nextAction ?? null,
          files: checkpoint.payload?.files ?? [],
          tests: checkpoint.payload?.tests ?? [],
          createdAt: checkpoint.createdAt,
        }
      : null,
    nextAction: guidance.summary,
    guidance,
  };
}

export function deriveOperationalGuidance({ story, coordination, gates = {}, requestedAction = null }) {
  const claim = coordination?.claim ?? null;
  const blocks = coordination?.blocks ?? [];
  if (requestedAction) {
    return {
      summary: requestedAction,
      command: requestedAction.startsWith("local-kanban ") ? requestedAction : null,
      why: "Acción indicada por el flujo que construyó la cápsula.",
      authority: story.status === "testing" ? "orchestrator" : "specialist",
      canProceed: blocks.length === 0 && claim?.status !== "stale",
    };
  }
  if (claim?.status === "stale") {
    return {
      summary: `Reconciliar y liberar el claim expirado de ${story.id}.`,
      command: `local-kanban show ${story.id} --json`,
      why: "El fencing expirado impide continuar o reasignar con seguridad.",
      authority: "orchestrator",
      canProceed: false,
    };
  }
  if (blocks.length > 0) {
    return {
      summary: blocks[0].action,
      command: `local-kanban show ${story.id} --json`,
      why: blocks[0].resumeCondition,
      authority: blocks[0].owner,
      canProceed: false,
    };
  }
  if (claim) {
    return {
      summary: story.status === "testing"
        ? (story.risk === "high" ? "Liberar el claim antes de una revisión independiente." : "Completar la verificación integrada.")
        : "Continuar el intento activo desde su último checkpoint.",
      command: `local-kanban show ${story.id} --json`,
      why: "Existe un attempt y fencing token vigentes.",
      authority: story.status === "testing" ? "orchestrator" : "specialist",
      canProceed: true,
    };
  }
  if (story.status === "done") {
    return {
      summary: "Historia cerrada; reevaluar el trabajo desbloqueado.",
      command: "local-kanban next --json",
      why: "No queda ejecución pendiente en esta historia.",
      authority: "orchestrator",
      canProceed: true,
    };
  }
  if (story.status === "testing") {
    const complete = gates.isDone || gates.canComplete;
    return {
      summary: complete
        ? (story.risk === "high" ? "Reclamar como revisor independiente." : "Reclamar como orquestador y completar.")
        : "Resolver los gates de aceptación, subtareas o evidencia antes de completar.",
      command: `local-kanban claim ${story.id} --agent AGENT_ID --json`,
      why: complete ? "La entrega está lista para revisión." : "La Definition of Done todavía no está completa.",
      authority: story.risk === "high" ? "independent-verifier" : "orchestrator",
      canProceed: complete,
    };
  }
  if (story.status === "developing") {
    return {
      summary: `Reclamar ${story.id} para reanudar la implementación.`,
      command: `local-kanban claim ${story.id} --agent AGENT_ID --json`,
      why: "La historia está en desarrollo pero no conserva un claim activo.",
      authority: "specialist",
      canProceed: true,
    };
  }
  const ready = gates.isReady ?? false;
  return {
    summary: ready ? `Reclamar ${story.id}.` : "Completar la Definition of Ready y sus dependencias.",
    command: ready ? `local-kanban claim ${story.id} --agent AGENT_ID --json` : `local-kanban show ${story.id} --json`,
    why: ready ? "La historia está lista, desbloqueada y sin claim." : "Uno o más gates de readiness siguen pendientes.",
    authority: ready ? "specialist" : "orchestrator",
    canProceed: ready,
  };
}
