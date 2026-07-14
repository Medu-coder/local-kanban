#!/usr/bin/env node

import process from "node:process";
import { randomUUID } from "node:crypto";

import { doctorProject, transitionStoryCommand, validateProjectDocuments } from "../core/commands.js";
import { DomainError } from "../core/errors.js";
import { getRegisteredProject, initializeProject } from "../core/project.js";
import {
  blockStoryWorkflow,
  checkpointStoryWorkflow,
  checkStoryWorkflow,
  claimStoryWorkflow,
  completeStoryWorkflow,
  createEpicWorkflow,
  createStoryWorkflow,
  nextStoriesCommand,
  prepareStoryWorktreeWorkflow,
  removeStoryWorktreeWorkflow,
  releaseStoryWorkflow,
  resolveBlockWorkflow,
  showStoryWorkflow,
  validateStoryWorkflow,
} from "../core/workflow-commands.js";

const help = `Local Kanban

Uso:
  local-kanban init [--id ID] [--name NAME] [--docs-path PATH] [--json]
    ID: slug minúsculo de 1-50 caracteres ([a-z0-9], guiones internos permitidos)
  local-kanban create-epic EPI-ID --title TEXT --objective TEXT [--labels a,b] [--json]
  local-kanban create-story STO-ID --title TEXT --objective TEXT --acceptance a,b
    --validation COMMAND[,COMMAND] --context FILE[,FILE] [--scope a,b] [--subtasks a,b]
    [--epic EPI-ID] [--hard STO-ID,...] [--related STO-ID,...]
    [--priority low|medium|high] [--risk standard|high] [--rank N] [--json]
  local-kanban next [--limit N] [--json]
  local-kanban show STORY_ID [--json]
  local-kanban claim STORY_ID [--agent AGENT] [--session-id ID] [--json]
  local-kanban checkpoint STORY_ID --attempt-id ID --fencing-token N --summary TEXT
    [--next-action TEXT] [--files a,b] [--tests a,b] [--actor ACTOR] [--json]
  local-kanban block STORY_ID --attempt-id ID --fencing-token N --type TYPE
    --description TEXT --owner OWNER --action TEXT --resume-condition TEXT
    [--evidence TEXT] [--actor ACTOR] [--json]
  local-kanban resolve STORY_ID --attempt-id ID --fencing-token N --block-id ID [--json]
  local-kanban check STORY_ID --attempt-id ID --fencing-token N
    (--criterion ID | --subtask ID) [--json]
  local-kanban worktree STORY_ID --attempt-id ID --fencing-token N [--base-commit REF] [--json]
  local-kanban worktree-remove STORY_ID --attempt-id ID [--fencing-token N]
    [--delete-branch] [--json]
  local-kanban release STORY_ID --attempt-id ID --fencing-token N
    [--outcome released|failed|abandoned|stale] [--json]
  local-kanban validate [STORY_ID --attempt-id ID --fencing-token N]
    [--commit REF] [--evidence-type TYPE] [--summary TEXT] [--actor ACTOR] [--json]
  local-kanban complete STORY_ID --attempt-id ID --fencing-token N
    --role orchestrator [--actor ACTOR] [--json]
  local-kanban doctor [--json]
  local-kanban transition STORY_ID --status STATUS --expected-revision N
    [--epic EPI_ID|none] [--actor ACTOR] [--role orchestrator|specialist]
    [--idempotency-key KEY] [--json]
  local-kanban --help
`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { _: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
    } else if (rest[index + 1] && !rest[index + 1].startsWith("--")) {
      options[key] = rest[index + 1];
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, options };
}

