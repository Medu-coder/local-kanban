import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { inspectWorktree, prepareWorktree } from "../core/git.js";

const execFileAsync = promisify(execFile);

test("prepara un worktree idempotente y confinado por intento", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-git-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: rootPath });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: rootPath });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: rootPath });
    await fs.writeFile(path.join(rootPath, "README.md"), "fixture\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: rootPath });
    await execFileAsync("git", ["commit", "-qm", "initial"], { cwd: rootPath });

    const first = await prepareWorktree({ rootPath, storyId: "STO-123", attemptId: "attempt-1" });
    const second = await prepareWorktree({ rootPath, storyId: "STO-123", attemptId: "attempt-1" });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.path, first.path);
    assert.match(first.branch, /^codex\/kanban-sto-123-attempt-1$/u);
    assert.equal((await inspectWorktree(rootPath, first.path)).dirty, false);
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});
