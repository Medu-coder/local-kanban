import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { initializeProject } from "../core/project.js";

test("init prepara el proyecto y actualiza el registro de forma idempotente", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-init-"));
  const configPath = path.join(rootPath, "kanban-config", "projects.json");
  await fs.mkdir(path.join(rootPath, ".git"));

  try {
    await initializeProject({ cwd: rootPath, id: "demo", name: "Demo", configPath });
    await initializeProject({ cwd: rootPath, id: "demo", name: "Demo renamed", configPath });

    const registry = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(registry.length, 1);
    assert.equal(registry[0].name, "Demo renamed");
    assert.match(await fs.readFile(path.join(rootPath, ".gitignore"), "utf8"), /^\.local-kanban\/$/m);
    assert.match(await fs.readFile(path.join(rootPath, "AGENTS.md"), "utf8"), /\$local-kanban/);
    await fs.access(path.join(rootPath, "docs", "kanban", "stories"));
    await fs.access(path.join(rootPath, "docs", "kanban", "epics"));
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("init no permite que docsPath escape del proyecto", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-init-"));
  await fs.mkdir(path.join(rootPath, ".git"));
  try {
    await assert.rejects(
      initializeProject({ cwd: rootPath, docsPath: "../outside" }),
      (error) => error.code === "path_escape",
    );
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
  }
});

test("init no sigue symlinks en docs ni en ficheros de contrato", async () => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-init-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-outside-"));
  await fs.mkdir(path.join(rootPath, ".git"));
  await fs.symlink(outside, path.join(rootPath, "docs"), "dir");
  try {
    await assert.rejects(
      initializeProject({ cwd: rootPath, configPath: path.join(rootPath, "config.json") }),
      (error) => error.code === "SYMLINK_PATH",
    );
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fs.rm(rootPath, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
