import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managerPath = path.join(rootDir, "scripts", "manage-skill.js");
const expectedCliPath = await fs.realpath(path.join(rootDir, "bin", "local-kanban.js"));
const expectedSkillPath = await fs.realpath(path.join(rootDir, "skills", "local-kanban"));
const installedSkillPath = path.join(os.homedir(), ".agents", "skills", "local-kanban");
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Local Kanban skill smoke",
  GIT_AUTHOR_EMAIL: "skill-smoke@example.test",
  GIT_COMMITTER_NAME: "Local Kanban skill smoke",
  GIT_COMMITTER_EMAIL: "skill-smoke@example.test",
};

async function run(command, args, cwd, env = process.env) {
  return execFileAsync(command, args, { cwd, env, maxBuffer: 4 * 1024 * 1024 });
}

async function runKanban(args, cwd, configPath) {
  const result = await run("local-kanban", [...args, "--json"], cwd, {
    ...process.env,
    KANBAN_CONFIG_PATH: configPath,
  });
  return JSON.parse(result.stdout);
}

async function main() {
  await run(process.execPath, [managerPath, "verify"], rootDir);
  assert.equal(await fs.realpath(installedSkillPath), expectedSkillPath);

  const executable = (await run("which", ["local-kanban"], rootDir)).stdout.trim();
  assert.ok(executable, "local-kanban no está disponible en PATH.");
  assert.equal(
    await fs.realpath(executable),
    expectedCliPath,
    "La CLI global no apunta al binario de este checkout. Ejecuta npm link.",
  );
  const help = (await run("local-kanban", ["--help"], rootDir)).stdout;
  for (const command of ["init", "create-story", "next", "claim", "check", "validate", "complete", "doctor"]) {
    assert.match(help, new RegExp(`local-kanban ${command}\\b`, "u"));
  }
  assert.match(help, /slug minúsculo de 1-50 caracteres/u);

  const consumerRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-skill-consumer-"));
  const configPath = path.join(consumerRoot, ".config", "projects.json");
  try {
    await run("git", ["init", "-q", consumerRoot], consumerRoot, gitEnvironment);
    await fs.writeFile(path.join(consumerRoot, "README.md"), "# Skill consumer smoke\n", "utf8");

    const initialized = await runKanban(["init", "--id", "skill-consumer", "--name", "Skill consumer"], consumerRoot, configPath);
    assert.equal(initialized.project.id, "skill-consumer");
    await fs.access(path.join(consumerRoot, "docs", "kanban", "stories"));
    await fs.access(path.join(consumerRoot, "docs", "kanban", "epics"));
    assert.match(await fs.readFile(path.join(consumerRoot, "AGENTS.md"), "utf8"), /\$local-kanban/u);
    assert.match(await fs.readFile(path.join(consumerRoot, ".gitignore"), "utf8"), /^\.local-kanban\/$/mu);

    await runKanban([
      "create-story", "STO-SMOKE",
      "--title", "Verificar skill instalada",
      "--objective", "Completar un flujo standard desde un consumidor limpio",
      "--acceptance", "Smoke verificado",
      "--validation", "node -e \"process.exit(0)\"",
      "--context", "README.md",
      "--subtasks", "Ejecutar smoke",
    ], consumerRoot, configPath);
    await run("git", ["add", "."], consumerRoot, gitEnvironment);
    await run("git", ["commit", "-qm", "plan skill smoke"], consumerRoot, gitEnvironment);

    const queue = await runKanban(["next"], consumerRoot, configPath);
    assert.equal(queue.stories[0].story.id, "STO-SMOKE");
    const claimed = await runKanban(["claim", "STO-SMOKE", "--agent", "skill-smoke-agent"], consumerRoot, configPath);
    const envelope = [
      "--attempt-id", claimed.execution.attemptId,
      "--fencing-token", String(claimed.execution.fencingToken),
      "--actor", "skill-smoke-agent",
    ];
    await runKanban(["check", "STO-SMOKE", ...envelope, "--subtask", "ejecutar-smoke"], consumerRoot, configPath);
    await runKanban(["check", "STO-SMOKE", ...envelope, "--criterion", "smoke-verificado"], consumerRoot, configPath);
    const validated = await runKanban(["validate", "STO-SMOKE", ...envelope], consumerRoot, configPath);
    assert.equal(validated.capsule.story.status, "testing");
    const verificationQueue = await runKanban(["next"], consumerRoot, configPath);
    assert.equal(verificationQueue.verificationCount, 1);
    assert.equal(verificationQueue.verification[0].story.id, "STO-SMOKE");
    assert.equal(verificationQueue.verification[0].execution.attemptId, claimed.execution.attemptId);
    assert.equal(verificationQueue.verification[0].nextAction, "complete STO-SMOKE using active handoff");
    const completed = await runKanban([
      "complete", "STO-SMOKE", ...envelope, "--role", "orchestrator", "--actor", "orchestrator",
    ], consumerRoot, configPath);
    assert.equal(completed.status, "done");

    const doctor = await runKanban(["doctor"], consumerRoot, configPath);
    assert.equal(doctor.ok, true);
    assert.equal(doctor.health, "healthy");
    assert.equal(doctor.metrics.openBlocks, 0);
    assert.equal(doctor.metrics.attemptsOpen, 0);
    assert.equal(doctor.metrics.quarantinedEntities, 0);
    const finalQueue = await runKanban(["next"], consumerRoot, configPath);
    assert.deepEqual(
      { implementation: finalQueue.count, verification: finalQueue.verificationCount, attention: finalQueue.attentionCount },
      { implementation: 0, verification: 0, attention: 0 },
    );

    console.log(JSON.stringify({
      ok: true,
      installedSkill: installedSkillPath,
      canonicalSkill: expectedSkillPath,
      cli: executable,
      consumer: {
        initialized: true,
        story: "STO-SMOKE",
        finalStatus: completed.status,
        doctor: doctor.health,
        queuesEmpty: true,
      },
    }, null, 2));
  } finally {
    await fs.rm(consumerRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
