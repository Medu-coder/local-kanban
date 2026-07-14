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

async function runCli(args, cwd, configPath) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd,
    env: { ...process.env, KANBAN_CONFIG_PATH: configPath },
  });
}

test("CLI inicializa, valida y transiciona una historia con CAS", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-cli-"));
  const configPath = path.join(rootPath, ".config", "projects.json");
  await fs.mkdir(path.join(rootPath, ".git"));

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

    const transitioned = JSON.parse(
      (
        await runCli(
          [
            "transition",
            "STO-001",
            "--status",
            "developing",
            "--expected-revision",
            "1",
            "--role",
            "specialist",
            "--idempotency-key",
            "cli-transition-1",
            "--json",
          ],
          rootPath,
          configPath,
        )
      ).stdout,
    );
    assert.equal(transitioned.revision, 2);
    assert.equal(transitioned.status, "developing");

    const retried = JSON.parse(
      (
        await runCli(
          [
            "transition",
            "STO-001",
            "--status",
            "developing",
            "--expected-revision",
            "1",
            "--role",
            "specialist",
            "--idempotency-key",
            "cli-transition-1",
            "--json",
          ],
          rootPath,
          configPath,
        )
      ).stdout,
    );
    assert.deepEqual(retried, transitioned);

    await assert.rejects(
      runCli(
        [
          "transition",
          "STO-001",
          "--status",
          "testing",
          "--expected-revision",
          "1",
          "--idempotency-key",
          "stale-transition",
          "--json",
        ],
        rootPath,
        configPath,
      ),
      (error) => error.code === 2 && /revision_conflict/u.test(error.stderr),
    );

    await assert.rejects(
      runCli(
        [
          "transition",
          "STO-001",
          "--status",
          "testing",
          "--expected-revision",
          "2",
          "--epic",
          "EPI-missing",
          "--idempotency-key",
          "missing-epic",
          "--json",
        ],
        rootPath,
        configPath,
      ),
      (error) => error.code === 2 && /epic_not_found/u.test(error.stderr),
    );

    const doctor = JSON.parse((await runCli(["doctor", "--json"], rootPath, configPath)).stdout);
    assert.equal(doctor.ok, true);
    await fs.access(path.join(rootPath, ".local-kanban", "runtime.sqlite"));

    await fs.writeFile(
      storyPath,
      serializeStory(
        createStory({ project: "other-project", revision: 2, status: "developing" }),
        "\nForeign story.\n",
      ),
      "utf8",
    );
    await assert.rejects(
      runCli(
        [
          "transition",
          "STO-001",
          "--status",
          "testing",
          "--expected-revision",
          "2",
          "--idempotency-key",
          "foreign-project",
          "--json",
        ],
        rootPath,
        configPath,
      ),
      (error) => error.code === 2 && /project_mismatch/u.test(error.stderr),
    );
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});
