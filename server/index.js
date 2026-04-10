import express from "express";
import fs from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const configPath = process.env.KANBAN_CONFIG_PATH
  ? path.resolve(process.env.KANBAN_CONFIG_PATH)
  : path.join(rootDir, "config", "projects.json");
const statuses = ["backlog", "developing", "testing", "done"];
const priorities = ["low", "medium", "high"];
const executionModes = ["human", "agent", "hybrid"];
const storyTypes = ["feature", "bug", "tech_debt", "research", "chore"];
const criteriaKinds = ["manual", "derived"];
const derivedCriteriaRules = [
  "dependencies_done",
  "all_subtasks_done",
  "has_assignee",
  "has_agent_owner",
  "has_context_files",
  "story_in_testing",
];
const epicProgressWeights = {
  backlog: 0,
  developing: 1,
  testing: 2,
  done: 4,
};
const app = express();

app.use(express.json());

function normalizeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function toSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function coerceSubtasks(subtasks) {
  if (!Array.isArray(subtasks)) {
    return [];
  }

  return subtasks
    .map((subtask) => {
      if (typeof subtask === "string") {
        const title = subtask.trim();
        return title ? { title, done: false } : null;
      }

      if (!subtask || typeof subtask !== "object") {
        return null;
      }

      const title = String(subtask.title ?? "").trim();
      if (!title) {
        return null;
      }

      return {
        title,
        done: Boolean(subtask.done),
      };
    })
    .filter(Boolean);
}

function coerceStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function coerceIsoTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function createCriterionId(label, index) {
  const slug = toSlug(label);
  return slug ? `criterion-${slug}` : `criterion-${index + 1}`;
}

function coerceCriteria(criteria) {
  if (!Array.isArray(criteria)) {
    return [];
  }

  return criteria
    .map((criterion, index) => {
      if (typeof criterion === "string") {
        const label = criterion.trim();
        if (!label) {
          return null;
        }

        return {
          id: createCriterionId(label, index),
          label,
          kind: "manual",
          checked: false,
        };
      }

      if (!criterion || typeof criterion !== "object") {
        return null;
      }

      const label = String(criterion.label ?? "").trim();
      if (!label) {
        return null;
      }

      const kind = criteriaKinds.includes(criterion.kind) ? criterion.kind : "manual";
      const coerced = {
        id: String(criterion.id ?? createCriterionId(label, index)).trim() || createCriterionId(label, index),
        label,
        kind,
      };

      if (kind === "manual") {
        coerced.checked = Boolean(criterion.checked);
      } else {
        coerced.rule = derivedCriteriaRules.includes(criterion.rule) ? criterion.rule : null;
      }

      return coerced;
    })
    .filter(Boolean);
}

function normalizeStoryReference(story) {
  return {
    id: story.id,
    title: story.title,
    status: story.status,
    exists: true,
  };
}

function createMissingStoryReference(storyId) {
  return {
    id: storyId,
    title: storyId,
    status: "missing",
    exists: false,
  };
}

function evaluateDerivedCriterion(rule, story, storyLookup) {
  switch (rule) {
    case "dependencies_done":
      return story.blockedBy.every((storyId) => storyLookup.get(normalizeId(storyId))?.status === "done");
    case "all_subtasks_done":
      return story.subtasks.length > 0 && story.subtasks.every((subtask) => Boolean(subtask.done));
    case "has_assignee":
      return Boolean(story.assignee || story.agentOwner);
    case "has_agent_owner":
      return Boolean(story.agentOwner);
    case "has_context_files":
      return story.contextFiles.length > 0;
    case "story_in_testing":
      return story.status === "testing";
    default:
      return false;
  }
}

function hydrateCriteria(criteria, story, storyLookup) {
  return criteria.map((criterion) => {
    if (criterion.kind === "derived") {
      return {
        ...criterion,
        checked: evaluateDerivedCriterion(criterion.rule, story, storyLookup),
        editable: false,
      };
    }

    return {
      ...criterion,
      checked: Boolean(criterion.checked),
      editable: true,
    };
  });
}

