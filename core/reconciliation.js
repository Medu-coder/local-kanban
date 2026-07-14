import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

import { explainQuarantine } from "./degradation.js";
import { DomainError } from "./errors.js";
import { hashContent } from "./story-repository.js";
import { readFileLimited, resolveProjectPaths } from "./paths.js";
import { validateEpic, validateStory } from "./schema.js";

async function markdownFiles(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function reconcileProjectDocuments(project, runtime, options = {}) {
  const paths = project.docsRoot ? project : await resolveProjectPaths(project);
  const results = [];
  const seen = new Set();
  for (const [entityType, directory, validate] of [
    ["epic", paths.epicsDir, validateEpic],
    ["story", paths.storiesDir, validateStory],
  ]) {
    for (const filePath of await markdownFiles(directory)) {
      const entityId = path.basename(filePath, ".md");
      seen.add(`${entityType}:${entityId}`);
      try {
        const raw = await readFileLimited(filePath, { rootPath: paths.rootPath, encoding: "utf8" });
        const parsed = matter(raw);
        validate(parsed.data);
        const expectedId = path.basename(filePath, ".md");
        if (parsed.data.id !== expectedId || parsed.data.project !== project.id) {
          throw new Error("ID, nombre de fichero o proyecto no coinciden.");
        }
        results.push(
          runtime.reconcileDocument({
            entityType,
            entityId: parsed.data.id,
            revision: parsed.data.revision,
            contentHash: hashContent(raw),
            actor: options.actor ?? "watcher",
          }),
        );
      } catch (error) {
        const details = {
          filePath,
          error: error.code ?? "invalid_document",
          message: error.message,
          ...(error.details ? { validationDetails: error.details } : {}),
        };
        runtime.quarantineEntity({
          entityType,
          entityId,
          reason: "invalid_document",
          actor: options.actor ?? "watcher",
          details,
        });
        results.push({
          status: "quarantined",
          entityType,
          entityId,
          reason: "invalid_document",
          details,
        });
      }
    }
  }
  for (const state of runtime.listEntityStates()) {
    if (seen.has(`${state.entityType}:${state.entityId}`)) {
      continue;
    }
    const directory = state.entityType === "story" ? paths.storiesDir : paths.epicsDir;
    const details = {
      filePath: path.join(directory, `${state.entityId}.md`),
      runtimeRevision: state.revision,
      runtimeHash: state.contentHash,
    };
    runtime.quarantineEntity({
      entityType: state.entityType,
      entityId: state.entityId,
      reason: "missing_document",
      actor: options.actor ?? "watcher",
      details,
    });
    results.push({
      status: "quarantined",
      entityType: state.entityType,
      entityId: state.entityId,
      reason: "missing_document",
      details,
    });
  }
  return results;
}

async function currentDocumentSnapshot(paths, quarantine, projectId) {
  const directory = quarantine.entityType === "story" ? paths.storiesDir : paths.epicsDir;
  const filePath = path.join(directory, `${quarantine.entityId}.md`);
  const raw = await readFileLimited(filePath, { rootPath: paths.rootPath, encoding: "utf8" });
  const parsed = matter(raw);
  const validate = quarantine.entityType === "story" ? validateStory : validateEpic;
  validate(parsed.data);
  if (parsed.data.id !== quarantine.entityId || parsed.data.project !== projectId) {
    throw new DomainError(
      "reconciliation_input_invalid",
      "ID, nombre de fichero o proyecto no coinciden.",
      {
        details: {
          entityId: quarantine.entityId,
          documentId: parsed.data.id,
          documentProject: parsed.data.project,
          projectId,
          filePath,
        },
        status: 409,
      },
    );
  }
  return { revision: parsed.data.revision, contentHash: hashContent(raw), filePath };
}

async function preflightCurrentDocumentAcceptance(paths, runtime, quarantines, projectId) {
  const snapshots = [];

  for (const quarantine of quarantines) {
    const snapshot = await currentDocumentSnapshot(paths, quarantine, projectId);
    const state = runtime.db
      .prepare(
        `SELECT revision, content_hash, pending_operation_id
         FROM entity_state WHERE entity_type = ? AND entity_id = ?`,
      )
      .get(quarantine.entityType, quarantine.entityId);
    const activeClaim = quarantine.entityType === "story"
      ? runtime.db
          .prepare(
            `SELECT attempt_id FROM claims
             WHERE story_id = ? AND status IN ('active', 'stale')
             ORDER BY fencing_token DESC LIMIT 1`,
          )
          .get(quarantine.entityId)
      : null;

    if (!state || quarantine.reason !== "revision_divergence") {
      throw new DomainError(
        "reconciliation_unsafe",
        "Solo una divergencia de revisión validada puede aceptar el Markdown actual.",
        {
          details: {
            entityType: quarantine.entityType,
            entityId: quarantine.entityId,
            reason: quarantine.reason,
          },
          status: 409,
        },
      );
    }
    if (state.pending_operation_id || activeClaim) {
      throw new DomainError(
        "reconciliation_unsafe",
        "La entidad tiene una operación o claim activo y no puede aceptarse.",
        {
          details: {
            entityType: quarantine.entityType,
            entityId: quarantine.entityId,
            operationId: state.pending_operation_id,
            attemptId: activeClaim?.attempt_id,
          },
          status: 409,
        },
      );
    }
    snapshots.push({ quarantine, snapshot });
  }

  return snapshots;
}

export async function reconcileProjectQuarantines(project, runtime, options = {}) {
  const paths = project.docsRoot ? project : await resolveProjectPaths(project);
  await reconcileProjectDocuments(paths, runtime, { actor: options.actor ?? "reconcile" });
  const quarantines = runtime.listQuarantines();
  const targetIds = new Set(options.entityIds ?? []);
  const selected = options.all
    ? quarantines
    : quarantines.filter((item) => targetIds.has(item.entityId));

  if (!options.acceptCurrent) {
    const issues = quarantines.map(explainQuarantine);
    return {
      ok: issues.length === 0,
      health: issues.length === 0 ? "healthy" : "degraded",
      canProceed: issues.length === 0,
      total: issues.length,
      issues,
      nextAction: issues[0]?.action ?? "No hay documentos pendientes de reconciliación.",
    };
  }
  if (!options.all && targetIds.size === 0) {
    throw new DomainError(
      "command_invalid",
      "Para aceptar Markdown actual indica ENTITY_ID o --all.",
      { status: 400 },
    );
  }
  if (!String(options.justification ?? "").trim()) {
    throw new DomainError(
      "command_invalid",
      "--reason es obligatorio para aceptar una divergencia.",
      { status: 400 },
    );
  }
  if (!options.all && selected.length !== targetIds.size) {
    const found = new Set(selected.map((item) => item.entityId));
    throw new DomainError(
      "reconciliation_not_required",
      "Alguna entidad solicitada no está en cuarentena.",
      { details: { missing: [...targetIds].filter((id) => !found.has(id)) }, status: 409 },
    );
  }

  // Preflight the complete selection before accepting any document. In particular,
  // --all must not clear early divergences and then fail on a later unsafe entity.
  const acceptancePlan = await preflightCurrentDocumentAcceptance(
    paths,
    runtime,
    selected,
    project.id,
  );
  const accepted = [];
  for (const { quarantine, snapshot } of acceptancePlan) {
    accepted.push(runtime.acceptCurrentDocument({
      entityType: quarantine.entityType,
      entityId: quarantine.entityId,
      revision: snapshot.revision,
      contentHash: snapshot.contentHash,
      justification: options.justification,
      actor: options.actor ?? "human-recovery",
    }));
  }
  await reconcileProjectDocuments(paths, runtime, { actor: options.actor ?? "reconcile-verify" });
  const remaining = runtime.listQuarantines().map(explainQuarantine);
  return {
    ok: remaining.length === 0,
    health: remaining.length === 0 ? "healthy" : "degraded",
    canProceed: remaining.length === 0,
    accepted,
    unresolved: remaining,
    nextAction: remaining[0]?.action ?? "Ejecuta local-kanban doctor --json para verificar el proyecto.",
  };
}
