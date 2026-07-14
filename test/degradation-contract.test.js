import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import matter from "gray-matter";

import { validateProjectDocuments } from "../core/commands.js";
import { migrateLegacyDocuments } from "../core/legacy-migration.js";
import { reconcileProjectDocuments, reconcileProjectQuarantines } from "../core/reconciliation.js";
import { openRuntime } from "../core/runtime.js";
import { serializeStory } from "../core/story-repository.js";
import { claimStoryWorkflow, nextStoriesCommand } from "../core/workflow-commands.js";
import { createProjectFixture, createStory } from "./helpers.js";

test("next y claim fallan cerrados con una cuarentena accionable", async () => {
  const fixture = await createProjectFixture();
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  await fs.writeFile(storyPath, serializeStory(createStory()), "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    await reconcileProjectDocuments(fixture.project, runtime);
    await fs.writeFile(storyPath, serializeStory(createStory({ revision: 3 })), "utf8");
    await reconcileProjectDocuments(fixture.project, runtime);
  } finally {
    runtime.close();
  }

  await assert.rejects(
    () => nextStoriesCommand({ project: fixture.project }),
    (error) => error.code === "project_degraded" &&
      error.details.canProceed === false &&
      error.details.degradations[0].command.includes("reconcile STO-001"),
  );
  await assert.rejects(
    () => claimStoryWorkflow({ project: fixture.project, storyId: "STO-001", agentId: "agent-test" }),
    (error) => error.code === "project_degraded" && Boolean(error.details.nextAction),
  );
  await fixture.cleanup();
});

test("reconcile previsualiza y acepta una divergencia solo con justificación", async () => {
  const fixture = await createProjectFixture();
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  await fs.writeFile(storyPath, serializeStory(createStory()), "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    await reconcileProjectDocuments(fixture.project, runtime);
    await fs.writeFile(storyPath, serializeStory(createStory({ revision: 3, description: "Fuente elegida" })), "utf8");
    const preview = await reconcileProjectQuarantines(fixture.project, runtime);
    assert.equal(preview.canProceed, false);
    assert.equal(preview.issues[0].code, "revision_divergence");

    const accepted = await reconcileProjectQuarantines(fixture.project, runtime, {
      entityIds: ["STO-001"],
      acceptCurrent: true,
      justification: "Markdown revisado contra el diff de Git",
      actor: "test-orchestrator",
    });
    assert.equal(accepted.health, "healthy");
    assert.deepEqual(runtime.listQuarantines(), []);
    assert.equal(
      runtime.listAuditEvents({ storyId: "STO-001" }).at(-1).eventType,
      "document_divergence_accepted",
    );
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("un Markdown eliminado se convierte en missing_document y restaurarlo lo resuelve", async () => {
  const fixture = await createProjectFixture();
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  const content = serializeStory(createStory());
  await fs.writeFile(storyPath, content, "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    await reconcileProjectDocuments(fixture.project, runtime);
    await fs.rm(storyPath);
    await reconcileProjectDocuments(fixture.project, runtime);
    assert.equal(runtime.listQuarantines()[0].reason, "missing_document");
    await fs.writeFile(storyPath, content, "utf8");
    await reconcileProjectDocuments(fixture.project, runtime);
    assert.deepEqual(runtime.listQuarantines(), []);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("migrate-legacy produce fixtures v1 explícitas y reabre done sin fabricar evidencia", async () => {
  const fixture = await createProjectFixture();
  const epicPath = path.join(fixture.rootPath, "docs/kanban/epics/EPI-LEGACY.md");
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-LEGACY.md");
  await fs.writeFile(epicPath, matter.stringify("\n## Objetivo\nAgrupar fixtures.\n", {
    id: "EPI-LEGACY", type: "epic", project: fixture.project.id, title: "Legacy", description: "Fixture",
  }), "utf8");
  await fs.writeFile(storyPath, matter.stringify("\n## Contexto\nFixture legacy.\n", {
    id: "STO-LEGACY", type: "story", project: fixture.project.id, title: "Legacy story",
    description: "Ejercitar la migración", epic: "EPI-LEGACY", status: "done", priority: "medium",
    execution_mode: "agent", story_type: "bugfix", blocked_by: [], related_to: [], context_files: [],
    subtasks: [{ title: "Migrar", done: true }], ready_criteria: [],
    done_criteria: [{ id: "done", label: "Fixture migrada", kind: "manual", checked: true }],
  }), "utf8");

  const preview = await migrateLegacyDocuments(fixture.project, {
    validationCommands: ["git diff --check"], risk: "standard", justification: "Datos de prueba", apply: false,
  });
  assert.equal(preview.mode, "preview");
  assert.equal(preview.migrated, 2);
  await migrateLegacyDocuments(fixture.project, {
    validationCommands: ["git diff --check"], risk: "standard", justification: "Datos de prueba", apply: true,
  });
  const validation = await validateProjectDocuments(fixture.project);
  assert.equal(validation.ok, true);
  const migrated = matter(await fs.readFile(storyPath, "utf8")).data;
  assert.equal(migrated.schema_version, 1);
  assert.equal(migrated.status, "testing");
  assert.equal(migrated.story_type, "bug");
  assert.deepEqual(migrated.evidence, undefined);
  await fixture.cleanup();
});