function createCriteriaProgress(criteria, requireAtLeastOne = false) {
  const total = criteria.length;
  const completed = criteria.filter((criterion) => criterion.checked).length;
  const isComplete = requireAtLeastOne ? total > 0 && completed === total : completed === total;

  return {
    total,
    completed,
    isComplete,
  };
}

function enrichStories(project, stories) {
  const storyLookup = new Map(stories.map((story) => [normalizeId(story.id), story]));
  const epicLookup = new Map(project.epics.map((epic) => [normalizeId(epic.id), epic]));

  return stories.map((story) => {
    const blockedByStories = story.blockedBy.map((storyId) => {
      const linked = storyLookup.get(normalizeId(storyId));
      return linked ? normalizeStoryReference(linked) : createMissingStoryReference(storyId);
    });
    const blockingStories = story.blocks.map((storyId) => {
      const linked = storyLookup.get(normalizeId(storyId));
      return linked ? normalizeStoryReference(linked) : createMissingStoryReference(storyId);
    });
    const relatedStories = story.relatedTo.map((storyId) => {
      const linked = storyLookup.get(normalizeId(storyId));
      return linked ? normalizeStoryReference(linked) : createMissingStoryReference(storyId);
    });
    const isBlocked = blockedByStories.some((linkedStory) => !linkedStory.exists || linkedStory.status !== "done");
    const readyCriteria = hydrateCriteria(story.readyCriteria, story, storyLookup);
    const doneCriteria = hydrateCriteria(story.doneCriteria, story, storyLookup);
    const readyCriteriaProgress = createCriteriaProgress(readyCriteria);
    const doneCriteriaProgress = createCriteriaProgress(doneCriteria, true);

    return {
      ...story,
      epicTitle: story.epicId
        ? epicLookup.get(normalizeId(story.epicId))?.title ?? story.epicId
        : "Sin épica",
      blockedByStories,
      blockingStories,
      relatedStories,
      readyCriteria,
      doneCriteria,
      readyCriteriaProgress,
      doneCriteriaProgress,
      isBlocked,
      isReadyForDeveloping: !isBlocked && readyCriteriaProgress.isComplete,
      isDoneValidated: doneCriteriaProgress.isComplete,
    };
  });
}

function sanitizeStoryFrontmatter(payload) {
  return {
    id: payload.id,
    type: "story",
    project: payload.project,
    title: payload.title,
    description: payload.description,
    epic: payload.epic,
    status: payload.status,
    priority: payload.priority,
    assignee: payload.assignee,
    agent_owner: payload.agentOwner,
    execution_mode: payload.executionMode,
    story_type: payload.storyType,
    blocked_by: payload.blockedBy,
    blocks: payload.blocks,
    related_to: payload.relatedTo,
    context_files: payload.contextFiles,
    agent_status_note: payload.agentStatusNote,
    last_agent_update: payload.lastAgentUpdate,
    labels: payload.labels,
    subtasks: payload.subtasks,
    ready_criteria: payload.readyCriteria,
    done_criteria: payload.doneCriteria,
  };
}

