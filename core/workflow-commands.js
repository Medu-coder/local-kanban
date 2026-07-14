import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { transitionStoryCommand, validateProjectDocuments } from "./commands.js";
import { buildOperationalCapsule, scheduleStories } from "./coordination.js";
import { explainQuarantine } from "./degradation.js";
import { DomainError } from "./errors.js";
import {
  createEpicCommand,
  createStoryCommand,
  toggleStoryCriterionCommand,
  toggleStorySubtaskCommand,
  updateStoryCommand,
} from "./entity-commands.js";
import { prepareWorktree, removeWorktree } from "./git.js";
import { resolveProjectPaths } from "./paths.js";
import { getRegisteredProject } from "./project.js";
import { openRuntime } from "./runtime.js";
import { readCanonicalStory } from "./entity-repository.js";
import { reconcileProjectDocuments } from "./reconciliation.js";
import { evaluateStoryGates } from "./story.js";

const execFileAsync = promisify(execFile);

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new DomainError("command_invalid", `${field} es obligatorio.`, {
      details: { field },
      status: 400,
    });
  }
  return normalized;
}

function claimEnvelope(options) {
  const fencingToken = Number(options.fencingToken);
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw new DomainError("command_invalid", "fencingToken debe ser un entero positivo.", {
      details: { fencingToken: options.fencingToken },
      status: 400,
    });
  }
  return {
    storyId: requireText(options.storyId, "storyId"),
    attemptId: requireText(options.attemptId, "attemptId"),
    fencingToken,
    actor: requireText(options.actor ?? options.agentId ?? "codex", "actor"),
  };
}

async function context(options) {
  const project = options.project ?? (await getRegisteredProject(options));
  const paths = await resolveProjectPaths(project);
  return { project, paths };
}

async function storyContext(options) {
  const resolved = await context(options);
  const current = await readCanonicalStory(resolved.paths, options.storyId);
  if (current.entity.project !== resolved.project.id) {
    throw new DomainError("project_mismatch", "La historia pertenece a otro proyecto.", {
      details: { storyId: current.entity.id, projectId: resolved.project.id },
      status: 409,
    });
  }
  return { ...resolved, story: current.entity };
}

async function runtimeDegradations(project, paths, runtime, actor) {
  await reconcileProjectDocuments(paths, runtime, { actor });
  const quarantineIssues = runtime.listQuarantines().map(explainQuarantine);
  const operationIssues = runtime.listProblemOperations().map((operation) => ({
    id: `operation:${operation.id}`,
    severity: "fail",
    code: `operation_${operation.status}`,
    scope: operation.entity_type,
    entityType: operation.entity_type,
    entityId: operation.entity_id,
    summary: `La operación durable ${operation.id} está ${operation.status}.`,
    cause: operation.error ?? "La escritura no alcanzó un estado terminal verificable.",
    impact: "Las mutaciones quedan bloqueadas para evitar perder o duplicar una escritura.",
    action: "Ejecuta doctor y revisa recovery antes de continuar.",
    command: "local-kanban doctor --json",
    verification: "La operación deja de estar pending/quarantined y doctor devuelve healthy.",
    details: operation,
  }));
  return [...quarantineIssues, ...operationIssues];
}

function assertRuntimeReady(issues) {
  if (issues.length > 0) {
    throw new DomainError(
      "project_degraded",
      "El proyecto tiene degradaciones que bloquean el flujo agéntico.",
      {
        details: {
          canProceed: false,
          degradations: issues,
          nextAction: issues[0].action,
          command: issues[0].command,
        },
        status: 409,
      },
    );
  }
}

function dependencyStatuses(story, stories) {
  const byId = new Map(stories.map((item) => [item.id, item]));
  return Object.fromEntries(
    (story.dependencies ?? [])
      .filter((dependency) => dependency.type === "hard")
      .map((dependency) => [dependency.story_id, byId.get(dependency.story_id)?.status]),
  );
}

function slug(value, fallback) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 50) || fallback;
}

