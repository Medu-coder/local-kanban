import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { DomainError } from "./errors.js";
import { assertNoSymlinkComponents, assertSafeEntityId } from "./paths.js";

const execFileAsync = promisify(execFile);

async function git(rootPath, args) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", rootPath, ...args], {
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw new DomainError("git_command_failed", "La operación Git no pudo completarse.", {
      details: { args, stderr: String(error.stderr ?? "").trim() },
      status: 409,
      cause: error,
    });
  }
}

function safeAttemptId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(normalized)) {
    throw new DomainError("attempt_id_invalid", "El ID de intento no es válido.", {
      details: { attemptId: value },
    });
  }
  return normalized;
}

export async function listWorktrees(rootPath) {
  const output = await git(rootPath, ["worktree", "list", "--porcelain"]);
  if (!output) {
    return [];
  }
  return output.split("\n\n").map((block) => {
    const fields = Object.fromEntries(
      block.split("\n").map((line) => {
        const separator = line.indexOf(" ");
        return separator === -1 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)];
      }),
    );
    return { path: fields.worktree, head: fields.HEAD, branch: fields.branch ?? null, bare: fields.bare === true };
  });
}

export async function prepareWorktree({ rootPath, storyId, attemptId, baseCommit = "HEAD" }) {
  assertSafeEntityId(storyId, "story");
  const safeAttempt = safeAttemptId(attemptId);
  const canonicalRoot = await fs.realpath(rootPath);
  const worktreesRoot = path.join(canonicalRoot, ".local-kanban", "worktrees");
  await assertNoSymlinkComponents(canonicalRoot, worktreesRoot);
  await fs.mkdir(worktreesRoot, { recursive: true, mode: 0o700 });
  const worktreePath = path.join(worktreesRoot, `${storyId.toLowerCase()}-${safeAttempt}`);
  await assertNoSymlinkComponents(canonicalRoot, worktreePath);
  const branch = `codex/kanban-${storyId.toLowerCase()}-${safeAttempt}`;

  const existing = (await listWorktrees(canonicalRoot)).find((item) => item.path === worktreePath);
  if (existing) {
    return { ...existing, path: worktreePath, branch, created: false };
  }

  await git(canonicalRoot, ["rev-parse", "--verify", `${baseCommit}^{commit}`]);
  await git(canonicalRoot, ["worktree", "add", "-b", branch, worktreePath, baseCommit]);
  const head = await git(worktreePath, ["rev-parse", "HEAD"]);
  return { path: worktreePath, branch, head, created: true };
}

export async function inspectWorktree(rootPath, worktreePath) {
  const canonicalRoot = await fs.realpath(rootPath);
  const safePath = await assertNoSymlinkComponents(canonicalRoot, worktreePath);
  const [head, status] = await Promise.all([
    git(safePath, ["rev-parse", "HEAD"]),
    git(safePath, ["status", "--short"]),
  ]);
  return { path: safePath, head, dirty: Boolean(status), status };
}

export async function removeWorktree({ rootPath, storyId, attemptId, deleteBranch = false }) {
  assertSafeEntityId(storyId, "story");
  const safeAttempt = safeAttemptId(attemptId);
  const canonicalRoot = await fs.realpath(rootPath);
  const worktreePath = path.join(
    canonicalRoot,
    ".local-kanban",
    "worktrees",
    `${storyId.toLowerCase()}-${safeAttempt}`,
  );
  await assertNoSymlinkComponents(canonicalRoot, worktreePath);
  const existing = (await listWorktrees(canonicalRoot)).find((item) => item.path === worktreePath);
  if (!existing) return { path: worktreePath, removed: false, branchDeleted: false };
  const inspected = await inspectWorktree(canonicalRoot, worktreePath);
  if (inspected.dirty) {
    throw new DomainError("worktree_dirty", "El worktree conserva cambios sin commit.", {
      details: { worktreePath, status: inspected.status },
      status: 409,
    });
  }
  await git(canonicalRoot, ["worktree", "remove", worktreePath]);
  let branchDeleted = false;
  if (deleteBranch && existing.branch) {
    const branch = existing.branch.replace(/^refs\/heads\//u, "");
    await git(canonicalRoot, ["branch", "-D", branch]);
    branchDeleted = true;
  }
  return { path: worktreePath, removed: true, branchDeleted };
}