function sanitizeStoryPayload(payload, projectId) {
  const title = String(payload.title ?? "").trim();

  if (!title) {
    throw new Error("El titulo es obligatorio.");
  }

  const storyId = String(payload.id ?? "").trim();
  const status = statuses.includes(payload.status) ? payload.status : "backlog";
  const priority = priorities.includes(payload.priority) ? payload.priority : "medium";

  return {
    id: storyId || null,
    type: "story",
    project: projectId,
    title,
    description: String(payload.description ?? "").trim(),
    epic: payload.epicId ? String(payload.epicId).trim() : null,
    status,
    priority,
    assignee: payload.assignee ? String(payload.assignee).trim() : null,
    agentOwner: payload.agentOwner ? String(payload.agentOwner).trim() : null,
    executionMode: executionModes.includes(payload.executionMode) ? payload.executionMode : "human",
    storyType: storyTypes.includes(payload.storyType) ? payload.storyType : "feature",
    blockedBy: coerceStringList(payload.blockedBy),
    blocks: coerceStringList(payload.blocks),
    relatedTo: coerceStringList(payload.relatedTo),
    contextFiles: coerceStringList(payload.contextFiles),
    agentStatusNote: String(payload.agentStatusNote ?? "").trim(),
    lastAgentUpdate: coerceIsoTimestamp(payload.lastAgentUpdate),
    labels: Array.isArray(payload.labels)
      ? payload.labels.map((label) => String(label).trim()).filter(Boolean)
      : [],
    subtasks: coerceSubtasks(payload.subtasks),
    readyCriteria: coerceCriteria(payload.readyCriteria),
    doneCriteria: coerceCriteria(payload.doneCriteria),
    body: String(payload.body ?? "").trim(),
  };
}

function sanitizeEpicPayload(payload, projectId) {
  const title = String(payload.title ?? "").trim();

  if (!title) {
    throw new Error("El titulo de la epica es obligatorio.");
  }

  const epicId = String(payload.id ?? "").trim();

  return {
    id: epicId || null,
    type: "epic",
    project: projectId,
    title,
    description: String(payload.description ?? "").trim(),
    labels: Array.isArray(payload.labels)
      ? payload.labels.map((label) => String(label).trim()).filter(Boolean)
      : [],
    body: String(payload.body ?? "").trim(),
  };
}

async function readMarkdownCollection(baseDir, kind, project) {
  const files = await safeReadDir(baseDir);
  const items = await Promise.all(
    files
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map(async (entry) => {
        const filePath = path.join(baseDir, entry.name);
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = matter(raw);
        const data = parsed.data ?? {};
        const id = data.id ?? entry.name.replace(/\.md$/u, "");

        return {
          id: String(id),
          type: kind,
          title: data.title ?? id,
          description: data.description ?? "",
          projectId: project.id,
          projectName: project.name,
          status: statuses.includes(data.status) ? data.status : "backlog",
          epicId: data.epic ? String(data.epic) : null,
          priority: data.priority ?? "medium",
          assignee: data.assignee ?? null,
          agentOwner: data.agent_owner ?? null,
          executionMode: executionModes.includes(data.execution_mode) ? data.execution_mode : "human",
          storyType: storyTypes.includes(data.story_type) ? data.story_type : "feature",
          blockedBy: coerceStringList(data.blocked_by),
          blocks: coerceStringList(data.blocks),
          relatedTo: coerceStringList(data.related_to),
          contextFiles: coerceStringList(data.context_files),
          agentStatusNote: String(data.agent_status_note ?? "").trim(),
          lastAgentUpdate: coerceIsoTimestamp(data.last_agent_update),
          labels: Array.isArray(data.labels) ? data.labels : [],
          subtasks: coerceSubtasks(data.subtasks),
          readyCriteria: coerceCriteria(data.ready_criteria),
          doneCriteria: coerceCriteria(data.done_criteria),
          body: parsed.content.trim(),
          filePath,
          docsPath: project.docsPath,
          rootPath: project.rootPath,
        };
      })
  );

  return items;
}