function uniqueItems(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

const workflowPriority = Object.freeze({ high: 0, medium: 1, low: 2 });

function workflowOrder(left, right) {
  const rank = (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
  if (rank !== 0) return rank;
  const priority = (workflowPriority[left.priority] ?? 1) - (workflowPriority[right.priority] ?? 1);
  return priority || left.id.localeCompare(right.id);
}

export async function createStoryWorkflow(options) {
  const { project } = await context(options);
  const id = requireText(options.storyId, "storyId");
  const title = requireText(options.title, "title");
  const objective = requireText(options.objective, "objective");
  const acceptance = uniqueItems(options.acceptance);
  const validationCommands = uniqueItems(options.validationCommands);
  const contextFiles = uniqueItems(options.contextFiles);
  if (acceptance.length === 0 || validationCommands.length === 0 || contextFiles.length === 0) {
    throw new DomainError(
      "definition_of_ready_incomplete",
      "create-story exige aceptación, validación y contexto.",
      { details: { acceptance: acceptance.length, validation: validationCommands.length, context: contextFiles.length }, status: 400 },
    );
  }
  const dependencies = [
    ...uniqueItems(options.hardDependencies).map((storyId) => ({ story_id: storyId, type: "hard" })),
    ...uniqueItems(options.relatedDependencies).map((storyId) => ({ story_id: storyId, type: "related" })),
  ];
  const story = {
    schema_version: 1,
    revision: 1,
    id,
    type: "story",
    project: project.id,
    title,
    objective,
    ...(options.description ? { description: String(options.description).trim() } : {}),
    scope: uniqueItems(options.scope),
    non_scope: uniqueItems(options.nonScope),
    epic: options.epic ?? null,
    status: "backlog",
    priority: options.priority ?? "medium",
    risk: options.risk ?? "standard",
    ...(Number.isSafeInteger(options.rank) ? { rank: options.rank } : {}),
    execution_mode: options.executionMode ?? "agent",
    acceptance_criteria: acceptance.map((label, index) => ({
      id: slug(label, `acceptance-${index + 1}`),
      label,
      kind: "manual",
      checked: false,
    })),
    readiness_criteria: [],
    dependencies,
    context_files: contextFiles,
    validation: { commands: validationCommands },
    subtasks: uniqueItems(options.subtasks).map((subtask, index) => ({
      id: slug(subtask, `subtask-${index + 1}`),
      title: subtask,
      done: false,
    })),
  };
  return createStoryCommand({
    project,
    story,
    body: options.body ?? "",
    expectedRevision: 0,
    actor: options.actor ?? "codex",
    idempotencyKey: options.idempotencyKey ?? randomUUID(),
  });
}

export async function createEpicWorkflow(options) {
  const { project } = await context(options);
  const title = requireText(options.title, "title");
  const epic = {
    schema_version: 1,
    revision: 1,
    id: requireText(options.epicId, "epicId"),
    type: "epic",
    project: project.id,
    title,
    objective: requireText(options.objective, "objective"),
    ...(options.description ? { description: String(options.description).trim() } : {}),
    labels: uniqueItems(options.labels),
  };
  return createEpicCommand({
    project,
    epic,
    body: options.body ?? "",
    expectedRevision: 0,
    actor: options.actor ?? "codex",
    idempotencyKey: options.idempotencyKey ?? randomUUID(),
  });
}

export async function showStoryWorkflow(options) {
  const { project, paths, story } = await storyContext(options);
  const runtime = openRuntime(paths.rootPath);
  try {
    const issues = await runtimeDegradations(project, paths, runtime, "show-preflight");
    const capsule = buildOperationalCapsule({
      story,
      coordination: runtime.getCoordinationState(story.id),
      gates: await currentGates(project, story),
    });
    const relevantIssues = issues.filter(
      (issue) => !issue.entityId || issue.entityId === story.id || issue.scope === "project",
    );
    return {
      ...capsule,
      canProceed: relevantIssues.length === 0 && capsule.guidance.canProceed,
      degradations: relevantIssues,
      ...(relevantIssues.length > 0
        ? {
            nextAction: relevantIssues[0].action,
            guidance: {
              summary: relevantIssues[0].action,
              command: relevantIssues[0].command,
              why: relevantIssues[0].impact,
              authority: "orchestrator",
              canProceed: false,
            },
          }
        : {}),
    };
  } finally {
    runtime.close();
  }
}

async function currentGates(project, story) {
  const validation = await validateProjectDocuments(project);
  return evaluateStoryGates(story, dependencyStatuses(story, validation.stories));
}

export async function nextStoriesCommand(options = {}) {
  const project = options.project ?? (await getRegisteredProject(options));
  const validation = await validateProjectDocuments(project);
  if (!validation.ok) {
    throw new DomainError("project_invalid", "El proyecto contiene documentos inválidos.", {
      details: {
        invalid: validation.invalid,
        canProceed: false,
        nextAction: "Corrige los documentos señalados y ejecuta local-kanban validate --json.",
        command: "local-kanban validate --json",
      },
      status: 409,
    });
  }
  const limit = Number(options.limit ?? 1);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new DomainError("command_invalid", "limit debe estar entre 1 y 100.", { status: 400 });
  }
  const paths = await resolveProjectPaths(project);
  const runtime = openRuntime(paths.rootPath);
  try {
    assertRuntimeReady(await runtimeDegradations(project, paths, runtime, "next-preflight"));
    const coordination = new Map(
      validation.stories.map((story) => [story.id, runtime.getCoordinationState(story.id)]),
    );
    const held = [...coordination.entries()]
      .filter(([, state]) => state.claim)
      .map(([storyId]) => storyId);
    const selected = scheduleStories(validation.stories, {
      claimedStoryIds: held,
      activeCount: held.length,
      wipLimit: held.length + limit,
    });
    const verificationAll = validation.stories
      .filter((story) => {
        const state = coordination.get(story.id);
        return story.status === "testing" && state.claim?.status !== "stale";
      })
      .sort(workflowOrder)
      .map((story) => {
        const state = coordination.get(story.id);
        const nextAction = state.claim
          ? story.risk === "high"
            ? `release active claim for ${story.id} before independent review`
            : `complete ${story.id} using active handoff`
          : story.risk === "high"
            ? `claim ${story.id} as independent verifier`
            : `claim ${story.id} as orchestrator`;
        return buildOperationalCapsule({
          story,
          coordination: state,
          gates: evaluateStoryGates(story, dependencyStatuses(story, validation.stories)),
          nextAction,
        });
      });
    const attentionAll = validation.stories
      .filter((story) => {
        const state = coordination.get(story.id);
        return state.claim?.status === "stale" || state.blocks.length > 0 ||
          (story.status === "developing" && !state.claim);
      })
      .sort(workflowOrder)
      .map((story) => {
        const state = coordination.get(story.id);
        const nextAction = state.claim?.status === "stale"
          ? `reconcile and release stale claim for ${story.id}`
          : state.blocks.length > 0
            ? `${state.claim ? "resolve" : `claim ${story.id} to resolve`} ${state.blocks.length} block(s)`
            : `claim ${story.id} to resume`;
        return buildOperationalCapsule({
          story,
          coordination: state,
          gates: evaluateStoryGates(story, dependencyStatuses(story, validation.stories)),
          nextAction,
        });
      });
    const activeAll = validation.stories
      .filter((story) => coordination.get(story.id).claim?.status !== "stale")
      .sort(workflowOrder)
      .map((story) => buildOperationalCapsule({
        story,
        coordination: coordination.get(story.id),
        gates: evaluateStoryGates(story, dependencyStatuses(story, validation.stories)),
      }));
    const visibleIds = new Set([
      ...selected.map((item) => item.story.id),
      ...verificationAll.map((item) => item.story.id),
      ...attentionAll.map((item) => item.story.id),
      ...activeAll.map((item) => item.story.id),
    ]);
    const deferredAll = validation.stories
      .filter((story) => story.status !== "done" && !visibleIds.has(story.id))
      .sort(workflowOrder)
      .map((story) => buildOperationalCapsule({
        story,
        coordination: coordination.get(story.id),
        gates: evaluateStoryGates(story, dependencyStatuses(story, validation.stories)),
      }));
    const page = (items) => ({
      total: items.length,
      returned: Math.min(items.length, limit),
      hasMore: items.length > limit,
      items: items.slice(0, limit),
    });
    const verificationPage = page(verificationAll);
    const attentionPage = page(attentionAll);
    const activePage = page(activeAll);
    const deferredPage = page(deferredAll);
    return {
      count: selected.length,
      stories: selected.map(({ story, unlockCount, whyReady }) => ({
        ...buildOperationalCapsule({
          story,
          coordination: coordination.get(story.id),
          gates: evaluateStoryGates(story, dependencyStatuses(story, validation.stories)),
          nextAction: `claim ${story.id}`,
        }),
        scheduling: { unlockCount, whyReady },
      })),
      verificationCount: verificationPage.total,
      verification: verificationPage.items,
      verificationPage,
      attentionCount: attentionPage.total,
      attention: attentionPage.items,
      attentionPage,
      activeCount: activePage.total,
      active: activePage.items,
      activePage,
      deferredCount: deferredPage.total,
      deferred: deferredPage.items,
      deferredPage,
      summary: {
        implementation: selected.length,
        verification: verificationPage.total,
        attention: attentionPage.total,
        active: activePage.total,
        deferred: deferredPage.total,
        nextAction: selected[0]
          ? `local-kanban claim ${selected[0].story.id} --agent AGENT_ID --json`
          : attentionPage.items[0]?.guidance.command
            ?? verificationPage.items[0]?.guidance.command
            ?? activePage.items[0]?.guidance.command
            ?? deferredPage.items[0]?.guidance.command
            ?? "No hay trabajo pendiente.",
      },
    };
  } finally {
    runtime.close();
  }
}

export async function claimStoryWorkflow(options) {
  const { project, paths, story } = await storyContext(options);
  const actor = requireText(options.actor ?? options.agentId ?? "codex", "actor");
  const agentId = requireText(options.agentId ?? actor, "agentId");
  if (!["backlog", "developing", "testing"].includes(story.status)) {
    throw new DomainError("claim_status_invalid", "Solo se puede reclamar una historia ejecutable o en verificación.", {
      details: { storyId: story.id, status: story.status },
      status: 409,
    });
  }
  const runtime = openRuntime(paths.rootPath);
  let claimed;
  try {
    assertRuntimeReady(await runtimeDegradations(project, paths, runtime, "claim-preflight"));
    claimed = runtime.claimStory({
      storyId: story.id,
      agentId,
      actor,
      attemptId: options.attemptId ?? randomUUID(),
      sessionId: options.sessionId,
    });
  } finally {
    runtime.close();
  }

  try {
    let currentStory = story;
    if (story.status === "backlog") {
      await transitionStoryCommand({
        project,
        storyId: story.id,
        expectedRevision: story.revision,
        nextStatus: "developing",
        actor,
        actorRole: "specialist",
        idempotencyKey: randomUUID(),
      });
      currentStory = (await readCanonicalStory(paths, story.id)).entity;
    }
    const currentRuntime = openRuntime(paths.rootPath);
    try {
      return buildOperationalCapsule({
        story: currentStory,
        coordination: currentRuntime.getCoordinationState(story.id),
        gates: await currentGates(project, currentStory),
        nextAction: currentStory.status === "testing"
          ? (currentStory.risk === "high" ? "independent_review" : "integrated_verification")
          : "execute",
      });
    } finally {
      currentRuntime.close();
    }
  } catch (error) {
    const rollbackRuntime = openRuntime(paths.rootPath);
    try {
      rollbackRuntime.releaseClaim({
        storyId: story.id,
        attemptId: claimed.attempt.id,
        fencingToken: claimed.claim.fencingToken,
        actor,
        outcome: "failed",
      });
    } finally {
      rollbackRuntime.close();
    }
    throw error;
  }
}

export async function checkpointStoryWorkflow(options) {
  const { paths } = await storyContext(options);
  const runtime = openRuntime(paths.rootPath);
  try {
    return runtime.recordCheckpoint({
      ...claimEnvelope(options),
      summary: requireText(options.summary, "summary"),
      payload: {
        ...(options.nextAction ? { nextAction: options.nextAction } : {}),
        files: options.files ?? [],
        tests: options.tests ?? [],
      },
    });
  } finally {
    runtime.close();
  }
}

export async function blockStoryWorkflow(options) {
  const { paths } = await storyContext(options);
  const runtime = openRuntime(paths.rootPath);
  try {
    return runtime.addBlock({
      ...claimEnvelope(options),
      type: requireText(options.type, "type"),
      description: requireText(options.description, "description"),
      owner: requireText(options.owner, "owner"),
      action: requireText(options.action, "action"),
      resumeCondition: requireText(options.resumeCondition, "resumeCondition"),
      evidence: options.evidence,
    });
  } finally {
    runtime.close();
  }
}

export async function resolveBlockWorkflow(options) {
  const { paths } = await storyContext(options);
  const runtime = openRuntime(paths.rootPath);
  try {
    return runtime.resolveBlock({
      ...claimEnvelope(options),
      blockId: requireText(options.blockId, "blockId"),
      resolution: requireText(options.resolution, "resolution"),
      evidence: options.evidence,
    });
  } finally {
    runtime.close();
  }
}

export async function releaseStoryWorkflow(options) {
  const { paths, story } = await storyContext(options);
  const runtime = openRuntime(paths.rootPath);
  try {
    const outcome = options.outcome ?? "released";
    const state = runtime.getCoordinationState(options.storyId);
    const checkpointIsCurrent = state.checkpoint?.attemptId === options.attemptId;
    const currentEvidence = (story.evidence ?? []).filter(
      (item) => item.attempt_id === options.attemptId,
    );
    const evidenceIsCurrent = currentEvidence.length > 0;
    const summary = String(options.summary ?? "").trim();
    const nextAction = String(options.nextAction ?? "").trim();
    if (
      !["completed", "stale"].includes(outcome) &&
      !checkpointIsCurrent &&
      !evidenceIsCurrent &&
      (!summary || !nextAction)
    ) {
      throw new DomainError(
        "handoff_required",
        "release exige un checkpoint vigente o --summary y --next-action.",
        {
          details: {
            storyId: options.storyId,
            attemptId: options.attemptId,
            nextAction: "Registra un checkpoint o repite release con un handoff explícito.",
            command: `local-kanban checkpoint ${options.storyId} --attempt-id ${options.attemptId} --fencing-token ${options.fencingToken} --summary \"...\" --next-action \"...\" --json`,
          },
          status: 409,
        },
      );
    }
    return runtime.releaseClaim({
      ...claimEnvelope(options),
      outcome,
      summary: summary || state.checkpoint?.summary || currentEvidence.at(-1)?.summary,
      nextAction: nextAction || state.checkpoint?.payload?.nextAction ||
        (story.status === "testing"
          ? (story.risk === "high" ? `claim ${story.id} as independent verifier` : `claim ${story.id} as orchestrator`)
          : `claim ${story.id} to resume`),
    });
  } finally {
    runtime.close();
  }
}

export async function checkStoryWorkflow(options) {
  const envelope = claimEnvelope(options);
  const { project, paths, story } = await storyContext(options);
  const runtime = openRuntime(paths.rootPath);
  try {
    runtime.renewClaim(envelope);
  } finally {
    runtime.close();
  }
  if (Boolean(options.criterionId) === Boolean(options.subtaskId)) {
    throw new DomainError("command_invalid", "check exige exactamente --criterion o --subtask.", {
      status: 400,
    });
  }
  const common = {
    project,
    storyId: story.id,
    expectedRevision: story.revision,
    actor: envelope.actor,
    idempotencyKey: options.idempotencyKey ?? randomUUID(),
  };
  if (options.criterionId) {
    const criterion = story.acceptance_criteria.find((item) => item.id === options.criterionId);
    if (criterion?.checked === true) {
      return { storyId: story.id, revision: story.revision, changed: false, criterion };
    }
    return toggleStoryCriterionCommand({
      ...common,
      criteriaType: "acceptance",
      criterionId: options.criterionId,
    });
  }
  const subtask = (story.subtasks ?? []).find((item) => item.id === options.subtaskId);
  if (subtask?.done === true) {
    return { storyId: story.id, revision: story.revision, changed: false, subtask };
  }
  return toggleStorySubtaskCommand({ ...common, subtaskId: options.subtaskId });
}

export async function prepareStoryWorktreeWorkflow(options) {
  const envelope = claimEnvelope(options);
  const { paths } = await storyContext(options);
  const runtime = openRuntime(paths.rootPath);
  try {
    runtime.renewClaim(envelope);
  } finally {
    runtime.close();
  }
  return prepareWorktree({
    rootPath: paths.rootPath,
    storyId: envelope.storyId,
    attemptId: envelope.attemptId,
    baseCommit: options.baseCommit ?? "HEAD",
  });
}

export async function removeStoryWorktreeWorkflow(options) {
  const { paths } = await storyContext(options);
  const attemptId = requireText(options.attemptId, "attemptId");
  const runtime = openRuntime(paths.rootPath);
  try {
    const state = runtime.getCoordinationState(options.storyId);
    if (state.claim) {
      if (state.claim.attemptId !== attemptId) {
        throw new DomainError("claim_owned_by_other", "El worktree pertenece a otro intento activo.", {
          status: 409,
        });
      }
      runtime.verifyClaim(claimEnvelope(options));
    }
  } finally {
    runtime.close();
  }
  return removeWorktree({
    rootPath: paths.rootPath,
    storyId: options.storyId,
    attemptId,
    deleteBranch: Boolean(options.deleteBranch),
  });
}

async function gitCommit(rootPath, requestedCommit) {
  const ref = requestedCommit ?? "HEAD";
  try {
    const { stdout } = await execFileAsync("git", ["-C", rootPath, "rev-parse", "--verify", `${ref}^{commit}`]);
    return stdout.trim();
  } catch (error) {
    throw new DomainError("git_commit_invalid", "No se pudo resolver el commit de la evidencia.", {
      details: { ref, stderr: String(error.stderr ?? "").trim() },
      status: 409,
    });
  }
}

async function executeValidationCommand(command, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-lc", command], {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { command, exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    throw new DomainError("validation_failed", "La validación de la historia ha fallado.", {
      details: {
        command,
        exitCode: error.code ?? 1,
        stdout: String(error.stdout ?? "").trim().slice(-4000),
        stderr: String(error.stderr ?? "").trim().slice(-4000),
      },
      status: 409,
    });
  }
}

