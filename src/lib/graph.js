const storyStatusWeights = {
  backlog: 0.16,
  developing: 0.42,
  testing: 0.72,
  done: 1,
  missing: 0,
};

const storyStatusOrder = {
  backlog: 0,
  developing: 1,
  testing: 2,
  done: 3,
  missing: 4,
};

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function ratio(progress) {
  if (!progress || !progress.total) {
    return 0;
  }

  return progress.completed / progress.total;
}

function createEpicPosition(index, total, width, height) {
  const safeTotal = Math.max(total, 1);
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(safeTotal))));
  const rows = Math.max(1, Math.ceil(safeTotal / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const horizontalGap = Math.min(360, Math.max(240, width / (columns + 0.45)));
  const verticalGap = Math.min(320, Math.max(250, height / (rows + 0.65)));
  const rowCount = Math.min(columns, safeTotal - row * columns);
  const startX = width / 2 - ((rowCount - 1) * horizontalGap) / 2;
  const rowOffset = rows > 1 ? row - (rows - 1) / 2 : 0;
  const columnCurve = rowCount > 1 ? (column - (rowCount - 1) / 2) / rowCount : 0;

  return {
    x: startX + column * horizontalGap,
    y: height * 0.3 + row * verticalGap + Math.abs(columnCurve) * 28 + rowOffset * 8,
  };
}

function densityLayoutFactor(density = "compact") {
  switch (density) {
    case "comfortable":
      return 1;
    case "dense":
      return 0.84;
    case "compact":
    default:
      return 0.92;
  }
}

function compareStoriesForLayout(a, b) {
  const statusDelta = (storyStatusOrder[a.status] ?? 99) - (storyStatusOrder[b.status] ?? 99);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  const priorityDelta = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return (a.title ?? a.id).localeCompare(b.title ?? b.id, "es", { sensitivity: "base" });
}

function createStoryPosition(story, storyIndex, laneIndex, laneCount, anchor, densityFactor) {
  const laneGapX = 124 * densityFactor;
  const rowGapY = 108 * densityFactor;
  const row = Math.floor(storyIndex / 2);
  const columnInRow = storyIndex % 2;
  const laneOffset = laneIndex - (laneCount - 1) / 2;
  const rowOffset = row - 0.35;
  const sideOffset = (columnInRow === 0 ? -28 : 28) * densityFactor;
  const statusDriftX = (laneIndex === 0 ? -20 : laneIndex === laneCount - 1 ? 20 : 0) * densityFactor;
  const statusDriftY = (storyStatusOrder[story.status] ?? 0) * 6 * densityFactor;

  return {
    x: anchor.x + laneOffset * laneGapX + sideOffset + statusDriftX,
    y: anchor.y + 118 * densityFactor + rowOffset * rowGapY + columnInRow * (12 * densityFactor) + statusDriftY,
  };
}

function deriveStoryProgress(story) {
  const base = storyStatusWeights[story.status] ?? 0.16;
  const subtasksTotal = Array.isArray(story.subtasks) ? story.subtasks.length : 0;
  const subtasksDone = subtasksTotal
    ? story.subtasks.filter((subtask) => typeof subtask === "object" && subtask.done).length / subtasksTotal
    : 0;
  const readyRatio = ratio(story.readyCriteriaProgress);
  const doneRatio = ratio(story.doneCriteriaProgress);

  return clamp(base * 0.55 + subtasksDone * 0.2 + readyRatio * 0.1 + doneRatio * 0.15);
}

function buildEpicNode(epic, stories, position, densityFactor) {
  const aggregate = stories.reduce((acc, story) => acc + deriveStoryProgress(story), 0);
  const progress = stories.length ? aggregate / stories.length : 0;

  return {
    id: `epic:${epic.id}`,
    entityId: epic.id,
    kind: "epic",
    label: epic.title,
    description: epic.description,
    progress,
    storyCount: stories.length,
    radius: Math.round((42 + progress * 22) * densityFactor),
    x: position.x,
    y: position.y,
  };
}

function buildStoryNode(story, position, densityFactor) {
  const progress = deriveStoryProgress(story);

  return {
    id: `story:${story.id}`,
    entityId: story.id,
    kind: "story",
    label: story.title,
    status: story.status,
    progress,
    epicId: story.epicId ?? "__no_epic__",
    radius: Math.round((18 + progress * 14) * densityFactor),
    x: position.x,
    y: position.y,
  };
}

function createEdgeId(kind, source, target) {
  return `${kind}:${source}->${target}`;
}

export function buildStoryGraph(project, options = {}) {
  const { density = "compact", showRelated = true, width = 1280, height = 760 } = options;
  const densityFactor = densityLayoutFactor(density);
  const visibleStories = project?.stories ?? [];
  const storyMap = new Map(visibleStories.map((story) => [story.id, story]));
  const storiesByEpic = visibleStories.reduce((acc, story) => {
    const key = story.epicId ?? "__no_epic__";
    if (!acc.has(key)) {
      acc.set(key, []);
    }

    acc.get(key).push(story);
    return acc;
  }, new Map());

  const nodes = [];
  const edges = [];
  const seenEdges = new Set();
  const epicEntries = [];

  for (const epic of project?.epics ?? []) {
    const stories = storiesByEpic.get(epic.id) ?? [];
    if (!stories.length) {
      continue;
    }

    epicEntries.push({ epic, stories });
  }

  if (storiesByEpic.get("__no_epic__")?.length) {
    epicEntries.push({
      epic: {
        id: "__no_epic__",
        title: "Sin épica",
        description: "Historias no asociadas a ninguna épica.",
      },
      stories: storiesByEpic.get("__no_epic__"),
    });
  }

  const epicNodes = [];
  const epicAnchors = new Map();
  const storyPositions = new Map();
  for (const [index, entry] of epicEntries.entries()) {
    const position = createEpicPosition(index, epicEntries.length, width, height);
    const node = buildEpicNode(entry.epic, entry.stories, position, densityFactor);
    epicNodes.push(node);
    epicAnchors.set(entry.epic.id, position);
    nodes.push(node);

    const storiesByStatus = new Map();
    for (const story of [...entry.stories].sort(compareStoriesForLayout)) {
      const key = story.status ?? "backlog";
      if (!storiesByStatus.has(key)) {
        storiesByStatus.set(key, []);
      }

      storiesByStatus.get(key).push(story);
    }

    const laneKeys = ["backlog", "developing", "testing", "done"].filter((key) => storiesByStatus.has(key));
    if (storiesByStatus.has("missing")) {
      laneKeys.push("missing");
    }

    laneKeys.forEach((laneKey, laneIndex) => {
      const laneStories = storiesByStatus.get(laneKey) ?? [];
      laneStories.forEach((story, storyIndex) => {
        storyPositions.set(
          story.id,
          createStoryPosition(story, storyIndex, laneIndex, laneKeys.length, position, densityFactor)
        );
      });
    });
  }

  for (const story of visibleStories) {
    const epicAnchor = epicAnchors.get(story.epicId ?? "__no_epic__") ?? {
      x: width / 2,
      y: height / 2,
    };
    const node = buildStoryNode(story, storyPositions.get(story.id) ?? epicAnchor, densityFactor);
    nodes.push(node);

    const epicNodeId = `epic:${story.epicId ?? "__no_epic__"}`;
    const membershipId = createEdgeId("epic", epicNodeId, node.id);
    if (!seenEdges.has(membershipId)) {
      edges.push({
        id: membershipId,
        kind: "epic",
        source: epicNodeId,
        target: node.id,
      });
      seenEdges.add(membershipId);
    }
  }

  for (const story of visibleStories) {
    for (const dependencyId of story.blockedBy ?? []) {
      if (!storyMap.has(dependencyId)) {
        continue;
      }

      const edgeId = createEdgeId("blocked_by", `story:${dependencyId}`, `story:${story.id}`);
      if (!seenEdges.has(edgeId)) {
        edges.push({
          id: edgeId,
          kind: "blocked_by",
          source: `story:${dependencyId}`,
          target: `story:${story.id}`,
        });
        seenEdges.add(edgeId);
      }
    }

    for (const blockerId of story.blocks ?? []) {
      if (!storyMap.has(blockerId)) {
        continue;
      }

      const edgeId = createEdgeId("blocks", `story:${story.id}`, `story:${blockerId}`);
      if (!seenEdges.has(edgeId)) {
        edges.push({
          id: edgeId,
          kind: "blocks",
          source: `story:${story.id}`,
          target: `story:${blockerId}`,
        });
        seenEdges.add(edgeId);
      }
    }

    if (showRelated) {
      for (const relatedId of story.relatedTo ?? []) {
        if (!storyMap.has(relatedId)) {
          continue;
        }

        const sourceId = `story:${story.id}`;
        const targetId = `story:${relatedId}`;
        const [first, second] = [sourceId, targetId].sort();
        const edgeId = createEdgeId("related_to", first, second);
        if (!seenEdges.has(edgeId)) {
          edges.push({
            id: edgeId,
            kind: "related_to",
            source: first,
            target: second,
          });
          seenEdges.add(edgeId);
        }
      }
    }
  }

  return {
    nodes,
    edges,
    stats: {
      stories: visibleStories.length,
      epics: epicNodes.length,
      relations: edges.filter((edge) => edge.kind !== "epic").length,
    },
  };
}