async function loadProjects() {
  const config = await readJson(configPath);

  return Promise.all(
    config.map(async (project) => {
      const docsRoot = path.join(project.rootPath, project.docsPath ?? "docs/kanban");
      const epicsDir = path.join(docsRoot, "epics");
      const storiesDir = path.join(docsRoot, "stories");
      const epics = await readMarkdownCollection(epicsDir, "epic", project);
      const stories = await readMarkdownCollection(storiesDir, "story", project);
      const storiesWithEpic = enrichStories({ ...project, epics }, stories);

      const storyCountByEpic = storiesWithEpic.reduce((acc, story) => {
        const key = normalizeId(story.epicId ?? "none");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});

      const statusCountByEpic = storiesWithEpic.reduce((acc, story) => {
        const key = normalizeId(story.epicId ?? "none");
        if (!acc[key]) {
          acc[key] = {
            backlog: 0,
            developing: 0,
            testing: 0,
            done: 0,
          };
        }

        acc[key][story.status] += 1;
        return acc;
      }, {});

      const hydratedEpics = epics.map((epic) => ({
        ...epic,
        storyCount: storyCountByEpic[normalizeId(epic.id)] ?? 0,
        statusCounts: statusCountByEpic[normalizeId(epic.id)] ?? {
          backlog: 0,
          developing: 0,
          testing: 0,
          done: 0,
        },
        doneCount: statusCountByEpic[normalizeId(epic.id)]?.done ?? 0,
        progressScore: ["backlog", "developing", "testing", "done"].reduce(
          (acc, status) =>
            acc +
            (statusCountByEpic[normalizeId(epic.id)]?.[status] ?? 0) * epicProgressWeights[status],
          0
        ),
        progressMax: (storyCountByEpic[normalizeId(epic.id)] ?? 0) * epicProgressWeights.done,
        progressPercent:
          (storyCountByEpic[normalizeId(epic.id)] ?? 0) > 0
            ? Math.round(
                (["backlog", "developing", "testing", "done"].reduce(
                  (acc, status) =>
                    acc +
                    (statusCountByEpic[normalizeId(epic.id)]?.[status] ?? 0) *
                      epicProgressWeights[status],
                  0
                ) /
                  ((storyCountByEpic[normalizeId(epic.id)] ?? 0) * epicProgressWeights.done)) *
                  100
              )
            : 0,
      }));

      return {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        docsPath: project.docsPath ?? "docs/kanban",
        epics: hydratedEpics,
        stories: storiesWithEpic,
        stats: statuses.reduce((acc, status) => {
          acc[status] = storiesWithEpic.filter((story) => story.status === status).length;
          return acc;
        }, {}),
      };
    })
  );
}

async function findStory(projectId, storyId) {
  const projects = await loadProjects();
  const project = projects.find((item) => item.id === projectId);

  if (!project) {
    return null;
  }

  const story = project.stories.find((item) => item.id === storyId);
  if (!story) {
    return null;
  }

  return { project, story };
}

function canMoveToDeveloping(story) {
  return story.status !== "developing" ? story.isReadyForDeveloping : true;
}

async function validateStoryStatusTransition(projectId, storyId, nextStatus, storyOverride = null) {
  if (nextStatus !== "developing") {
    return;
  }

  const projects = await loadProjects();
  const project = projects.find((item) => item.id === projectId);
  const story = storyOverride ?? project?.stories.find((item) => item.id === storyId);

  if (!project || !story || !canMoveToDeveloping(story)) {
    throw new Error("La historia no esta lista para pasar a developing.");
  }
}

async function getProjectConfig(projectId) {
  const config = await readJson(configPath);
  return config.find((project) => project.id === projectId) ?? null;
}

