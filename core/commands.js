import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";

import { DomainError } from "./errors.js";
import { diagnoseProject } from "./diagnostics.js";
import { resolveProjectPaths, readFileLimited } from "./paths.js";
import { migrateLegacyDocuments } from "./legacy-migration.js";
import { getRegisteredProject } from "./project.js";
import { openRuntime } from "./runtime.js";
import { reconcileProjectDocuments, reconcileProjectQuarantines } from "./reconciliation.js";
import { validateEpic, validateProject, validateStory } from "./schema.js";
import {
  persistStory,
  readEpic,
  readStory,
  recoverPendingOperations,
} from "./story-repository.js";
import { transitionStory } from "./story.js";

async function listMarkdownFiles(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function errorSummary(error) {
  return {
    code: error.code ?? "invalid_document",
    message: error.message,
    details: error.details ?? null,
  };
}

function commandFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function validateStoryGraph(stories) {
  const byId = new Map(stories.map((story) => [story.id, story]));
  const orphaned = [];
  for (const story of stories) {
    for (const dependency of story.dependencies) {
      if (!byId.has(dependency.story_id)) {
        orphaned.push({ storyId: story.id, dependencyId: dependency.story_id });
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  function visit(storyId, trail = []) {
    if (visiting.has(storyId)) {
      cycles.push([...trail.slice(trail.indexOf(storyId)), storyId]);
      return;
    }
    if (visited.has(storyId)) {
      return;
    }
    visiting.add(storyId);
    const story = byId.get(storyId);
    for (const dependency of story?.dependencies ?? []) {
      if (dependency.type === "hard" && byId.has(dependency.story_id)) {
        visit(dependency.story_id, [...trail, storyId]);
      }
    }
    visiting.delete(storyId);
    visited.add(storyId);
  }
  for (const storyId of byId.keys()) {
    visit(storyId);
  }
  return { orphaned, cycles };
}

export async function validateProjectDocuments(projectInput) {
  const project = validateProject(projectInput);
  const paths = await resolveProjectPaths(project);
  const valid = { stories: [], epics: [] };
  const invalid = [];

  for (const [kind, directory, validator] of [
    ["story", paths.storiesDir, validateStory],
    ["epic", paths.epicsDir, validateEpic],
  ]) {
    for (const filePath of await listMarkdownFiles(directory)) {
      try {
        const raw = await readFileLimited(filePath, { rootPath: paths.rootPath, encoding: "utf8" });
        const parsed = matter(raw);
        validator(parsed.data);
        const filenameId = path.basename(filePath, ".md");
        if (parsed.data.id !== filenameId) {
          throw new DomainError("entity_id_mismatch", "El ID no coincide con el nombre del fichero.", {
            details: { filenameId, documentId: parsed.data.id },
            status: 409,
          });
        }
        valid[kind === "story" ? "stories" : "epics"].push(parsed.data);
      } catch (error) {
        invalid.push({ filePath, ...errorSummary(error) });
      }
    }
  }

  const graph = validateStoryGraph(valid.stories);
  const epicIds = new Set(valid.epics.map((epic) => epic.id));
  for (const epic of valid.epics) {
    if (epic.project !== project.id) {
      invalid.push({
        filePath: null,
        code: "project_mismatch",
        message: "La épica pertenece a otro proyecto.",
        details: { entityId: epic.id, documentProject: epic.project, projectId: project.id },
      });
    }
  }
  for (const story of valid.stories) {
    if (story.project !== project.id) {
      invalid.push({
        filePath: null,
        code: "project_mismatch",
        message: "La historia pertenece a otro proyecto.",
        details: { entityId: story.id, documentProject: story.project, projectId: project.id },
      });
    }
    if (story.epic && !epicIds.has(story.epic)) {
      invalid.push({
        filePath: null,
        code: "orphan_epic",
        message: "La historia referencia una épica inexistente.",
        details: { storyId: story.id, epicId: story.epic },
      });
    }
  }
  for (const orphan of graph.orphaned) {
    invalid.push({ filePath: null, code: "orphan_dependency", message: "Dependencia huérfana.", details: orphan });
  }
  for (const cycle of graph.cycles) {
    invalid.push({ filePath: null, code: "dependency_cycle", message: "Ciclo en dependencias hard.", details: { cycle } });
  }

  return {
    ok: invalid.length === 0,
    project: { id: project.id, rootPath: paths.rootPath, docsPath: paths.docsPath },
    counts: { stories: valid.stories.length, epics: valid.epics.length, invalid: invalid.length },
    invalid,
    stories: valid.stories,
    epics: valid.epics,
  };
}

export async function transitionStoryCommand(options) {
  const project = options.project ?? (await getRegisteredProject(options));
  validateProject(project);
  const paths = await resolveProjectPaths(project);
  const runtime = openRuntime(paths.rootPath);
  try {
    const requestFingerprint = commandFingerprint({
      command: "transition_story",
      storyId: options.storyId,
      expectedRevision: options.expectedRevision,
      nextStatus: options.nextStatus,
      nextEpic: Object.hasOwn(options, "nextEpic") ? options.nextEpic : "__unchanged__",
      actor: options.actor,
      actorRole: options.actorRole,
    });
    let existing = options.idempotencyKey
      ? runtime.getByIdempotencyKey(options.idempotencyKey)
      : null;
    if (existing) {
      if (existing.request_fingerprint !== requestFingerprint) {
        throw new DomainError(
          "idempotency_conflict",
          "La clave de idempotencia ya se utilizó con otra intención.",
          { details: { idempotencyKey: options.idempotencyKey }, status: 409 },
        );
      }
      if (existing.status === "pending") {
        await recoverPendingOperations(paths, runtime);
        existing = runtime.getByIdempotencyKey(options.idempotencyKey);
      }
      if (existing.status === "completed") {
        return existing.result;
      }
      throw new DomainError("operation_not_retryable", "La operación no puede reintentarse.", {
        details: { operationId: existing.id, status: existing.status },
        status: 409,
      });
    }

    await recoverPendingOperations(paths, runtime);
    const current = await readStory(paths, options.storyId);
    if (current.story.project !== project.id) {
      throw new DomainError("project_mismatch", "La historia pertenece a otro proyecto.", {
        details: { storyId: current.story.id, documentProject: current.story.project, projectId: project.id },
        status: 409,
      });
    }
    const targetEpic = Object.hasOwn(options, "nextEpic") ? options.nextEpic : current.story.epic;
    if (targetEpic) {
      const referencedEpic = await readEpic(paths, targetEpic);
      if (referencedEpic.epic.project !== project.id) {
        throw new DomainError("project_mismatch", "La épica pertenece a otro proyecto.", {
          details: { epicId: targetEpic, projectId: project.id },
          status: 409,
        });
      }
    }
    const dependencyStatuses = {};
    for (const dependency of current.story.dependencies.filter((item) => item.type === "hard")) {
      try {
        const dependencyStory = (await readStory(paths, dependency.story_id)).story;
        if (dependencyStory.project !== project.id) {
          throw new DomainError("project_mismatch", "La dependencia pertenece a otro proyecto.", {
            details: {
              storyId: current.story.id,
              dependencyId: dependency.story_id,
              documentProject: dependencyStory.project,
              projectId: project.id,
            },
            status: 409,
          });
        }
        dependencyStatuses[dependency.story_id] = dependencyStory.status;
      } catch (error) {
        if (error.code === "story_not_found" || error.code === "ENOENT") {
          throw new DomainError("orphan_dependency", "La historia tiene una dependencia huérfana.", {
            details: { storyId: current.story.id, dependencyId: dependency.story_id },
            status: 409,
          });
        }
        throw error;
      }
    }
    const transitioned = transitionStory(
      current.story,
      {
        expectedRevision: options.expectedRevision,
        nextStatus: options.nextStatus,
        ...(Object.hasOwn(options, "nextEpic") ? { nextEpic: options.nextEpic } : {}),
        actorRole: options.actorRole,
      },
      dependencyStatuses,
    );
    const commandResult = {
      storyId: transitioned.story.id,
      revision: transitioned.story.revision,
      status: transitioned.story.status,
      epic: transitioned.story.epic ?? null,
      gates: transitioned.gates,
      nextAction: transitioned.story.status === "done" ? "reevaluate" : "continue",
    };
    await persistStory({
      project: paths,
      runtime,
      current,
      nextStory: transitioned.story,
      actor: options.actor,
      idempotencyKey: options.idempotencyKey,
      requestFingerprint,
      result: commandResult,
    });
    return commandResult;
  } finally {
    runtime.close();
  }
}

export async function doctorProject(options = {}) {
  const project = options.project ?? (await getRegisteredProject(options));
  const paths = await resolveProjectPaths(project);
  const runtime = openRuntime(paths.rootPath);
  try {
    const recovery = await recoverPendingOperations(paths, runtime);
    const reconciliation = await reconcileProjectDocuments(paths, runtime, { actor: "doctor" });
    const validation = await validateProjectDocuments(project);
    const diagnosis = await diagnoseProject({
      validation,
      recovery,
      paths,
      runtime,
      checkSkill: options.checkSkill,
      skillSource: options.skillSource,
      skillTarget: options.skillTarget,
    });
    return {
      ...diagnosis,
      validation: {
        ok: validation.ok,
        counts: validation.counts,
        invalid: validation.invalid,
      },
      runtime: { filePath: runtime.filePath, recovery, reconciliation },
    };
  } finally {
    runtime.close();
  }
}

export async function reconcileProjectCommand(options = {}) {
  const project = options.project ?? (await getRegisteredProject(options));
  const paths = await resolveProjectPaths(project);
  const runtime = openRuntime(paths.rootPath);
  try {
    return await reconcileProjectQuarantines(paths, runtime, {
      entityIds: options.entityIds,
      all: options.all,
      acceptCurrent: options.acceptCurrent,
      justification: options.justification,
      actor: options.actor,
    });
  } finally {
    runtime.close();
  }
}

export async function migrateLegacyProjectCommand(options = {}) {
  const project = options.project ?? (await getRegisteredProject(options));
  const paths = await resolveProjectPaths(project);
  const runtime = openRuntime(paths.rootPath);
  try {
    const assertSafeToApply = () => {
      const unsafeOperations = runtime.listProblemOperations();
      const activeClaims = runtime.db
        .prepare("SELECT COUNT(*) AS count FROM claims WHERE status IN ('active', 'stale')")
        .get().count;
      if (unsafeOperations.length > 0 || activeClaims > 0) {
        throw new DomainError(
          "legacy_migration_unsafe",
          "No se migra con operaciones o claims abiertos.",
          { details: { unsafeOperations, activeClaims }, status: 409 },
        );
      }
    };
    assertSafeToApply();
    return await migrateLegacyDocuments(paths, {
      ...options,
      assertSafeToApply: options.apply ? assertSafeToApply : undefined,
    });
  } finally {
    runtime.close();
  }
}
