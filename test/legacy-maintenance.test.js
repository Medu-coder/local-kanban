import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

import { atomicWriteFile } from "../core/atomic-write.js";
import { migrateLegacyProjectCommand } from "../core/commands.js";
import { migrateLegacyDocuments } from "../core/legacy-migration.js";
import { reconcileProjectDocuments, reconcileProjectQuarantines } from "../core/reconciliation.js";
import { openRuntime } from "../core/runtime.js";
import { serializeStory } from "../core/story-repository.js";
import { createProjectFixture, createStory } from "./helpers.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "local-kanban.js");

function legacyEpic(projectId, id = "EPI-LEGACY") {
  return matter.stringify("\n## Objetivo\nAgrupar mantenimiento legacy.\n", {
    id,
    type: "epic",
    project: projectId,
    title: "Legacy epic",
    description: "Fixture legacy",
  });
}

function legacyStory(projectId, overrides = {}) {
  return matter.stringify("\n## Contexto\nFixture legacy.\n", {
    id: "STO-LEGACY",
    type: "story",
    project: projectId,
    title: "Legacy story",
    description: "Migrar sin perder datos",
    epic: "EPI-LEGACY",
    status: "done",
    priority: "medium",
    execution_mode: "agent",
    story_type: "bugfix",
    blocked_by: [],
    related_to: [],
    context_files: [],
    subtasks: [{ title: "Migrar", done: true }],
    ready_criteria: [],
    done_criteria: [{ id: "done", label: "Migración verificada", kind: "manual", checked: true }],
    ...overrides,
  });
}

async function writeLegacyPair(fixture) {
  const epicPath = path.join(fixture.rootPath, "docs/kanban/epics/EPI-LEGACY.md");
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-LEGACY.md");
  await fs.writeFile(epicPath, legacyEpic(fixture.project.id), "utf8");
  await fs.writeFile(storyPath, legacyStory(fixture.project.id), "utf8");
  return { epicPath, storyPath };
}

const migrationOptions = {
  validationCommands: ["git diff --check"],
  risk: "standard",
  justification: "Mantenimiento legacy verificado",
};

test("reconcile --all previsualiza toda la selección antes de aceptar una divergencia", async () => {
  const fixture = await createProjectFixture();
  const firstPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  const secondPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-002.md");
  await fs.writeFile(firstPath, serializeStory(createStory()), "utf8");
  await fs.writeFile(secondPath, serializeStory(createStory({ id: "STO-002" })), "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    await reconcileProjectDocuments(fixture.project, runtime);
    await fs.writeFile(firstPath, serializeStory(createStory({ revision: 3 })), "utf8");
    await fs.writeFile(secondPath, "---\nschema_version: 999\nid: STO-002\n---\n", "utf8");

    await assert.rejects(
      reconcileProjectQuarantines(fixture.project, runtime, {
        all: true,
        acceptCurrent: true,
        justification: "Aceptar todas tras revisar",
      }),
      (error) => ["schema_invalid", "reconciliation_unsafe"].includes(error.code),
    );

    assert.equal(
      runtime.db.prepare(
        "SELECT revision FROM entity_state WHERE entity_type = 'story' AND entity_id = 'STO-001'",
      ).get().revision,
      1,
    );
    assert.deepEqual(
      runtime.listQuarantines().map((item) => item.entityId).sort(),
      ["STO-001", "STO-002"],
    );
    assert.equal(
      runtime.listAuditEvents({ storyId: "STO-001" })
        .some((event) => event.eventType === "document_divergence_accepted"),
      false,
    );
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("CLI reconcile --all falla cerrado sin aceptar parcialmente", async () => {
  const fixture = await createProjectFixture();
  const firstPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  const secondPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-002.md");
  const configPath = path.join(fixture.rootPath, ".config", "projects.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify([fixture.project], null, 2)}\n`, "utf8");
  await fs.writeFile(firstPath, serializeStory(createStory()), "utf8");
  await fs.writeFile(secondPath, serializeStory(createStory({ id: "STO-002" })), "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    await reconcileProjectDocuments(fixture.project, runtime);
  } finally {
    runtime.close();
  }
  await fs.writeFile(firstPath, serializeStory(createStory({ revision: 3 })), "utf8");
  await fs.writeFile(secondPath, "---\nschema_version: 999\nid: STO-002\n---\n", "utf8");

  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          cliPath,
          "reconcile",
          "--all",
          "--accept-current",
          "--reason",
          "Preflight CLI",
          "--json",
        ],
        {
          cwd: fixture.rootPath,
          env: { ...process.env, KANBAN_CONFIG_PATH: configPath },
        },
      ),
      (error) => error.code === 2 && /schema_invalid|reconciliation_unsafe/u.test(error.stderr),
    );
    const verificationRuntime = openRuntime(fixture.rootPath);
    try {
      assert.equal(
        verificationRuntime.db.prepare(
          "SELECT revision FROM entity_state WHERE entity_type = 'story' AND entity_id = 'STO-001'",
        ).get().revision,
        1,
      );
      assert.equal(
        verificationRuntime.listAuditEvents({ storyId: "STO-001" })
          .some((event) => event.eventType === "document_divergence_accepted"),
        false,
      );
    } finally {
      verificationRuntime.close();
    }
  } finally {
    await fixture.cleanup();
  }
});