async function writeStoryFile(projectConfig, storyId, frontmatter, body) {
  const docsRoot = path.join(projectConfig.rootPath, projectConfig.docsPath ?? "docs/kanban");
  const storiesDir = path.join(docsRoot, "stories");
  await ensureDir(storiesDir);
  const filePath = path.join(storiesDir, `${storyId}.md`);
  const content = matter.stringify(body ? `${body}\n` : "", frontmatter);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function writeEpicFile(projectConfig, epicId, frontmatter, body) {
  const docsRoot = path.join(projectConfig.rootPath, projectConfig.docsPath ?? "docs/kanban");
  const epicsDir = path.join(docsRoot, "epics");
  await ensureDir(epicsDir);
  const filePath = path.join(epicsDir, `${epicId}.md`);
  const content = matter.stringify(body ? `${body}\n` : "", frontmatter);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

// ── SSE live-reload ──────────────────────────────────────────────────────────

const sseClients = new Set();

function sendSseEvent(res, data) {
  res.write(`data: ${data}\n\n`);
}

function broadcastRefresh() {
  for (const res of sseClients) {
    sendSseEvent(res, "refresh");
  }
}

let broadcastTimer = null;
function scheduleBroadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(broadcastRefresh, 250);
}

const activeWatchers = new Map();
let syncWatchersTimer = null;

function closeWatcher(watchedPath) {
  const watcher = activeWatchers.get(watchedPath);
  if (!watcher) {
    return;
  }

  watcher.close();
  activeWatchers.delete(watchedPath);
}

function watchPath(watchedPath, onChange) {
  if (activeWatchers.has(watchedPath)) {
    return;
  }

  try {
    const watcher = fsWatch(watchedPath, { persistent: false }, onChange);
    watcher.on("error", () => {
      closeWatcher(watchedPath);
    });
    activeWatchers.set(watchedPath, watcher);
  } catch {
    // Path may not exist yet. The next sync will try again.
  }
}

function scheduleWatchersSync() {
  clearTimeout(syncWatchersTimer);
  syncWatchersTimer = setTimeout(() => {
    void syncWatchers();
  }, 150);
}

function isConfigChange(filename) {
  if (!filename) {
    return true;
  }

  return path.basename(filename) === path.basename(configPath);
}

function isMarkdownChange(filename) {
  if (!filename) {
    return true;
  }

  return String(filename).endsWith(".md");
}

async function getWatchTargets() {
  const targets = new Map();
  const configDir = path.dirname(configPath);

  targets.set(configDir, (_eventType, filename) => {
    if (!isConfigChange(filename)) {
      return;
    }

    scheduleWatchersSync();
    scheduleBroadcast();
  });

  try {
    const projects = await readJson(configPath);

    for (const project of projects) {
      if (!project?.rootPath) {
        continue;
      }

      const docsRoot = path.join(project.rootPath, project.docsPath ?? "docs/kanban");

      targets.set(docsRoot, (_eventType, filename) => {
        if (filename === "epics" || filename === "stories" || !filename) {
          scheduleWatchersSync();
        }

        if (isMarkdownChange(filename)) {
          scheduleBroadcast();
        }
      });

      targets.set(path.join(docsRoot, "epics"), (_eventType, filename) => {
        if (isMarkdownChange(filename)) {
          scheduleBroadcast();
        }
      });

      targets.set(path.join(docsRoot, "stories"), (_eventType, filename) => {
        if (isMarkdownChange(filename)) {
          scheduleBroadcast();
        }
      });
    }
  } catch {
    // Config unreadable. Keep only the config watcher and retry on the next change.
  }

  return targets;
}

async function syncWatchers() {
  const targets = await getWatchTargets();

  for (const watchedPath of activeWatchers.keys()) {
    if (!targets.has(watchedPath)) {
      closeWatcher(watchedPath);
    }
  }

  for (const [watchedPath, onChange] of targets.entries()) {
    watchPath(watchedPath, onChange);
  }
}

void syncWatchers();

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sendSseEvent(res, "connected");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await loadProjects();
    res.json({
      statuses,
      executionModes,
      storyTypes,
      derivedCriteriaRules,
      projects,
    });
  } catch (error) {
    res.status(500).json({
      error: "No se pudieron leer los proyectos configurados.",
      detail: error.message,
    });
  }
});

app.post("/api/projects/:projectId/stories/:storyId/status", async (req, res) => {
  const { projectId, storyId } = req.params;
  const { status } = req.body ?? {};

  if (!statuses.includes(status)) {
    return res.status(400).json({ error: "Estado no soportado." });
  }

  try {
    const result = await findStory(projectId, storyId);
    if (!result) {
      return res.status(404).json({ error: "Historia no encontrada." });
    }

    await validateStoryStatusTransition(projectId, storyId, status, result.story);

    const raw = await fs.readFile(result.story.filePath, "utf8");
    const parsed = matter(raw);
    const nextFrontmatter = {
      ...parsed.data,
      status,
    };
    const nextContent = matter.stringify(parsed.content, nextFrontmatter);
    await fs.writeFile(result.story.filePath, nextContent, "utf8");

    return res.json({ ok: true, status });
  } catch (error) {
    return res.status(500).json({
      error: "No se pudo actualizar el estado de la historia.",
      detail: error.message,
    });
  }
});

