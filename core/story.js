import { DomainError } from "./errors.js";
import { validateStory } from "./schema.js";

const allowedTransitions = Object.freeze({
  backlog: new Set(["backlog", "developing"]),
  developing: new Set(["backlog", "developing", "testing"]),
  testing: new Set(["developing", "testing", "done"]),
  done: new Set(["testing", "done"]),
});

function dependencyStatus(dependencyStatuses, storyId) {
  if (dependencyStatuses instanceof Map) {
    return dependencyStatuses.get(storyId);
  }
  return dependencyStatuses?.[storyId];
}

export function evaluateCriterion(criterion, story, dependencyStatuses = {}) {
  if (criterion.kind === "manual") {
    return criterion.checked === true;
  }

  switch (criterion.rule) {
    case "dependencies_done":
      return story.dependencies
        .filter((dependency) => dependency.type === "hard")
        .every((dependency) => dependencyStatus(dependencyStatuses, dependency.story_id) === "done");
    case "all_subtasks_done":
      return (story.subtasks?.length ?? 0) > 0 && story.subtasks.every((subtask) => subtask.done);
    case "has_assignee":
      return Boolean(story.assignee || story.agent_owner);
    case "has_agent_owner":
      return Boolean(story.agent_owner);
    case "has_context_files":
      return story.context_files.length > 0;
    case "story_in_testing":
      return story.status === "testing" || story.status === "done";
    default:
      return false;
  }
}

export function evaluateStoryGates(story, dependencyStatuses = {}) {
  const hardDependencies = story.dependencies.filter((dependency) => dependency.type === "hard");
  const pendingDependencies = hardDependencies
    .filter((dependency) => dependencyStatus(dependencyStatuses, dependency.story_id) !== "done")
    .map((dependency) => dependency.story_id);
  const pendingReadiness = (story.readiness_criteria ?? [])
    .filter((criterion) => !evaluateCriterion(criterion, story, dependencyStatuses))
    .map((criterion) => criterion.id);
  const pendingAcceptance = story.acceptance_criteria
    .filter((criterion) => !evaluateCriterion(criterion, story, dependencyStatuses))
    .map((criterion) => criterion.id);
  const pendingSubtasks = (story.subtasks ?? [])
    .filter((subtask) => !subtask.done)
    .map((subtask) => subtask.id);
  const evidence = story.evidence ?? [];
  const validEvidence = evidence.filter(
    (item) => item.story_id === story.id && typeof item.commit === "string" && item.commit.length >= 7,
  );
  const implementationEvidence = validEvidence.filter((item) => item.type !== "review");
  const reviewEvidence = validEvidence.filter((item) => item.type === "review");
  const hasIndependentReview = reviewEvidence.some((review) =>
    implementationEvidence.length > 0 && implementationEvidence.every(
      (implementation) =>
        review.actor !== implementation.actor && review.attempt_id !== implementation.attempt_id,
    ),
  );
  const activeBlockers = (story.blockers ?? []).map((blocker) => blocker.type);

  return {
    pendingDependencies,
    pendingReadiness,
    pendingAcceptance,
    pendingSubtasks,
    activeBlockers,
    hasEvidence: validEvidence.length > 0,
    hasIndependentReview,
    isReady:
      pendingDependencies.length === 0 && pendingReadiness.length === 0 && activeBlockers.length === 0,
    isDone:
      pendingDependencies.length === 0 &&
      pendingAcceptance.length === 0 &&
      pendingSubtasks.length === 0 &&
      activeBlockers.length === 0 &&
      validEvidence.length > 0 &&
      (story.risk !== "high" || hasIndependentReview),
  };
}

export function transitionStory(currentStory, command, dependencyStatuses = {}) {
  validateStory(currentStory);

  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision !== currentStory.revision) {
    throw new DomainError("revision_conflict", "La revisión de la historia ha cambiado.", {
      details: { expected: command.expectedRevision, actual: currentStory.revision },
      status: 409,
    });
  }

  const nextStatus = command.nextStatus ?? currentStory.status;
  if (!allowedTransitions[currentStory.status]?.has(nextStatus)) {
    throw new DomainError("transition_denied", "La transición de estado no está permitida.", {
      details: { from: currentStory.status, to: nextStatus },
      status: 409,
    });
  }

  const candidate = {
    ...currentStory,
    status: nextStatus,
    ...(Object.hasOwn(command, "nextEpic") ? { epic: command.nextEpic } : {}),
    revision: currentStory.revision + 1,
    updated_at: new Date().toISOString(),
  };
  const gates = evaluateStoryGates(candidate, dependencyStatuses);

  if (nextStatus === "developing" && !gates.isReady) {
    throw new DomainError("readiness_incomplete", "La historia no cumple su Definition of Ready.", {
      details: {
        pendingDependencies: gates.pendingDependencies,
        pendingCriteria: gates.pendingReadiness,
        blockers: gates.activeBlockers,
      },
      status: 409,
    });
  }

  if (nextStatus === "done") {
    if (command.actorRole !== "orchestrator") {
      throw new DomainError(
        "orchestrator_required",
        "Solo el orquestador puede marcar una historia como done.",
        { status: 403 },
      );
    }
    if (!gates.isDone) {
      throw new DomainError("completion_incomplete", "La historia no cumple su Definition of Done.", {
        details: {
          pendingDependencies: gates.pendingDependencies,
          pendingCriteria: gates.pendingAcceptance,
          pendingSubtasks: gates.pendingSubtasks,
          blockers: gates.activeBlockers,
          evidenceRequired: !gates.hasEvidence,
          reviewRequired: candidate.risk === "high" && !gates.hasIndependentReview,
        },
        status: 409,
      });
    }
  }

  validateStory(candidate);
  return { story: candidate, gates };
}
