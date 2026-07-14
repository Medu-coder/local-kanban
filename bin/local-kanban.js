#!/usr/bin/env node

import process from "node:process";
import { randomUUID } from "node:crypto";

import { doctorProject, transitionStoryCommand, validateProjectDocuments } from "../core/commands.js";
import { DomainError } from "../core/errors.js";
import { getRegisteredProject, initializeProject } from "../core/project.js";

const help = `Local Kanban

Uso:
  local-kanban init [--id ID] [--name NAME] [--docs-path PATH] [--json]
  local-kanban validate [--json]
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
    details: { available: ["init", "validate", "doctor", "transition"] },
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