function output(value, json) {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function commaList(value) {
  if (!value) {
    return [];
  }
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function workflowOptions(options) {
  return {
    cwd: process.cwd(),
    configPath: process.env.KANBAN_CONFIG_PATH,
    actor: options.actor ?? options.agent ?? process.env.CODEX_AGENT_ID ?? "codex",
    agentId: options.agent ?? process.env.CODEX_AGENT_ID,
    attemptId: options.attemptId,
    fencingToken: options.fencingToken,
  };
}

async function run() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || options.help || command === "--help" || command === "-h") {
    console.log(help);
    return;
  }

  if (command === "init") {
    const result = await initializeProject({
      cwd: process.cwd(),
      id: options.id,
      name: options.name,
      docsPath: options.docsPath,
      configPath: process.env.KANBAN_CONFIG_PATH,
    });
    output(result, options.json);
    return;
  }

  if (command === "validate") {
    const storyId = options._[0];
    if (storyId) {
      const result = await validateStoryWorkflow({
        ...workflowOptions(options),
        storyId,
        commit: options.commit,
        evidenceType: options.evidenceType,
        summary: options.summary,
      });
      output(result, options.json);
      return;
    }
    const project = await getRegisteredProject({
      cwd: process.cwd(),
      configPath: process.env.KANBAN_CONFIG_PATH,
    });
    const result = await validateProjectDocuments(project);
    output(result, options.json);
    if (!result.ok) {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "create-epic") {
    const result = await createEpicWorkflow({
      ...workflowOptions(options),
      epicId: options._[0],
      title: options.title,
      objective: options.objective,
      description: options.description,
      labels: commaList(options.labels),
      body: options.body,
      idempotencyKey: options.idempotencyKey,
    });
    output(result, options.json);
    return;
  }

  if (command === "create-story") {
    const rankValue = String(options.rank ?? "");
    const rank = /^\d+$/u.test(rankValue) ? Number(rankValue) : undefined;
    const result = await createStoryWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
      title: options.title,
      objective: options.objective,
      description: options.description,
      acceptance: commaList(options.acceptance),
      validationCommands: commaList(options.validation),
      contextFiles: commaList(options.context),
      scope: commaList(options.scope),
      nonScope: commaList(options.nonScope),
      subtasks: commaList(options.subtasks),
      hardDependencies: commaList(options.hard),
      relatedDependencies: commaList(options.related),
      epic: options.epic,
      priority: options.priority,
      risk: options.risk,
      executionMode: options.executionMode,
      rank,
      body: options.body,
      idempotencyKey: options.idempotencyKey,
    });
    output(result, options.json);
    return;
  }

  if (command === "next") {
    const result = await nextStoriesCommand({
      cwd: process.cwd(),
      configPath: process.env.KANBAN_CONFIG_PATH,
      limit: options.limit,
    });
    output(result, options.json);
    return;
  }

  if (command === "show") {
    const result = await showStoryWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
    });
    output(result, options.json);
    return;
  }

  if (command === "claim") {
    const storyId = options._[0];
    if (!storyId) {
      throw new DomainError("command_invalid", "claim requiere STORY_ID.");
    }
    const result = await claimStoryWorkflow({
      ...workflowOptions(options),
      storyId,
      sessionId: options.sessionId,
    });
    output(result, options.json);
    return;
  }

  if (command === "checkpoint") {
    const storyId = options._[0];
    if (!storyId) {
      throw new DomainError("command_invalid", "checkpoint requiere STORY_ID.");
    }
    const result = await checkpointStoryWorkflow({
      ...workflowOptions(options),
      storyId,
      summary: options.summary,
      nextAction: options.nextAction,
      files: commaList(options.files),
      tests: commaList(options.tests),
    });
    output(result, options.json);
    return;
  }

  if (command === "block") {
    const storyId = options._[0];
    if (!storyId) {
      throw new DomainError("command_invalid", "block requiere STORY_ID.");
    }
    const result = await blockStoryWorkflow({
      ...workflowOptions(options),
      storyId,
      type: options.type,
      description: options.description,
      owner: options.owner,
      action: options.action,
      resumeCondition: options.resumeCondition,
      evidence: options.evidence,
    });
    output(result, options.json);
    return;
  }

  if (command === "resolve") {
    const result = await resolveBlockWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
      blockId: options.blockId,
    });
    output(result, options.json);
    return;
  }

  if (command === "check") {
    const result = await checkStoryWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
      criterionId: options.criterion,
      subtaskId: options.subtask,
      idempotencyKey: options.idempotencyKey,
    });
    output(result, options.json);
    return;
  }

  if (command === "worktree") {
    const result = await prepareStoryWorktreeWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
      baseCommit: options.baseCommit,
    });
    output(result, options.json);
    return;
  }

  if (command === "worktree-remove") {
    const result = await removeStoryWorktreeWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
      deleteBranch: options.deleteBranch,
    });
    output(result, options.json);
    return;
  }

  if (command === "release") {
    const result = await releaseStoryWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
      outcome: options.outcome,
    });
    output(result, options.json);
    return;
  }

  if (command === "complete") {
    const storyId = options._[0];
    if (!storyId) {
      throw new DomainError("command_invalid", "complete requiere STORY_ID.");
    }
    const result = await completeStoryWorkflow({
      ...workflowOptions(options),
      storyId,
      actorRole: options.role,
      summary: options.summary,
    });
    output(result, options.json);
    return;
  }

  if (command === "doctor") {
    const result = await doctorProject({
      cwd: process.cwd(),
      configPath: process.env.KANBAN_CONFIG_PATH,
    });
    output(result, options.json);
    if (!result.ok) {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "transition") {
    const storyId = options._[0];
    const revisionValue = String(options.expectedRevision ?? "");
    const expectedRevision = /^\d+$/u.test(revisionValue) ? Number(revisionValue) : Number.NaN;
    if (!storyId || !options.status || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new DomainError(
        "command_invalid",
        "transition requiere STORY_ID, --status y --expected-revision.",
      );
    }
    const result = await transitionStoryCommand({
      cwd: process.cwd(),
      configPath: process.env.KANBAN_CONFIG_PATH,
      storyId,
      expectedRevision,
      nextStatus: options.status,
      ...(Object.hasOwn(options, "epic") ? { nextEpic: options.epic === "none" ? null : options.epic } : {}),
      actor: options.actor ?? "codex",
      actorRole: options.role ?? "specialist",
      idempotencyKey: options.idempotencyKey ?? randomUUID(),
    });
    output(result, options.json);
    return;
  }

  throw new DomainError("command_unknown", `Comando desconocido: ${command}`, {
    details: {
      available: ["init", "create-epic", "create-story", "next", "show", "claim", "checkpoint", "block", "resolve", "check", "worktree", "worktree-remove", "release", "validate", "complete", "doctor", "transition"],
    },
  });
}

run().catch((error) => {
  const payload = {
    ok: false,
    error: error.code ?? "unexpected_error",
    message: error.message,
    details: error.details ?? null,
  };
  console.error(JSON.stringify(payload));
  process.exitCode = error.status >= 500 ? 1 : 2;
});
