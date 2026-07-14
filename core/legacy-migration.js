import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

import { atomicWriteFile } from "./atomic-write.js";
import { DomainError } from "./errors.js";
import { readFileLimited, resolveProjectPaths } from "./paths.js";
import { validateEpic, validateStory } from "./schema.js";

async function markdownFiles(directory) {
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function slug(value, fallback) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 56) || fallback;
}

function uniqueIds(items, prefix) {
  const used = new Set();
  return items.map((item, index) => {
    const base = slug(item.id ?? item.title ?? item.label, `${prefix}-${index + 1}`);
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base.slice(0, 60 - String(suffix).length)}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return id;
  });
}

function migrateCriteria(items = [], prefix) {
  const ids = uniqueIds(items.map((item, index) => ({ ...item, id: item.id ?? `${prefix}-${index + 1}` })), prefix);
  return items.map((item, index) => item.kind === "derived"
    ? { id: ids[index], label: String(item.label), kind: "derived", rule: String(item.rule) }
    : { id: ids[index], label: String(item.label), kind: "manual", checked: Boolean(item.checked) });
}

function section(body, heading) {
  const match = String(body).match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "imu"));
  return match?.[1]?.trim() ?? "";
}

function appendLegacyNote(body, note, updatedAt) {
  if (!note) return body;
  const suffix = [
    "## Estado previo a la migración canónica",
    note.trim(),
    updatedAt ? `\nÚltima actualización legacy registrada: ${updatedAt}` : null,
  ].filter(Boolean).join("\n\n");
  return `${body.trim()}\n\n${suffix}\n`;
}

function migrateEpic(data, body) {
  const objective = section(body, "Objetivo") || String(data.description ?? data.title).trim();
  return {
    schema_version: 1,
    revision: 1,
    id: data.id,
    type: "epic",
    project: data.project,
    title: data.title,
    objective,
    ...(data.description ? { description: data.description } : {}),
    labels: Array.isArray(data.labels) ? data.labels : [],
  };
}

function migrateStory(data, body, options) {
  const acceptanceSource = Array.isArray(data.done_criteria) ? data.done_criteria : [];
  const readinessSource = Array.isArray(data.ready_criteria) ? data.ready_criteria : [];
  const subtaskSource = Array.isArray(data.subtasks) ? data.subtasks : [];
  const subtaskIds = uniqueIds(subtaskSource, "task");
  const contextFiles = Array.isArray(data.context_files) ? data.context_files : [];
  const description = String(data.description ?? "").trim();
  const objective = section(body, "Objetivo") || description || String(data.title).trim();
  const scopeSection = section(body, "Alcance")
    .split("\n")
    .map((item) => item.replace(/^[-*]\s*/u, "").trim())
    .filter(Boolean);
  const scope = contextFiles.length > 0 ? contextFiles : scopeSection.length > 0 ? scopeSection : [description || objective];
  const dependencies = [
    ...(Array.isArray(data.blocked_by) ? data.blocked_by : []).map((storyId) => ({
      story_id: String(storyId),
      type: "hard",
      reason: "Dependencia hard migrada desde blocked_by.",
    })),
    ...(Array.isArray(data.related_to) ? data.related_to : []).map((storyId) => ({
      story_id: String(storyId),
      type: "related",
      reason: "Relación migrada desde related_to.",
    })),
  ];
  const acceptance = migrateCriteria(acceptanceSource, "acceptance");
  if (acceptance.length === 0) {
    throw new DomainError(
      "legacy_migration_ambiguous",
      `${data.id} no contiene done_criteria que puedan migrarse sin inventar aceptación.`,
      { details: { storyId: data.id }, status: 409 },
    );
  }
  return {
    schema_version: 1,
    revision: 1,
    id: data.id,
    type: "story",
    project: data.project,
    title: data.title,
    objective,
    ...(description ? { description } : {}),
    scope,
    non_scope: [],
    epic: data.epic ?? null,
    status: data.status === "done" ? "testing" : data.status,
    priority: data.priority,
    risk: options.risk,
    execution_mode: data.execution_mode ?? "agent",
    story_type: data.story_type === "bugfix" ? "bug" : data.story_type,
    assignee: data.assignee ?? null,
    agent_owner: data.agent_owner ?? null,
    acceptance_criteria: acceptance,
    readiness_criteria: migrateCriteria(readinessSource, "readiness"),
    dependencies,
    context_files: contextFiles,
    validation: {
      commands: options.validationCommands,
      notes: `Contrato de validación declarado durante migración: ${options.justification}`,
    },
    subtasks: subtaskSource.map((item, index) => ({
      id: subtaskIds[index],
      title: String(item.title),
      done: Boolean(item.done),
    })),
    labels: Array.isArray(data.labels) ? data.labels : [],
  };
}