app.post("/api/projects/:projectId/stories/:storyId/move", async (req, res) => {
  const { projectId, storyId } = req.params;
  const { status, epicId } = req.body ?? {};

  if (!statuses.includes(status)) {
    return res.status(400).json({ error: "Estado no soportado." });
  }

  try {
    const result = await findStory(projectId, storyId);
    if (!result) {
      return res.status(404).json({ error: "Historia no encontrada." });
    }

    const nextStory = {
      ...result.story,
      status,
      epicId: epicId ? String(epicId).trim() : null,
    };
    await validateStoryStatusTransition(projectId, storyId, status, nextStory);

    const raw = await fs.readFile(result.story.filePath, "utf8");
    const parsed = matter(raw);
    const nextFrontmatter = {
      ...parsed.data,
      status,
      epic: epicId ? String(epicId).trim() : null,
    };
    const nextContent = matter.stringify(parsed.content, nextFrontmatter);
    await fs.writeFile(result.story.filePath, nextContent, "utf8");

    return res.json({
      ok: true,
      status,
      epicId: nextFrontmatter.epic ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      error: "No se pudo mover la historia.",
      detail: error.message,
    });
  }
});

app.post(
  "/api/projects/:projectId/stories/:storyId/criteria/:criteriaType/:criteriaIndex/toggle",
  async (req, res) => {
    const { projectId, storyId, criteriaType, criteriaIndex } = req.params;
    const index = Number.parseInt(criteriaIndex, 10);

    if (!["ready", "done"].includes(criteriaType)) {
      return res.status(400).json({ error: "Tipo de checklist no soportado." });
    }

    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: "Indice de criterio no valido." });
    }

    try {
      const result = await findStory(projectId, storyId);
      if (!result) {
        return res.status(404).json({ error: "Historia no encontrada." });
      }

      const raw = await fs.readFile(result.story.filePath, "utf8");
      const parsed = matter(raw);
      const fieldName = criteriaType === "ready" ? "ready_criteria" : "done_criteria";
      const criteria = coerceCriteria(parsed.data?.[fieldName]);

      if (!criteria[index]) {
        return res.status(404).json({ error: "Criterio no encontrado." });
      }

      if (criteria[index].kind !== "manual") {
        return res.status(400).json({ error: "Solo se pueden editar criterios manuales." });
      }

      criteria[index] = {
        ...criteria[index],
        checked: !criteria[index].checked,
      };

      const nextFrontmatter = {
        ...parsed.data,
        [fieldName]: criteria,
      };
      const nextContent = matter.stringify(parsed.content, nextFrontmatter);
      await fs.writeFile(result.story.filePath, nextContent, "utf8");

      return res.json({
        ok: true,
        criteriaType,
        criteria,
        toggledCriterion: criteria[index],
      });
    } catch (error) {
      return res.status(500).json({
        error: "No se pudo actualizar el checklist.",
        detail: error.message,
      });
    }
  }
);

