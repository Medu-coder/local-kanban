import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { transitionStoryCommand, validateProjectDocuments } from "./commands.js";
import { buildOperationalCapsule, scheduleStories } from "./coordination.js";
import { DomainError } from "./errors.js";
import { updateStoryCommand } from "./entity-commands.js";
import { resolveProjectPaths } from "./paths.js";
import { getRegisteredProject } from "./project.js";
import { openRuntime } from "./runtime.js";
import { readCanonicalStory } from "./entity-repository.js";
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

function dependencyStatuses(story, stories) {
  const byId = new Map(stories.map((item) => [item.id, item]));
  return Object.fromEntries(
    (story.dependencies ?? [])
      .filter((dependency) => dependency.type === "hard")
      .map((dependency) => [dependency.story_id, byId.get(dependency.story_id)?.status]),
  );
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
      details: { invalid: validation.invalid },
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
    };
  } finally {
    runtime.close();
  }
}

export async function claimStoryWorkflow(options) {
  const { project, paths, story } = await storyContext(options);
  const actor = requireText(options.actor ?? options.agentId ?? "codex", "actor");
  const agentId = requireText(options.agentId ?? actor, "agentId");
  if (story.status !== "backlog" && story.status !== "developing") {
    throw new DomainError("claim_status_invalid", "Solo se puede reclamar una historia en backlog o developing.", {
      details: { storyId: story.id, status: story.status },
      status: 409,
    });
  }
  const runtime = openRuntime(paths.rootPath);
  let claimed;
  try {
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
        nextAction: "execute",
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
    runtime.verifyClaim(envelope);
  } finally {
    runtime.close();
  }

  const commit = await gitCommit(paths.rootPath, options.commit);
  const commands = story.validation.commands;
  const results = [];
  for (const command of commands) {
    results.push(await executeValidationCommand(command, paths.rootPath));
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
  } finally {
    runtime.close();
  }
  const result = await transitionStoryCommand({
    project,
    storyId: story.id,
    expectedRevision: story.revision,
    nextStatus: "done",
    actor: envelope.actor,
    actorRole: "orchestrator",
    idempotencyKey: randomUUID(),
  });
  const releaseRuntime = openRuntime(paths.rootPath);
  try {
    const released = releaseRuntime.releaseClaim({ ...envelope, outcome: "completed" });
    return { ...result, released };
  } finally {
    releaseRuntime.close();
  }
}