test("migrate-legacy valida referencias globales sin modificar el preview", async () => {
  const fixture = await createProjectFixture();
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-LEGACY.md");
  const original = legacyStory(fixture.project.id, {
    epic: null,
    status: "backlog",
    blocked_by: ["STO-MISSING"],
  });
  await fs.writeFile(storyPath, original, "utf8");
  try {
    await assert.rejects(
      migrateLegacyDocuments(fixture.project, { ...migrationOptions, apply: false }),
      (error) => error.code === "legacy_migration_invalid_graph" &&
        error.details.orphanedDependencies[0].dependencyId === "STO-MISSING",
    );
    assert.equal(await fs.readFile(storyPath, "utf8"), original);
  } finally {
    await fixture.cleanup();
  }
});

test("migrate-legacy restaura el batch completo si una escritura falla", async () => {
  const fixture = await createProjectFixture();
  const paths = await writeLegacyPair(fixture);
  const originals = new Map(await Promise.all(
    Object.values(paths).map(async (filePath) => [filePath, await fs.readFile(filePath, "utf8")]),
  ));
  let writes = 0;
  try {
    await assert.rejects(
      migrateLegacyDocuments(fixture.project, {
        ...migrationOptions,
        apply: true,
        writeFile: async (filePath, content, options) => {
          writes += 1;
          if (writes === 2) throw new Error("fallo de escritura simulado");
          return atomicWriteFile(filePath, content, options);
        },
      }),
      /fallo de escritura simulado/u,
    );
    for (const [filePath, original] of originals) {
      assert.equal(await fs.readFile(filePath, "utf8"), original);
    }
  } finally {
    await fixture.cleanup();
  }
});

