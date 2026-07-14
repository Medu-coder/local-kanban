import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { serializeStory } from "../core/story-repository.js";
import { createStory } from "./helpers.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "local-kanban.js");

async function runCli(args, cwd, configPath, environment = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...process.env, KANBAN_CONFIG_PATH: configPath, ...environment },
  });
}

async function installCanonicalSkill(homePath) {
  const skillsPath = path.join(homePath, ".agents", "skills");
  await fs.mkdir(skillsPath, { recursive: true });
  await fs.symlink(
    path.join(repoRoot, "skills", "local-kanban"),
    path.join(skillsPath, "local-kanban"),
    "dir",
  );
}

test("CLI inicializa, valida y diagnostica con una skill canónica aislada", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-cli-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  const homePath = path.join(rootPath, ".home");
  await execFileAsync("git", ["init", "-q", rootPath]);

  try {
    const initialized = JSON.parse(
      (await runCli(["init", "--id", "cli-project", "--name", "CLI project", "--json"], rootPath, configPath)).stdout,
    );
    assert.equal(initialized.project.id, "cli-project");

    const storyPath = path.join(rootPath, "docs", "kanban", "stories", "STO-001.md");
    await fs.writeFile(
      storyPath,
      serializeStory(createStory({ project: "cli-project" }), "\nCLI story.\n"),
      "utf8",
    );

    const validation = JSON.parse((await runCli(["validate", "--json"], rootPath, configPath)).stdout);
    assert.equal(validation.ok, true);
    assert.equal(validation.counts.stories, 1);

    await assert.rejects(
      runCli(["doctor", "--json"], rootPath, configPath, { HOME: homePath }),
      (error) => {
        const doctor = JSON.parse(error.stdout);
        assert.equal(error.code, 2);
        assert.equal(doctor.ok, true);
        assert.equal(doctor.health, "degraded");
        assert.equal(doctor.checks.find((check) => check.id === "skill")?.status, "warning");
        return true;
      },
    );

    await installCanonicalSkill(homePath);
    const doctor = JSON.parse(
      (await runCli(["doctor", "--json"], rootPath, configPath, { HOME: homePath })).stdout,
    );
    assert.equal(doctor.ok, true);
    assert.equal(doctor.health, "healthy");
    assert.equal(doctor.checks.find((check) => check.id === "skill")?.status, "pass");
    await fs.access(path.join(rootPath, ".local-kanban", "runtime.sqlite"));
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});
