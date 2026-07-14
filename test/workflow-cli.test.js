import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { openRuntime } from "../core/runtime.js";
import { readStory, serializeStory } from "../core/story-repository.js";
import { createStory } from "./helpers.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "local-kanban.js");

async function runCli(args, cwd, configPath) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...process.env, KANBAN_CONFIG_PATH: configPath },
  });
}

async function git(cwd, args) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Local Kanban test",
      GIT_AUTHOR_EMAIL: "kanban@example.test",
      GIT_COMMITTER_NAME: "Local Kanban test",
      GIT_COMMITTER_EMAIL: "kanban@example.test",
    },
  });
}

function finishedStory(overrides = {}) {
  return createStory({
    project: "workflow-project",
    execution_mode: "agent",
    acceptance_criteria: [
      { id: "tests-pass", label: "Tests pasan", kind: "manual", checked: true },
    ],
    subtasks: [{ id: "implement", title: "Implementar", done: true }],
    validation: { commands: ["node -e \"process.stdout.write('validated')\""] },
    ...overrides,
  });
}

test("CLI ejecuta claim, checkpoint, validate y complete con lease y evidencia", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-workflow-cli-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);

  try {
    await runCli(
      ["init", "--id", "workflow-project", "--name", "Workflow project", "--json"],
      rootPath,
      configPath,
    );
    const storyPath = path.join(rootPath, "docs", "kanban", "stories", "STO-001.md");
    await fs.writeFile(storyPath, serializeStory(finishedStory(), "\nWorkflow story.\n"), "utf8");
    await git(rootPath, ["add", "."]);
    await git(rootPath, ["commit", "-qm", "fixture"]);

    const globalValidation = JSON.parse(
      (await runCli(["validate", "--json"], rootPath, configPath)).stdout,
    );
    assert.equal(globalValidation.ok, true);

    const next = JSON.parse((await runCli(["next", "--json"], rootPath, configPath)).stdout);
    assert.equal(next.count, 1);
    assert.equal(next.stories[0].story.id, "STO-001");

    const capsule = JSON.parse(
      (await runCli(["claim", "STO-001", "--agent", "specialist-1", "--json"], rootPath, configPath)).stdout,
    );
    assert.equal(capsule.story.status, "developing");
    assert.equal(capsule.execution.operationalStatus, "running");
    assert.equal(capsule.execution.agentId, "specialist-1");
    const attemptId = capsule.execution.attemptId;
    const fencingToken = String(capsule.execution.fencingToken);

    const checkpoint = JSON.parse(
      (
        await runCli(
          [
            "checkpoint",
            "STO-001",
            "--attempt-id",
            attemptId,
            "--fencing-token",
            fencingToken,
            "--summary",
            "Implementación lista",
            "--next-action",
            "validar",
            "--files",
            "src/a.js,test/a.test.js",
            "--tests",
            "unit",
            "--actor",
            "specialist-1",
            "--json",
          ],
          rootPath,
          configPath,
        )
      ).stdout,
    );
    assert.equal(checkpoint.checkpoint.payload.nextAction, "validar");
    assert.deepEqual(checkpoint.checkpoint.payload.files, ["src/a.js", "test/a.test.js"]);

    const validated = JSON.parse(
      (
        await runCli(
          [
            "validate",
            "STO-001",
            "--attempt-id",
            attemptId,
            "--fencing-token",
            fencingToken,
            "--actor",
            "specialist-1",
            "--json",
          ],
          rootPath,
          configPath,
        )
      ).stdout,
    );
    assert.equal(validated.capsule.story.status, "testing");
    assert.equal(validated.capsule.execution.operationalStatus, "verifying");
    assert.equal(validated.evidence[0].attempt_id, attemptId);
    assert.match(validated.evidence[0].commit, /^[0-9a-f]{40}$/u);
    assert.equal(validated.results[0].stdout, "validated");

    await assert.rejects(
      runCli(
        [
          "complete",
          "STO-001",
          "--attempt-id",
          attemptId,
          "--fencing-token",
          fencingToken,
          "--role",
          "specialist",
          "--json",
        ],
        rootPath,
        configPath,
      ),
      (error) => error.code === 2 && /orchestrator_required/u.test(error.stderr),
    );

    const completed = JSON.parse(
      (
        await runCli(
          [
            "complete",
            "STO-001",
            "--attempt-id",
            attemptId,
            "--fencing-token",
            fencingToken,
            "--role",
            "orchestrator",
            "--actor",
            "orchestrator",
            "--json",
          ],
          rootPath,
          configPath,
        )
      ).stdout,
    );
    assert.equal(completed.status, "done");
    assert.equal(completed.released.status, "released");
    assert.equal(completed.released.outcome, "completed");

    const story = (
      await readStory(
        {
          schema_version: 1,
          id: "workflow-project",
          name: "Workflow project",
          rootPath,
          docsPath: "docs/kanban",
        },
        "STO-001",
      )
    ).story;
    assert.equal(story.status, "done");
    assert.equal(story.evidence[0].attempt_id, attemptId);
    const runtime = openRuntime(rootPath);
    try {
      assert.equal(runtime.getCoordinationState("STO-001").operationalStatus, "unclaimed");
    } finally {
      runtime.close();
    }
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("CLI block exige fencing vigente y deja el intento en waiting", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-block-cli-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);
  try {
    await runCli(
      ["init", "--id", "workflow-project", "--name", "Workflow project", "--json"],
      rootPath,
      configPath,
    );
    const storyPath = path.join(rootPath, "docs", "kanban", "stories", "STO-001.md");
    await fs.writeFile(storyPath, serializeStory(finishedStory(), "\nBlocked story.\n"), "utf8");
    const capsule = JSON.parse(
      (await runCli(["claim", "STO-001", "--agent", "specialist-2", "--json"], rootPath, configPath)).stdout,
    );
    const baseArgs = [
      "block",
      "STO-001",
      "--attempt-id",
      capsule.execution.attemptId,
      "--type",
      "human",
      "--description",
      "Necesita una decisión",
      "--owner",
      "Eduardo",
      "--action",
      "Elegir alternativa",
      "--resume-condition",
      "Alternativa elegida",
      "--actor",
      "specialist-2",
      "--json",
    ];
    await assert.rejects(
      runCli([...baseArgs, "--fencing-token", "999"], rootPath, configPath),
      (error) => error.code === 2 && /fencing_conflict/u.test(error.stderr),
    );
    const blocked = JSON.parse(
      (
        await runCli(
          [...baseArgs, "--fencing-token", String(capsule.execution.fencingToken)],
          rootPath,
          configPath,
        )
      ).stdout,
    );
    assert.equal(blocked.block.type, "human");
    const runtime = openRuntime(rootPath);
    try {
      assert.equal(runtime.getCoordinationState("STO-001").operationalStatus, "waiting");
    } finally {
      runtime.close();
    }
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("CLI cubre planificación completa sin editar Markdown manualmente", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-dogfood-cli-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);
  try {
    await fs.writeFile(path.join(rootPath, "README.md"), "# Consumer\n", "utf8");
    await runCli(["init", "--id", "dogfood-project", "--name", "Dogfood", "--json"], rootPath, configPath);
    await runCli([
      "create-epic", "EPI-001", "--title", "Entrega real", "--objective", "Completar un flujo real", "--json",
    ], rootPath, configPath);
    await runCli([
      "create-story", "STO-001",
      "--title", "Implementar cambio",
      "--objective", "Crear y verificar un resultado observable",
      "--acceptance", "Resultado observable",
      "--validation", "node -e \"require('node:fs').accessSync('implemented.txt')\"",
      "--context", "README.md",
      "--scope", "README.md",
      "--subtasks", "Implementar",
      "--epic", "EPI-001",
      "--json",
    ], rootPath, configPath);
    await git(rootPath, ["add", "."]);
    await git(rootPath, ["commit", "-qm", "plan"]);

    const claimed = JSON.parse(
      (await runCli(["claim", "STO-001", "--agent", "specialist-real", "--json"], rootPath, configPath)).stdout,
    );
    const attempt = claimed.execution.attemptId;
    const fence = String(claimed.execution.fencingToken);
    const envelope = ["--attempt-id", attempt, "--fencing-token", fence, "--actor", "specialist-real", "--json"];

    const worktree = JSON.parse(
      (await runCli(["worktree", "STO-001", ...envelope], rootPath, configPath)).stdout,
    );
    assert.equal(worktree.created, true);
    await fs.writeFile(path.join(worktree.path, "implemented.txt"), "implemented\n", "utf8");
    await git(worktree.path, ["add", "implemented.txt"]);
    await git(worktree.path, ["commit", "-qm", "implement"]);
    await runCli(["check", "STO-001", ...envelope, "--subtask", "implementar"], rootPath, configPath);
    const repeatedCheck = JSON.parse(
      (await runCli(["check", "STO-001", ...envelope, "--subtask", "implementar"], rootPath, configPath)).stdout,
    );
    assert.equal(repeatedCheck.changed, false);
    await runCli(["check", "STO-001", ...envelope, "--criterion", "resultado-observable"], rootPath, configPath);
    const blocked = JSON.parse((await runCli([
      "block", "STO-001", ...envelope,
      "--type", "human", "--description", "Confirmar alcance", "--owner", "Eduardo",
      "--action", "Confirmar", "--resume-condition", "Confirmado",
    ], rootPath, configPath)).stdout);
    await runCli(["resolve", "STO-001", ...envelope, "--block-id", blocked.block.id], rootPath, configPath);
    await runCli(["checkpoint", "STO-001", ...envelope, "--summary", "Implementación lista"], rootPath, configPath);
    await runCli(["validate", "STO-001", ...envelope], worktree.path, configPath);
    const specialistCommit = (await git(worktree.path, ["rev-parse", "HEAD"])).stdout.trim();
    await git(rootPath, ["cherry-pick", specialistCommit]);
    const integratedCommit = (await git(rootPath, ["rev-parse", "HEAD"])).stdout.trim();
    const completed = JSON.parse((await runCli([
      "complete", "STO-001", ...envelope, "--role", "orchestrator", "--actor", "orchestrator",
    ], rootPath, configPath)).stdout);
    assert.equal(completed.status, "done");
    assert.equal(completed.integratedValidation[0].commit, integratedCommit);
    const removed = JSON.parse((await runCli([
      "worktree-remove", "STO-001", "--attempt-id", attempt, "--delete-branch", "--json",
    ], rootPath, configPath)).stdout);
    assert.equal(removed.removed, true);
    assert.equal(removed.branchDeleted, true);
    const shown = JSON.parse((await runCli(["show", "STO-001", "--json"], rootPath, configPath)).stdout);
    assert.equal(shown.story.status, "done");
    assert.equal(shown.execution.operationalStatus, "unclaimed");
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});