async function executionRoot(options, projectRoot) {
  const requested = await fs.realpath(options.cwd ?? projectRoot);
  const canonicalProject = await fs.realpath(projectRoot);
  if (requested === canonicalProject) return canonicalProject;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", requested, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    );
    const commonDir = await fs.realpath(stdout.trim());
    if (path.basename(commonDir) === ".git" && path.dirname(commonDir) === canonicalProject) {
      return requested;
    }
  } catch {
    // Convert any Git/path failure into a scoped domain error below.
  }
  throw new DomainError("worktree_mismatch", "El checkout actual no pertenece al proyecto registrado.", {
    details: { requested, projectRoot: canonicalProject },
    status: 409,
  });
}

export async function validateStoryWorkflow(options) {
  const envelope = claimEnvelope(options);
  const { project, paths, story } = await storyContext(options);
  if (story.status !== "developing" && story.status !== "testing") {
    throw new DomainError("validation_status_invalid", "La historia debe estar en developing o testing.", {
      details: { storyId: story.id, status: story.status },
      status: 409,
    });
  }
  const runtime = openRuntime(paths.rootPath);
  try {
    runtime.renewClaim(envelope);
  } finally {
    runtime.close();
  }

  const validationRoot = await executionRoot(options, paths.rootPath);
  const commit = await gitCommit(validationRoot, options.commit);
  const commands = story.validation.commands;
  const results = [];
  for (const command of commands) {
    try {
      results.push(await executeValidationCommand(command, validationRoot));
    } catch (error) {
      const failedRuntime = openRuntime(paths.rootPath);
      try {
        failedRuntime.appendAudit({
          eventType: "validation_failed",
          entityType: "story",
          entityId: story.id,
          actor: envelope.actor,
          payload: {
            attemptId: envelope.attemptId,
            command,
            error: error.details ?? { message: error.message },
            nextAction: "Corregir el fallo, registrar checkpoint y repetir local-kanban validate.",
          },
          createdAt: new Date().toISOString(),
        });
      } finally {
        failedRuntime.close();
      }
      throw error;
    }
  }
  const recordedAt = new Date().toISOString();
  const evidence = results.map((result) => ({
    id: `evidence-${randomUUID()}`,
    type: options.evidenceType ?? "test",
    story_id: story.id,
    attempt_id: envelope.attemptId,
    commit,
    command: result.command,
    exit_code: result.exitCode,
    summary: options.summary ?? `Validación superada: ${result.command}`,
    recorded_at: recordedAt,
    actor: envelope.actor,
  }));
  const updated = await updateStoryCommand({
    project,
    storyId: story.id,
    expectedRevision: story.revision,
    patch: { evidence: [...(story.evidence ?? []), ...evidence], updated_at: recordedAt },
    actor: envelope.actor,
    idempotencyKey: randomUUID(),
  });
  let transitioned = updated.story;
  if (updated.story.status === "developing") {
    await transitionStoryCommand({
      project,
      storyId: story.id,
      expectedRevision: updated.story.revision,
      nextStatus: "testing",
      actor: envelope.actor,
      actorRole: "specialist",
      idempotencyKey: randomUUID(),
    });
    transitioned = (await readCanonicalStory(paths, story.id)).entity;
  }
  const statusRuntime = openRuntime(paths.rootPath);
  let coordination;
  try {
    statusRuntime.setOperationalStatus({ ...envelope, operationalStatus: "verifying" });
    coordination = statusRuntime.getCoordinationState(story.id);
  } finally {
    statusRuntime.close();
  }
  return {
    capsule: buildOperationalCapsule({
      story: transitioned,
      coordination,
      gates: await currentGates(project, transitioned),
      nextAction: "orchestrator complete",
    }),
    evidence,
    results,
  };
}