app.post("/api/projects/:projectId/stories/:storyId/subtasks/:subtaskIndex/toggle", async (req, res) => {
  const { projectId, storyId, subtaskIndex } = req.params;
  const index = Number.parseInt(subtaskIndex, 10);

  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "Indice de subtarea no valido." });
  }

  try {
    const result = await findStory(projectId, storyId);
    if (!result) {
      return res.status(404).json({ error: "Historia no encontrada." });
    }

    const raw = await fs.readFile(result.story.filePath, "utf8");
    const parsed = matter(raw);
    const subtasks = coerceSubtasks(parsed.data?.subtasks);

    if (!subtasks[index]) {
      return res.status(404).json({ error: "Subtarea no encontrada." });
    }

    subtasks[index] = {
      ...subtasks[index],
      done: !subtasks[index].done,
    };

    const nextFrontmatter = {
      ...parsed.data,
      subtasks,
    };
    const nextContent = matter.stringify(parsed.content, nextFrontmatter);
    await fs.writeFile(result.story.filePath, nextContent, "utf8");

    return res.json({
      ok: true,
      subtasks,
      toggledSubtask: subtasks[index],
    });
  } catch (error) {
    return res.status(500).json({
      error: "No se pudo actualizar la subtarea.",
      detail: error.message,
    });
  }
});

