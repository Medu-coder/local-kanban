#!/usr/bin/env node

import process from "node:process";

import {
  doctorProject,
  migrateLegacyProjectCommand,
  reconcileProjectCommand,
  validateProjectDocuments,
} from "../core/commands.js";
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
    [--validation COMMAND[,COMMAND]] [--validation-command COMMAND]... --context FILE[,FILE]
    Al menos una forma de validación es obligatoria; ambas se pueden combinar.
    [--scope a,b] [--subtasks a,b]
    [--epic EPI-ID] [--hard STO-ID,...] [--related STO-ID,...]
    [--priority low|medium|high] [--risk standard|high]
    [--execution-mode human|agent|hybrid]
    [--story-type feature|bug|tech_debt|research|chore] [--rank N] [--json]
    Defaults: priority=medium, risk=standard, execution-mode=agent, story-type=feature
    Para spikes exploratorios usar --story-type research.
  local-kanban next [--limit N] [--json]
  local-kanban show STORY_ID [--json]
  local-kanban claim STORY_ID [--agent AGENT] [--session-id ID] [--json]
  local-kanban checkpoint STORY_ID --attempt-id ID --fencing-token N --summary TEXT
    [--next-action TEXT] [--files a,b] [--tests a,b] [--actor ACTOR] [--json]
  local-kanban block STORY_ID --attempt-id ID --fencing-token N --type TYPE
    --description TEXT --owner OWNER --action TEXT --resume-condition TEXT
    [--evidence TEXT] [--actor ACTOR] [--json]
  local-kanban resolve STORY_ID --attempt-id ID --fencing-token N --block-id ID
    --resolution TEXT [--evidence TEXT] [--json]
  local-kanban check STORY_ID --attempt-id ID --fencing-token N
    (--criterion ID | --subtask ID) [--json]
  local-kanban worktree STORY_ID --attempt-id ID --fencing-token N [--base-commit REF] [--json]
  local-kanban worktree-remove STORY_ID --attempt-id ID [--fencing-token N]
    [--delete-branch] [--json]
  local-kanban release STORY_ID --attempt-id ID --fencing-token N
    [--outcome released|failed|abandoned|stale] [--summary TEXT --next-action TEXT] [--json]
  local-kanban validate [STORY_ID --attempt-id ID --fencing-token N]
    [--commit REF] [--evidence-type TYPE] [--summary TEXT] [--actor ACTOR] [--json]
  local-kanban complete STORY_ID --attempt-id ID --fencing-token N
    --role orchestrator [--actor ACTOR] [--json]
  local-kanban doctor [--json]
  local-kanban reconcile [ENTITY_ID|--all] [--accept-current --reason TEXT] [--json]
  local-kanban migrate-legacy
    [--validation COMMAND[,COMMAND]] [--validation-command COMMAND]... --risk standard|high
    --reason TEXT [--apply] [--json]
  local-kanban --help