export async function completeStoryWorkflow(options) {
  if (options.actorRole !== "orchestrator") {
    throw new DomainError("orchestrator_required", "complete exige --role orchestrator.", {
      status: 403,
    });
  }
  const envelope = claimEnvelope(options);
  const { project, paths, story } = await storyContext(options);
  if (story.status !== "testing") {
    throw new DomainError("completion_status_invalid", "complete exige una entrega previa en testing.", {
      details: { storyId: story.id, status: story.status },
      status: 409,
    });
  }
  const runtime = openRuntime(paths.rootPath);
  try {
    const coordination = runtime.getCoordinationState(story.id);
    runtime.verifyClaim(envelope);
    if (coordination.blocks.length > 0) {
      throw new DomainError("completion_incomplete", "La historia mantiene bloqueos operativos.", {
        details: { blockers: coordination.blocks.map((block) => block.id) },
        status: 409,
      });
    }
    const gates = await currentGates(project, story);
    if (!gates.isDone) {
      throw new DomainError("completion_incomplete", "La historia no cumple su Definition of Done.", {
        details: {
          pendingDependencies: gates.pendingDependencies,
          pendingCriteria: gates.pendingAcceptance,
          pendingSubtasks: gates.pendingSubtasks,
          blockers: gates.activeBlockers,
          evidenceRequired: !gates.hasEvidence,
          reviewRequired: story.risk === "high" && !gates.hasIndependentReview,
        },
        status: 409,
      });
    }
  } finally {
    runtime.close();
  }
  const integratedValidation = await validateStoryWorkflow({
    ...options,
    project,
    cwd: paths.rootPath,
    actor: envelope.actor,
    summary: options.summary ?? "Validación integrada superada por el orquestador.",
  });
  const integratedStory = (await readCanonicalStory(paths, story.id)).entity;
  const result = await transitionStoryCommand({
    project,
    storyId: story.id,
    expectedRevision: integratedStory.revision,
    nextStatus: "done",
    actor: envelope.actor,
    actorRole: "orchestrator",
    idempotencyKey: randomUUID(),
  });
  const releaseRuntime = openRuntime(paths.rootPath);
  try {
    const released = releaseRuntime.releaseClaim({ ...envelope, outcome: "completed" });
    return { ...result, integratedValidation: integratedValidation.evidence, released };
  } finally {
    releaseRuntime.close();
  }
}