app.post("/api/projects/:projectId/epics", async (req, res) => {
  const { projectId } = req.params;

  try {
    const projectConfig = await getProjectConfig(projectId);
    if (!projectConfig) {
      return res.status(404).json({ error: "Proyecto no encontrado." });
    }

    const payload = sanitizeEpicPayload(req.body ?? {}, projectId);
    const epicId = payload.id ?? `EPI-${toSlug(payload.title)}`;
    const docsRoot = path.join(projectConfig.rootPath, projectConfig.docsPath ?? "docs/kanban");
    const targetPath = path.join(docsRoot, "epics", `${epicId}.md`);

    try {
      await fs.access(targetPath);
      return res.status(409).json({
        error: "Ya existe una epica con ese ID.",
        detail: `El archivo ${targetPath} ya existe.`,
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const frontmatter = {
      id: epicId,
      type: "epic",
      project: projectId,
      title: payload.title,
      description: payload.description,
      labels: payload.labels,
    };

    const filePath = await writeEpicFile(projectConfig, epicId, frontmatter, payload.body);
    return res.status(201).json({ ok: true, id: epicId, filePath });
  } catch (error) {
    return res.status(400).json({
      error: "No se pudo crear la epica.",
      detail: error.message,
    });
  }
});

app.put("/api/projects/:projectId/epics/:epicId", async (req, res) => {
  const { projectId, epicId } = req.params;

  try {
    const projectConfig = await getProjectConfig(projectId);
    const projects = await loadProjects();
    const project = projects.find((item) => item.id === projectId);
    const existing = project?.epics.find((epic) => epic.id === epicId);

    if (!projectConfig || !existing) {
      return res.status(404).json({ error: "Epica no encontrada." });
    }

    const payload = sanitizeEpicPayload({ ...req.body, id: epicId }, projectId);
    const frontmatter = {
      id: epicId,
      type: "epic",
      project: projectId,
      title: payload.title,
      description: payload.description,
      labels: payload.labels,
    };

    await writeEpicFile(projectConfig, epicId, frontmatter, payload.body);
    return res.json({ ok: true, id: epicId });
  } catch (error) {
    return res.status(400).json({
      error: "No se pudo actualizar la epica.",
      detail: error.message,
    });
  }
});

app.post("/api/projects/:projectId/stories", async (req, res) => {
  const { projectId } = req.params;

  try {
    const projectConfig = await getProjectConfig(projectId);
    if (!projectConfig) {
      return res.status(404).json({ error: "Proyecto no encontrado." });
    }

    const payload = sanitizeStoryPayload(req.body ?? {}, projectId);
    const storyId = payload.id ?? `STO-${toSlug(payload.title)}`;
    const docsRoot = path.join(projectConfig.rootPath, projectConfig.docsPath ?? "docs/kanban");
    const targetPath = path.join(docsRoot, "stories", `${storyId}.md`);

    try {
      await fs.access(targetPath);
      return res.status(409).json({
        error: "Ya existe una historia con ese ID.",
        detail: `El archivo ${targetPath} ya existe.`,
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const projects = await loadProjects();
    const project = projects.find((item) => item.id === projectId);
    const enrichedCandidate = enrichStories(
      { ...project, epics: project?.epics ?? [] },
      [
        ...(project?.stories ?? []).map((story) => ({
          ...story,
          readyCriteria: coerceCriteria(story.readyCriteria),
          doneCriteria: coerceCriteria(story.doneCriteria),
        })),
        {
          id: storyId,
          type: "story",
          title: payload.title,
          description: payload.description,
          projectId,
          projectName: project?.name ?? projectId,
          status: payload.status,
          epicId: payload.epic,
          priority: payload.priority,
          assignee: payload.assignee,
          agentOwner: payload.agentOwner,
          executionMode: payload.executionMode,
          storyType: payload.storyType,
          blockedBy: payload.blockedBy,
          blocks: payload.blocks,
          relatedTo: payload.relatedTo,
          contextFiles: payload.contextFiles,
          agentStatusNote: payload.agentStatusNote,
          lastAgentUpdate: payload.lastAgentUpdate,
          labels: payload.labels,
          subtasks: payload.subtasks,
          readyCriteria: payload.readyCriteria,
          doneCriteria: payload.doneCriteria,
          body: payload.body,
        },
      ]
    ).find((story) => story.id === storyId);

    if (payload.status === "developing" && !enrichedCandidate?.isReadyForDeveloping) {
      return res.status(400).json({
        error: "La historia no esta lista para pasar a developing.",
      });
    }

    const frontmatter = sanitizeStoryFrontmatter({ ...payload, id: storyId, project: projectId });

    const filePath = await writeStoryFile(projectConfig, storyId, frontmatter, payload.body);
    return res.status(201).json({ ok: true, id: storyId, filePath });
  } catch (error) {
    return res.status(400).json({
      error: "No se pudo crear la historia.",
      detail: error.message,
    });
  }
});

app.put("/api/projects/:projectId/stories/:storyId", async (req, res) => {
  const { projectId, storyId } = req.params;

  try {
    const projectConfig = await getProjectConfig(projectId);
    const existing = await findStory(projectId, storyId);

    if (!projectConfig || !existing) {
      return res.status(404).json({ error: "Historia no encontrada." });
    }

    const payload = sanitizeStoryPayload({ ...req.body, id: storyId }, projectId);
    const projects = await loadProjects();
    const project = projects.find((item) => item.id === projectId);
    const enrichedCandidate = enrichStories(
      { ...project, epics: project?.epics ?? [] },
      (project?.stories ?? []).map((story) =>
        story.id === storyId
          ? {
              ...story,
              title: payload.title,
              description: payload.description,
              status: payload.status,
              epicId: payload.epic,
              priority: payload.priority,
              assignee: payload.assignee,
              agentOwner: payload.agentOwner,
              executionMode: payload.executionMode,
              storyType: payload.storyType,
              blockedBy: payload.blockedBy,
              blocks: payload.blocks,
              relatedTo: payload.relatedTo,
              contextFiles: payload.contextFiles,
              agentStatusNote: payload.agentStatusNote,
              lastAgentUpdate: payload.lastAgentUpdate,
              labels: payload.labels,
              subtasks: payload.subtasks,
              readyCriteria: payload.readyCriteria,
              doneCriteria: payload.doneCriteria,
              body: payload.body,
            }
          : story
      )
    ).find((story) => story.id === storyId);

    if (payload.status === "developing" && !enrichedCandidate?.isReadyForDeveloping) {
      return res.status(400).json({
        error: "La historia no esta lista para pasar a developing.",
      });
    }

    const frontmatter = sanitizeStoryFrontmatter({ ...payload, id: storyId, project: projectId });

    await writeStoryFile(projectConfig, storyId, frontmatter, payload.body);
    return res.json({ ok: true, id: storyId });
  } catch (error) {
    return res.status(400).json({
      error: "No se pudo actualizar la historia.",
      detail: error.message,
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 4010;
const host = process.env.HOST || "127.0.0.1";

app.listen(port, host, () => {
  console.log(`Local Kanban API listening on http://${host}:${port}`);
});