test("migrate-legacy bloquea claims active y no solo stale", async () => {
  const fixture = await createProjectFixture();
  await writeLegacyPair(fixture);
  const runtime = openRuntime(fixture.rootPath);
  try {
    runtime.claimStory({ storyId: "STO-LEGACY", agentId: "agent-activo" });
    await assert.rejects(
      migrateLegacyProjectCommand({ project: fixture.project, ...migrationOptions, apply: true }),
      (error) => error.code === "legacy_migration_unsafe" && error.details.activeClaims === 1,
    );
    assert.equal(matter(await fs.readFile(
      path.join(fixture.rootPath, "docs/kanban/stories/STO-LEGACY.md"),
      "utf8",
    )).data.schema_version, undefined);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("CLI migrate-legacy mantiene preview byte-identical y apply es idempotente", async () => {
  const fixture = await createProjectFixture();
  const { epicPath, storyPath } = await writeLegacyPair(fixture);
  const configPath = path.join(fixture.rootPath, ".config", "projects.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify([fixture.project], null, 2)}\n`, "utf8");
  const before = {
    epic: await fs.readFile(epicPath, "utf8"),
    story: await fs.readFile(storyPath, "utf8"),
  };
  const runCli = (args) => execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: fixture.rootPath,
    env: { ...process.env, KANBAN_CONFIG_PATH: configPath },
  });
  const args = [
    "migrate-legacy",
    "--validation", "git diff --check",
    "--risk", "standard",
    "--reason", "Prueba CLI",
    "--json",
  ];
  try {
    const preview = JSON.parse((await runCli(args)).stdout);
    assert.equal(preview.mode, "preview");
    assert.equal(await fs.readFile(epicPath, "utf8"), before.epic);
    assert.equal(await fs.readFile(storyPath, "utf8"), before.story);

    const applied = JSON.parse((await runCli([...args, "--apply"])).stdout);
    assert.equal(applied.mode, "applied");
    assert.equal(applied.migrated, 2);
    const appliedBytes = await fs.readFile(storyPath, "utf8");

    const repeated = JSON.parse((await runCli([...args, "--apply"])).stdout);
    assert.equal(repeated.migrated, 0);
    assert.equal(await fs.readFile(storyPath, "utf8"), appliedBytes);
  } finally {
    await fixture.cleanup();
  }
});

test("CLI conserva una validación literal con comas mediante --validation-command", async () => {
  const fixture = await createProjectFixture();
  const configPath = path.join(fixture.rootPath, ".config", "projects.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify([fixture.project], null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(fixture.rootPath, "README.md"), "# Literal validation\n", "utf8");
  const literalCommand = "node -e \"const values=[1,2]; process.exit(values.length===2?0:1)\"";
  const runCli = (args) => execFileAsync(process.execPath, [cliPath, ...args, "--json"], {
    cwd: fixture.rootPath,
    env: { ...process.env, KANBAN_CONFIG_PATH: configPath },
  });
  const gitEnvironment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Literal validation",
    GIT_AUTHOR_EMAIL: "literal@example.test",
    GIT_COMMITTER_NAME: "Literal validation",
    GIT_COMMITTER_EMAIL: "literal@example.test",
  };

  try {
    await fs.rm(path.join(fixture.rootPath, ".git"), { recursive: true, force: true });
    await execFileAsync("git", ["init", "-q"], { cwd: fixture.rootPath, env: gitEnvironment });
    await runCli([
      "create-story", "STO-LITERAL",
      "--title", "Validación literal",
      "--objective", "Conservar y ejecutar una coma dentro del comando",
      "--acceptance", "Comando ejecutado",
      "--validation-command", literalCommand,
      "--context", "README.md",
      "--subtasks", "Ejecutar validación",
    ]);
    const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-LITERAL.md");
    const stored = matter(await fs.readFile(storyPath, "utf8")).data;
    assert.deepEqual(stored.validation.commands, [literalCommand]);

    await execFileAsync("git", ["add", "."], { cwd: fixture.rootPath, env: gitEnvironment });
    await execFileAsync("git", ["commit", "-qm", "add literal validation"], {
      cwd: fixture.rootPath,
      env: gitEnvironment,
    });
    const claimed = JSON.parse((await runCli([
      "claim", "STO-LITERAL", "--agent", "literal-agent",
    ])).stdout);
    const envelope = [
      "--attempt-id", claimed.execution.attemptId,
      "--fencing-token", String(claimed.execution.fencingToken),
      "--actor", "literal-agent",
    ];
    await runCli(["check", "STO-LITERAL", ...envelope, "--subtask", "ejecutar-validacion"]);
    await runCli(["check", "STO-LITERAL", ...envelope, "--criterion", "comando-ejecutado"]);
    const validated = JSON.parse((await runCli([
      "validate", "STO-LITERAL", ...envelope,
    ])).stdout);
    assert.deepEqual(validated.results.map((item) => item.command), [literalCommand]);
    assert.equal(validated.results[0].exitCode, 0);
  } finally {
    await fixture.cleanup();
  }
});