`;

const knownOptions = new Set([
  "help", "json", "id", "name", "docsPath", "title", "objective", "description", "labels", "body",
  "idempotencyKey", "acceptance", "validation", "validationCommand", "context", "scope", "nonScope",
  "subtasks", "epic", "hard", "related", "priority", "risk", "executionMode", "storyType", "rank", "limit",
  "agent", "sessionId", "attemptId", "fencingToken", "summary", "nextAction", "files", "tests", "actor",
  "type", "owner", "action", "resumeCondition", "evidence", "blockId", "resolution", "criterion", "subtask", "baseCommit",
  "deleteBranch", "outcome", "commit", "evidenceType", "role", "all", "acceptCurrent", "reason", "apply",
]);
const booleanOptions = new Set(["help", "json", "deleteBranch", "all", "acceptCurrent", "apply"]);

const commandOptions = Object.freeze({
  init: ["id", "name", "docsPath"],
  "create-epic": ["title", "objective", "description", "labels", "body", "idempotencyKey", "actor"],
  "create-story": [
    "title", "objective", "description", "acceptance", "validation", "validationCommand", "context", "scope",
    "nonScope", "subtasks", "epic", "hard", "related", "priority", "risk", "executionMode", "storyType", "rank",
    "body", "idempotencyKey", "actor",
  ],
  next: ["limit"],
  show: [],
  claim: ["agent", "sessionId", "actor"],
  checkpoint: ["attemptId", "fencingToken", "summary", "nextAction", "files", "tests", "actor", "agent"],
  block: ["attemptId", "fencingToken", "type", "description", "owner", "action", "resumeCondition", "evidence", "actor", "agent"],
  resolve: ["attemptId", "fencingToken", "blockId", "resolution", "evidence", "actor", "agent"],
  check: ["attemptId", "fencingToken", "criterion", "subtask", "idempotencyKey", "actor", "agent"],
  worktree: ["attemptId", "fencingToken", "baseCommit", "actor", "agent"],
  "worktree-remove": ["attemptId", "fencingToken", "deleteBranch", "actor", "agent"],
  release: ["attemptId", "fencingToken", "outcome", "summary", "nextAction", "actor", "agent"],
  validate: ["attemptId", "fencingToken", "commit", "evidenceType", "summary", "actor", "agent"],
  complete: ["attemptId", "fencingToken", "role", "summary", "actor", "agent"],
  doctor: [],
  reconcile: ["all", "acceptCurrent", "reason", "actor"],
  "migrate-legacy": ["validation", "validationCommand", "risk", "reason", "apply"],
});

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
    if (!knownOptions.has(key)) {
      throw new DomainError("option_unknown", `Opción desconocida: --${rawKey}.`, {
        details: { option: rawKey },
        status: 400,
      });
    }
    let value;
    if (booleanOptions.has(key)) {
      if (inlineValue !== undefined && !["true", "false"].includes(inlineValue)) {
        throw new DomainError("option_invalid", `--${rawKey} solo admite true o false.`, {
          details: { option: rawKey, received: inlineValue, allowed: ["true", "false"] },
          status: 400,
        });
      }
      value = inlineValue === undefined ? true : inlineValue === "true";
    } else if (inlineValue !== undefined) {
      if (!inlineValue.trim()) {
        throw new DomainError("option_value_missing", `--${rawKey} exige un valor.`, {
          details: { option: rawKey },
          status: 400,
        });
      }
      value = inlineValue;
    } else if (rest[index + 1] && !rest[index + 1].startsWith("--")) {
      value = rest[index + 1];
      index += 1;
    } else {
      throw new DomainError("option_value_missing", `--${rawKey} exige un valor.`, {
        details: { option: rawKey },
        status: 400,
      });
    }
    if (key === "validationCommand") {
      options[key] = [...(options[key] ?? []), value];
    } else {
      options[key] = value;
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

function validationCommands(options) {
  const literal = options.validationCommand ?? [];
  if (literal.some((value) => typeof value !== "string" || !value.trim())) {
    throw new DomainError(
      "command_invalid",
      "--validation-command exige un comando literal no vacío.",
    );
  }
  return [
    ...commaList(options.validation),
    ...literal.map((value) => value.trim()),
  ];
}

function optionalRank(value) {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(String(value))) {
    throw new DomainError("option_invalid", "--rank debe ser un entero mayor o igual que cero.", {
      details: { option: "rank", received: value },
      status: 400,
    });
  }
  const rank = Number(value);
  if (!Number.isSafeInteger(rank)) {
    throw new DomainError("option_invalid", "--rank excede el rango de enteros seguros.", {
      details: { option: "rank", received: value },
      status: 400,
    });
  }
  return rank;
}

function assertCommandOptions(command, options) {
  const allowed = commandOptions[command];
  if (!allowed) {
    return;
  }
  const accepted = new Set(["_", "json", "help", ...allowed]);
  const invalid = Object.keys(options).find((key) => !accepted.has(key));
  if (invalid) {
    const rendered = invalid.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
    throw new DomainError("option_unknown", `--${rendered} no pertenece al comando ${command}.`, {
      details: { command, option: rendered, allowed },
      status: 400,
    });
  }
}

function assertNoExtraPositionals(command, positionals) {
  const maximum = {
    init: 0,
    "create-epic": 1,
    "create-story": 1,
    next: 0,
    show: 1,
    claim: 1,
    checkpoint: 1,
    block: 1,
    resolve: 1,
    check: 1,
    worktree: 1,
    "worktree-remove": 1,
    release: 1,
    validate: 1,
    complete: 1,
    doctor: 0,
    reconcile: 1,
    "migrate-legacy": 0,
  }[command];
  if (maximum !== undefined && positionals.length > maximum) {
    throw new DomainError("command_invalid", `${command} recibió argumentos posicionales adicionales.`, {
      details: { command, received: positionals, maximum },
      status: 400,
    });
  }
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
  assertCommandOptions(command, options);
  assertNoExtraPositionals(command, options._);

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
    const result = await createStoryWorkflow({
      ...workflowOptions(options),
      storyId: options._[0],
      title: options.title,
      objective: options.objective,
      description: options.description,
      acceptance: commaList(options.acceptance),
      validationCommands: validationCommands(options),
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
      storyType: options.storyType,
      rank: optionalRank(options.rank),
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
      resolution: options.resolution,
      evidence: options.evidence,
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
      summary: options.summary,
      nextAction: options.nextAction,
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
    if (result.health !== "healthy") {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "reconcile") {
    const entityId = options._[0];
    if (entityId && options.all) {
      throw new DomainError("command_invalid", "Usa ENTITY_ID o --all, no ambos.");
    }
    const result = await reconcileProjectCommand({
      cwd: process.cwd(),
      configPath: process.env.KANBAN_CONFIG_PATH,
      entityIds: entityId ? [entityId] : [],
      all: Boolean(options.all),
      acceptCurrent: Boolean(options.acceptCurrent),
      justification: options.reason,
      actor: options.actor ?? "human-recovery",
    });
    output(result, options.json);
    if (result.health !== "healthy") {
      process.exitCode = 2;
    }
    return;
  }

  if (command === "migrate-legacy") {
    const result = await migrateLegacyProjectCommand({
      cwd: process.cwd(),
      configPath: process.env.KANBAN_CONFIG_PATH,
      validationCommands: validationCommands(options),
      risk: options.risk,
      justification: options.reason,
      apply: Boolean(options.apply),
    });
    output(result, options.json);
    return;
  }

  throw new DomainError("command_unknown", `Comando desconocido: ${command}`, {
    details: {
      available: ["init", "create-epic", "create-story", "next", "show", "claim", "checkpoint", "block", "resolve", "check", "worktree", "worktree-remove", "release", "validate", "complete", "doctor", "reconcile", "migrate-legacy"],
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
