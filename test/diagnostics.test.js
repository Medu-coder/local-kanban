import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

import { doctorProject } from "../core/commands.js";
import { openRuntime } from "../core/runtime.js";
import { createProjectFixture } from "./helpers.js";

const execFileAsync = promisify(execFile);

async function gitInit(rootPath) {
  await fs.rm(path.join(rootPath, ".git"), { recursive: true, force: true });
  await execFileAsync("git", ["init", "-q", rootPath]);
}

test("doctor entrega health y métricas de auditoría en un proyecto sano", async () => {
  const fixture = await createProjectFixture();
  try {
    await gitInit(fixture.rootPath);
    const result = await doctorProject({ project: fixture.project, checkSkill: false });

    assert.equal(result.ok, true);
    assert.equal(result.health, "healthy");
    assert.deepEqual(result.checks.map((item) => item.status), Array(6).fill("pass"));
    assert.equal(result.metrics.audit.total, 0);
    assert.equal(result.metrics.openBlocks, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("doctor degrada y bloquea cuando SQLite conserva cuarentena", async () => {
  const fixture = await createProjectFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    await gitInit(fixture.rootPath);
    const operation = runtime.beginOperation({
      idempotencyKey: "diagnostic-quarantine",
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 0,
      previousHash: "missing",
      targetRevision: 1,
      targetHash: "target",
      targetContent: "invalid",
    });
    runtime.quarantineOperation(operation.id, "conflict");
    runtime.close();

    const result = await doctorProject({ project: fixture.project, checkSkill: false });
    assert.equal(result.ok, false);
    assert.equal(result.health, "degraded");
    assert.equal(result.checks.find((item) => item.id === "sqlite").status, "fail");
    assert.equal(result.metrics.operations.quarantined, 1);
  } finally {
    try { runtime.close(); } catch {}
    await fixture.cleanup();
  }
});

test("doctor avisa sin fallar si la skill no está instalada", async () => {
  const fixture = await createProjectFixture();
  try {
    await gitInit(fixture.rootPath);
    const result = await doctorProject({
      project: fixture.project,
      skillTarget: path.join(fixture.rootPath, "missing-skill"),
    });
    assert.equal(result.ok, true);
    assert.equal(result.health, "degraded");
    assert.equal(result.checks.find((item) => item.id === "skill").status, "warning");
  } finally {
    await fixture.cleanup();
  }
});

test("doctor contabiliza cuarentenas de documentos manuales", async () => {
  const fixture = await createProjectFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    await gitInit(fixture.rootPath);
    runtime.quarantineEntity({
      entityType: "story",
      entityId: "STO-BROKEN",
      reason: "invalid_document",
    });
    runtime.close();
    const result = await doctorProject({ project: fixture.project, checkSkill: false });
    assert.equal(result.ok, false);
    assert.equal(result.metrics.quarantinedEntities, 1);
    assert.equal(result.checks.find((item) => item.id === "sqlite").status, "fail");
  } finally {
    try { runtime.close(); } catch {}
    await fixture.cleanup();
  }
});

test("doctor reconcilia y pone en cuarentena un Markdown inválido sin depender de la UI", async () => {
  const fixture = await createProjectFixture();
  try {
    await gitInit(fixture.rootPath);
    const storyPath = path.join(fixture.rootPath, "docs", "kanban", "stories", "STO-BROKEN.md");
    await fs.writeFile(storyPath, "---\nid: STO-OTHER\ntype: story\n---\n", "utf8");

    const result = await doctorProject({ project: fixture.project, checkSkill: false });

    assert.equal(result.ok, false);
    assert.equal(result.validation.ok, false);
    assert.equal(result.metrics.quarantinedEntities, 1);
    assert.equal(result.checks.find((item) => item.id === "schema_dag").status, "fail");
    assert.equal(result.checks.find((item) => item.id === "sqlite").status, "fail");
    assert.deepEqual(
      result.runtime.reconciliation.map(({ details: _details, ...item }) => item),
      [{
        status: "quarantined",
        entityType: "story",
        entityId: "STO-BROKEN",
        reason: "invalid_document",
      }],
    );
    assert.equal(result.degradations.canProceed, false);
    assert.match(result.degradations.issues[0].action, /Corrige|Resuelve/u);
  } finally {
    await fixture.cleanup();
  }
});