function validateProjectedGraph(stories) {
  const byId = new Map(stories.map((story) => [story.id, story]));
  const orphaned = [];
  for (const story of stories) {
    for (const dependency of story.dependencies ?? []) {
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
    if (visited.has(storyId)) return;
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
  for (const storyId of byId.keys()) visit(storyId);
  return { orphaned, cycles };
}

async function validateProjectedDocuments(project, paths, plan) {
  const projectedByPath = new Map(plan.map((item) => [item.filePath, item.content]));
  const epics = [];
  const stories = [];

  for (const [entityType, directory, validate] of [
    ["epic", paths.epicsDir, validateEpic],
    ["story", paths.storiesDir, validateStory],
  ]) {
    for (const filePath of await markdownFiles(directory)) {
      const raw = projectedByPath.get(filePath) ??
        await readFileLimited(filePath, { rootPath: paths.rootPath, encoding: "utf8" });
      const parsed = matter(raw);
      validate(parsed.data);
      const filenameId = path.basename(filePath, ".md");
      if (parsed.data.id !== filenameId || parsed.data.project !== project.id) {
        throw new DomainError(
          "legacy_migration_invalid_graph",
          "La migración proyectada no conserva ID, fichero y proyecto canónicos.",
          {
            details: {
              filePath,
              filenameId,
              documentId: parsed.data.id,
              documentProject: parsed.data.project,
              projectId: project.id,
            },
            status: 409,
          },
        );
      }
      (entityType === "story" ? stories : epics).push(parsed.data);
    }
  }

  const epicIds = new Set(epics.map((epic) => epic.id));
  const orphanEpics = stories
    .filter((story) => story.epic && !epicIds.has(story.epic))
    .map((story) => ({ storyId: story.id, epicId: story.epic }));
  const graph = validateProjectedGraph(stories);
  if (orphanEpics.length > 0 || graph.orphaned.length > 0 || graph.cycles.length > 0) {
    throw new DomainError(
      "legacy_migration_invalid_graph",
      "La migración proyectada contiene referencias huérfanas o ciclos.",
      {
        details: { orphanEpics, orphanedDependencies: graph.orphaned, cycles: graph.cycles },
        status: 409,
      },
    );
  }
}

async function applyMigrationBatch(plan, paths, options) {
  const writeFile = options.writeFile ?? atomicWriteFile;
  const written = [];
  try {
    await options.assertSafeToApply?.();
    for (const item of plan) {
      await options.assertSafeToApply?.();
      await writeFile(item.filePath, item.content, { rootPath: paths.rootPath });
      written.push(item);
    }
    await options.assertSafeToApply?.();
  } catch (error) {
    const rollbackFailures = [];
    for (const item of written.reverse()) {
      try {
        await atomicWriteFile(item.filePath, item.originalContent, { rootPath: paths.rootPath });
      } catch (rollbackError) {
        rollbackFailures.push({
          filePath: item.filePath,
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
    }
    if (rollbackFailures.length > 0) {
      throw new DomainError(
        "legacy_migration_rollback_failed",
        "La migración falló y no pudo restaurar todos los documentos.",
        {
          details: {
            cause: error instanceof Error ? error.message : String(error),
            rollbackFailures,
          },
          status: 500,
        },
      );
    }
    throw error;
  }
}

export async function migrateLegacyDocuments(project, options = {}) {
  const paths = await resolveProjectPaths(project);
  if (!Array.isArray(options.validationCommands) || options.validationCommands.length === 0) {
    throw new DomainError("command_invalid", "--validation es obligatorio para migrar historias.");
  }
  if (!["standard", "high"].includes(options.risk)) {
    throw new DomainError("command_invalid", "--risk debe ser standard o high.");
  }
  if (!String(options.justification ?? "").trim()) {
    throw new DomainError("command_invalid", "--reason documenta la decisión de migración y es obligatorio.");
  }

  const plan = [];
  for (const [entityType, directory] of [["epic", paths.epicsDir], ["story", paths.storiesDir]]) {
    for (const filePath of await markdownFiles(directory)) {
      const raw = await readFileLimited(filePath, { rootPath: paths.rootPath, encoding: "utf8" });
      const parsed = matter(raw);
      if (parsed.data.schema_version === 1) continue;
      if (parsed.data.project !== project.id) {
        throw new DomainError("project_mismatch", `${filePath} pertenece a otro proyecto.`);
      }
      const frontmatter = entityType === "story"
        ? migrateStory(parsed.data, parsed.content, options)
        : migrateEpic(parsed.data, parsed.content);
      const body = entityType === "story"
        ? appendLegacyNote(parsed.content, parsed.data.agent_status_note, parsed.data.last_agent_update)
        : parsed.content;
      (entityType === "story" ? validateStory : validateEpic)(frontmatter);
      plan.push({
        entityType,
        entityId: frontmatter.id,
        filePath,
        previousStatus: parsed.data.status ?? null,
        nextStatus: frontmatter.status ?? null,
        assumptions: entityType === "story"
          ? [
              `risk=${options.risk} declarado por el operador`,
              `validation=${options.validationCommands.join(" | ")} declarada por el operador`,
              "done histórico se reabre en testing por ausencia de evidencia canónica",
              "objective/scope derivados de secciones, descripción o contexto y registrados en el diff",
            ]
          : ["objective derivado de la sección Objetivo o descripción y registrado en el diff"],
        originalContent: raw,
        content: matter.stringify(body.trim() ? `\n${body.trim()}\n` : "", frontmatter),
      });
    }
  }

  await validateProjectedDocuments(project, paths, plan);

  if (options.apply) {
    await applyMigrationBatch(plan, paths, options);
  }
  return {
    ok: true,
    mode: options.apply ? "applied" : "preview",
    migrated: plan.length,
    storiesReopenedForVerification: plan.filter((item) => item.previousStatus === "done").length,
    justification: options.justification,
    documents: plan.map(({ content: _content, originalContent: _originalContent, ...item }) => item),
    nextAction: options.apply
      ? "Ejecuta local-kanban validate --json y después local-kanban doctor --json."
      : "Revisa assumptions y repite con --apply si la decisión es correcta.",
  };
}
