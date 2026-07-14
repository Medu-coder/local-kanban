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
  return {
    story: {
      id: story.id,
      title: story.title,
      status: story.status,
      revision: story.revision,
      priority: story.priority,
      risk: story.risk,
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
    contextFiles: story.context_files ?? [],
    validation: story.validation?.commands ?? [],
    gates: effectiveGates,
    blocks: blocks.map((block) => ({
      type: block.type,
      owner: block.owner,
      action: block.action,
      resumeCondition: block.resumeCondition,
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
    nextAction,
  };
}
