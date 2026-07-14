import assert from "node:assert/strict";
import test from "node:test";

import { reconcileProjectDocuments } from "../core/reconciliation.js";
import { openRuntime } from "../core/runtime.js";
import { serializeStory } from "../core/story-repository.js";
import { createProjectFixture, createStory } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";

test("reconciliación indexa, importa avance manual y cuarentena divergencias", async () => {
  const fixture = await createProjectFixture();
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  await fs.writeFile(storyPath, serializeStory(createStory()), "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    let result = await reconcileProjectDocuments(fixture.project, runtime);
    assert.equal(result.find((item) => item.entityId === "STO-001")?.status, "indexed");

    await fs.writeFile(
      storyPath,
      serializeStory(createStory({ revision: 2, description: "Edición manual válida" })),
      "utf8",
    );
    result = await reconcileProjectDocuments(fixture.project, runtime);
    assert.equal(result.find((item) => item.entityId === "STO-001")?.status, "imported");

    await fs.writeFile(storyPath, serializeStory(createStory({ revision: 4 })), "utf8");
    result = await reconcileProjectDocuments(fixture.project, runtime);
    assert.equal(result.find((item) => item.entityId === "STO-001")?.status, "quarantined");
    assert.equal(runtime.listQuarantines()[0].reason, "revision_divergence");
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("una edición manual con claim activo queda en cuarentena", async () => {
  const fixture = await createProjectFixture();
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  await fs.writeFile(storyPath, serializeStory(createStory()), "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    await reconcileProjectDocuments(fixture.project, runtime);
    runtime.claimStory({ storyId: "STO-001", agentId: "agent-a", attemptId: "attempt-a" });
    await fs.writeFile(storyPath, serializeStory(createStory({ revision: 2 })), "utf8");
    const result = await reconcileProjectDocuments(fixture.project, runtime);
    assert.equal(result.find((item) => item.entityId === "STO-001")?.reason, "active_claim");
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("un documento inválido queda aislado sin impedir importar los demás", async () => {
  const fixture = await createProjectFixture();
  await fs.writeFile(
    path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md"),
    serializeStory(createStory()),
    "utf8",
  );
  await fs.writeFile(
    path.join(fixture.rootPath, "docs/kanban/stories/STO-BROKEN.md"),
    "---\nid: STO-BROKEN\nschema_version: 1\n---\n",
    "utf8",
  );
  const runtime = openRuntime(fixture.rootPath);
  try {
    const result = await reconcileProjectDocuments(fixture.project, runtime);
    assert.equal(result.find((item) => item.entityId === "STO-001")?.status, "indexed");
    assert.equal(result.find((item) => item.entityId === "STO-BROKEN")?.status, "quarantined");
    assert.equal(runtime.listQuarantines()[0].entityId, "STO-BROKEN");
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("restaurar exactamente un documento válido limpia su cuarentena", async () => {
  const fixture = await createProjectFixture();
  const storyPath = path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md");
  const validContent = serializeStory(createStory());
  await fs.writeFile(storyPath, validContent, "utf8");
  const runtime = openRuntime(fixture.rootPath);
  try {
    await reconcileProjectDocuments(fixture.project, runtime);
    await fs.writeFile(storyPath, "---\nschema_version: 999\nid: STO-001\n---\n", "utf8");
    await reconcileProjectDocuments(fixture.project, runtime);
    assert.equal(runtime.listQuarantines().length, 1);

    await fs.writeFile(storyPath, validContent, "utf8");
    const result = await reconcileProjectDocuments(fixture.project, runtime);

    assert.equal(result[0].status, "unchanged");
    assert.equal(result[0].quarantineResolved, true);
    assert.deepEqual(runtime.listQuarantines(), []);
    assert.equal(
      runtime.listAuditEvents({ storyId: "STO-001" }).at(-1).eventType,
      "document_quarantine_resolved",
    );
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});
