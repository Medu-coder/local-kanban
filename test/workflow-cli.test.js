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
    await runCli([
      "resolve", "STO-001", ...envelope, "--block-id", blocked.block.id,
      "--resolution", "Alcance confirmado por Eduardo",
    ], rootPath, configPath);
    await runCli(["checkpoint", "STO-001", ...envelope, "--summary", "Implementación lista"], rootPath, configPath);
    await runCli(["validate", "STO-001", ...envelope], worktree.path, configPath);
    const verificationQueue = JSON.parse(
      (await runCli(["next", "--json"], rootPath, configPath)).stdout,
    );
    assert.equal(verificationQueue.verificationCount, 1);
    assert.equal(verificationQueue.verification[0].story.id, "STO-001");
    assert.equal(verificationQueue.verification[0].execution.attemptId, attempt);
    assert.equal(verificationQueue.verification[0].nextAction, "complete STO-001 using active handoff");
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

test("CLI completa riesgo high con handoff y review de intento independiente", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-high-review-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);
  try {
    await fs.writeFile(path.join(rootPath, "README.md"), "# High risk\n", "utf8");
    await runCli(["init", "--id", "high-project", "--name", "High project", "--json"], rootPath, configPath);
    await runCli([
      "create-story", "STO-HIGH", "--title", "Cambio sensible", "--objective", "Validar review independiente",
      "--acceptance", "Cambio validado", "--validation", "node -e \"process.exit(0)\"",
      "--context", "README.md", "--subtasks", "Implementar", "--risk", "high", "--json",
    ], rootPath, configPath);
    await git(rootPath, ["add", "."]);
    await git(rootPath, ["commit", "-qm", "plan high risk"]);

    const implementer = JSON.parse((await runCli([
      "claim", "STO-HIGH", "--agent", "implementer", "--json",
    ], rootPath, configPath)).stdout);
    const implEnvelope = [
      "--attempt-id", implementer.execution.attemptId,
      "--fencing-token", String(implementer.execution.fencingToken),
      "--actor", "implementer", "--json",
    ];
    await runCli(["check", "STO-HIGH", ...implEnvelope, "--subtask", "implementar"], rootPath, configPath);
    await runCli(["check", "STO-HIGH", ...implEnvelope, "--criterion", "cambio-validado"], rootPath, configPath);
    await runCli(["validate", "STO-HIGH", ...implEnvelope], rootPath, configPath);
    await runCli(["release", "STO-HIGH", ...implEnvelope, "--outcome", "released"], rootPath, configPath);

    const queue = JSON.parse((await runCli(["next", "--json"], rootPath, configPath)).stdout);
    assert.equal(queue.count, 0);
    assert.equal(queue.verificationCount, 1);
    assert.equal(queue.verification[0].nextAction, "claim STO-HIGH as independent verifier");

    const reviewer = JSON.parse((await runCli([
      "claim", "STO-HIGH", "--agent", "independent-reviewer", "--json",
    ], rootPath, configPath)).stdout);
    assert.equal(reviewer.story.status, "testing");
    const reviewEnvelope = [
      "--attempt-id", reviewer.execution.attemptId,
      "--fencing-token", String(reviewer.execution.fencingToken),
      "--actor", "independent-reviewer", "--json",
    ];
    await runCli([
      "validate", "STO-HIGH", ...reviewEnvelope, "--evidence-type", "review",
      "--summary", "Review independiente superada",
    ], rootPath, configPath);
    await runCli(["release", "STO-HIGH", ...reviewEnvelope, "--outcome", "released"], rootPath, configPath);

    const orchestrator = JSON.parse((await runCli([
      "claim", "STO-HIGH", "--agent", "orchestrator", "--json",
    ], rootPath, configPath)).stdout);
    const completed = JSON.parse((await runCli([
      "complete", "STO-HIGH",
      "--attempt-id", orchestrator.execution.attemptId,
      "--fencing-token", String(orchestrator.execution.fencingToken),
      "--actor", "orchestrator", "--role", "orchestrator", "--json",
    ], rootPath, configPath)).stdout);
    assert.equal(completed.status, "done");
    assert.equal(completed.gates.hasIndependentReview, true);
    const stored = (await readStory({
      schema_version: 1, id: "high-project", name: "High project", rootPath, docsPath: "docs/kanban",
    }, "STO-HIGH")).story;
    assert.equal(stored.evidence.filter((item) => item.type === "review").length, 1);
    assert.equal(new Set(stored.evidence.map((item) => item.attempt_id)).size, 3);
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("CLI complete falla antes de mutar si no existe una entrega completa en testing", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-complete-preflight-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);
  try {
    await fs.writeFile(path.join(rootPath, "README.md"), "# Preflight\n", "utf8");
    await runCli(["init", "--id", "preflight-project", "--name", "Preflight", "--json"], rootPath, configPath);
    await runCli([
      "create-story", "STO-PREFLIGHT", "--title", "No cerrar antes de tiempo",
      "--objective", "Impedir mutaciones parciales durante complete",
      "--acceptance", "Resultado comprobado", "--validation", "node -e \"process.exit(0)\"",
      "--context", "README.md", "--subtasks", "Implementar", "--json",
    ], rootPath, configPath);
    const claimed = JSON.parse((await runCli([
      "claim", "STO-PREFLIGHT", "--agent", "orchestrator", "--json",
    ], rootPath, configPath)).stdout);
    const envelope = [
      "--attempt-id", claimed.execution.attemptId,
      "--fencing-token", String(claimed.execution.fencingToken),
      "--actor", "orchestrator", "--json",
    ];
    const before = JSON.parse((await runCli(["show", "STO-PREFLIGHT", "--json"], rootPath, configPath)).stdout);

    await assert.rejects(
      runCli([
        "complete", "STO-PREFLIGHT", ...envelope, "--role", "orchestrator",
      ], rootPath, configPath),
      (error) => error.code === 2 && /completion_status_invalid/u.test(error.stderr),
    );

    const after = JSON.parse((await runCli(["show", "STO-PREFLIGHT", "--json"], rootPath, configPath)).stdout);
    assert.equal(after.story.status, "developing");
    assert.equal(after.story.revision, before.story.revision);
    assert.deepEqual(after.story.evidence ?? [], before.story.evidence ?? []);
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("CLI next conserva trabajo bloqueado o liberado en la cola de atención", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-attention-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);
  try {
    await fs.writeFile(path.join(rootPath, "README.md"), "# Attention\n", "utf8");
    await runCli(["init", "--id", "attention-project", "--name", "Attention", "--json"], rootPath, configPath);
    await runCli([
      "create-story", "STO-ATTENTION", "--title", "Trabajo interrumpido",
      "--objective", "Mantener visible el siguiente paso",
      "--acceptance", "Resuelto", "--validation", "node -e \"process.exit(0)\"",
      "--context", "README.md", "--subtasks", "Resolver", "--json",
    ], rootPath, configPath);
    const claimed = JSON.parse((await runCli([
      "claim", "STO-ATTENTION", "--agent", "agent-a", "--json",
    ], rootPath, configPath)).stdout);
    const envelope = [
      "--attempt-id", claimed.execution.attemptId,
      "--fencing-token", String(claimed.execution.fencingToken),
      "--actor", "agent-a", "--json",
    ];
    const blocked = JSON.parse((await runCli([
      "block", "STO-ATTENTION", ...envelope,
      "--type", "human", "--description", "Falta decisión", "--owner", "Eduardo",
      "--action", "Elegir opción", "--resume-condition", "Opción elegida",
    ], rootPath, configPath)).stdout);
    await runCli([
      "release", "STO-ATTENTION", ...envelope, "--outcome", "released",
      "--summary", "Bloqueado a la espera de decisión",
      "--next-action", "Reclamar y resolver cuando Eduardo elija una opción",
    ], rootPath, configPath);

    const next = JSON.parse((await runCli(["next", "--json"], rootPath, configPath)).stdout);
    assert.equal(next.count, 0);
    assert.equal(next.verificationCount, 0);
    assert.equal(next.attentionCount, 1);
    assert.equal(next.attention[0].story.id, "STO-ATTENTION");
    assert.equal(next.attention[0].blocks[0].id, blocked.block.id);
    assert.equal(next.attention[0].gates.isReady, false);
    assert.match(next.attention[0].nextAction, /claim STO-ATTENTION to resolve/u);
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("CLI mantiene un único ganador ante claims concurrentes reales", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-concurrent-cli-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);
  try {
    await fs.writeFile(path.join(rootPath, "README.md"), "# Concurrent\n", "utf8");
    await runCli(["init", "--id", "concurrent-project", "--name", "Concurrent", "--json"], rootPath, configPath);
    await runCli([
      "create-story", "STO-RACE", "--title", "Claim único", "--objective", "Evitar doble ownership",
      "--acceptance", "Un ganador", "--validation", "node -e \"process.exit(0)\"",
      "--context", "README.md", "--subtasks", "Ejecutar", "--json",
    ], rootPath, configPath);

    const results = await Promise.allSettled([
      runCli(["claim", "STO-RACE", "--agent", "agent-a", "--json"], rootPath, configPath),
      runCli(["claim", "STO-RACE", "--agent", "agent-b", "--json"], rootPath, configPath),
    ]);
    const winners = results.filter((result) => result.status === "fulfilled");
    const losers = results.filter((result) => result.status === "rejected");
    assert.equal(
      winners.length,
      1,
      JSON.stringify(results.map((result) => result.status === "fulfilled"
        ? { status: result.status, stdout: result.value.stdout }
        : { status: result.status, stderr: result.reason.stderr, message: result.reason.message })),
    );
    assert.equal(losers.length, 1);
    assert.match(losers[0].reason.stderr, /story_already_claimed/u);
    const capsule = JSON.parse(winners[0].value.stdout);
    assert.equal(capsule.execution.fencingToken, 1);
    assert.ok(["agent-a", "agent-b"].includes(capsule.execution.agentId));

    const runtime = openRuntime(rootPath);
    try {
      assert.deepEqual(runtime.listProblemOperations(), []);
      assert.deepEqual(runtime.listQuarantines(), []);
      assert.equal(runtime.db.prepare("SELECT COUNT(*) AS count FROM workflow_locks").get().count, 0);
      assert.equal(runtime.getCoordinationState("STO-RACE").claim?.fencingToken, 1);
    } finally {
      runtime.close();
    }
    const stored = (await readStory({
      schema_version: 1,
      id: "concurrent-project",
      name: "Concurrent",
      rootPath,
      docsPath: "docs/kanban",
    }, "STO-RACE")).story;
    assert.equal(stored.status, "developing");
    assert.equal(stored.revision, 2);
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("CLI recupera una validación fallida y protege un worktree sucio", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-recovery-cli-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await git(rootPath, ["init", "-q"]);
  try {
    await fs.writeFile(path.join(rootPath, "README.md"), "# Recovery\n", "utf8");
    await runCli(["init", "--id", "recovery-project", "--name", "Recovery", "--json"], rootPath, configPath);
    await runCli([
      "create-story", "STO-RECOVER", "--title", "Recuperar validación",
      "--objective", "Conservar el intento tras un fallo corregible",
      "--acceptance", "Artefacto presente",
      "--validation", "node -e \"require('node:fs').accessSync('ready.txt')\"",
      "--context", "README.md", "--subtasks", "Crear artefacto", "--json",
    ], rootPath, configPath);
    await git(rootPath, ["add", "."]);
    await git(rootPath, ["commit", "-qm", "plan recovery"]);
    const claimed = JSON.parse((await runCli([
      "claim", "STO-RECOVER", "--agent", "recovery-agent", "--json",
    ], rootPath, configPath)).stdout);
    const envelope = [
      "--attempt-id", claimed.execution.attemptId,
      "--fencing-token", String(claimed.execution.fencingToken),
      "--actor", "recovery-agent", "--json",
    ];
    const worktree = JSON.parse((await runCli([
      "worktree", "STO-RECOVER", ...envelope,
    ], rootPath, configPath)).stdout);
    await fs.writeFile(path.join(worktree.path, "dirty.txt"), "uncommitted\n", "utf8");

    await assert.rejects(
      runCli(["worktree-remove", "STO-RECOVER", ...envelope], rootPath, configPath),
      (error) => error.code === 2 && /worktree_dirty/u.test(error.stderr),
    );
    const runtimeBefore = openRuntime(rootPath);
    const renewalsBefore = runtimeBefore.listAuditEvents({ storyId: "STO-RECOVER" })
      .filter((event) => event.eventType === "lease_renewed").length;
    runtimeBefore.close();
    await assert.rejects(
      runCli(["validate", "STO-RECOVER", ...envelope], worktree.path, configPath),
      (error) => error.code === 2 && /validation_failed/u.test(error.stderr),
    );
    const runtimeAfter = openRuntime(rootPath);
    const renewalsAfter = runtimeAfter.listAuditEvents({ storyId: "STO-RECOVER" })
      .filter((event) => event.eventType === "lease_renewed").length;
    runtimeAfter.close();
    assert.equal(renewalsAfter, renewalsBefore + 1);

    await fs.rm(path.join(worktree.path, "dirty.txt"));
    await fs.writeFile(path.join(worktree.path, "ready.txt"), "ready\n", "utf8");
    await git(worktree.path, ["add", "ready.txt"]);
    await git(worktree.path, ["commit", "-qm", "add validated artifact"]);
    await runCli(["check", "STO-RECOVER", ...envelope, "--subtask", "crear-artefacto"], rootPath, configPath);
    await runCli(["check", "STO-RECOVER", ...envelope, "--criterion", "artefacto-presente"], rootPath, configPath);
    const validated = JSON.parse((await runCli([
      "validate", "STO-RECOVER", ...envelope,
    ], worktree.path, configPath)).stdout);
    assert.equal(validated.capsule.story.status, "testing");
    await runCli(["release", "STO-RECOVER", ...envelope, "--outcome", "released"], rootPath, configPath);
    const removed = JSON.parse((await runCli([
      "worktree-remove", "STO-RECOVER", "--attempt-id", claimed.execution.attemptId,
      "--delete-branch", "--json",
    ], rootPath, configPath)).stdout);
    assert.equal(removed.removed, true);
    assert.equal(removed.branchDeleted, true);
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});
