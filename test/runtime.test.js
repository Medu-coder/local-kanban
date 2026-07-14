import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { atomicWriteFile } from "../core/atomic-write.js";
import { openRuntime } from "../core/runtime.js";
import {
  hashContent,
  persistStory,
  readStory,
  recoverPendingOperations,
  serializeStory,
} from "../core/story-repository.js";
import { createProjectFixture, createStory } from "./helpers.js";

async function prepareStoryFixture() {
  const fixture = await createProjectFixture();
  const story = createStory();
  const filePath = path.join(fixture.rootPath, "docs", "kanban", "stories", "STO-001.md");
  const raw = serializeStory(story, "\nHistoria de prueba.\n");
  await atomicWriteFile(filePath, raw, { rootPath: fixture.rootPath });
  return { ...fixture, story, filePath, raw };
}

test("un retry idempotente devuelve la misma operación", async () => {
  const fixture = await prepareStoryFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const input = {
      idempotencyKey: "same-key",
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 1,
      previousHash: hashContent(fixture.raw),
      targetRevision: 2,
      targetHash: "target-hash",
      targetContent: "target",
    };
    const first = runtime.beginOperation(input);
    const second = runtime.beginOperation(input);
    assert.equal(second.id, first.id);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("dos writers con la misma revisión producen un ganador y un conflicto", async () => {
  const fixture = await prepareStoryFixture();
  const firstRuntime = openRuntime(fixture.rootPath);
  const secondRuntime = openRuntime(fixture.rootPath);
  try {
    const base = {
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 1,
      previousHash: hashContent(fixture.raw),
      targetRevision: 2,
      targetContent: "target",
    };
    firstRuntime.beginOperation({ ...base, idempotencyKey: "winner", targetHash: "winner-hash" });
    assert.throws(
      () =>
        secondRuntime.beginOperation({
          ...base,
          idempotencyKey: "loser",
          targetHash: "loser-hash",
        }),
      (error) => error.code === "revision_conflict" && error.status === 409,
    );
  } finally {
    secondRuntime.close();
    firstRuntime.close();
    await fixture.cleanup();
  }
});

test("no resincroniza silenciosamente un Markdown divergente", async () => {
  const fixture = await prepareStoryFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const first = runtime.beginOperation({
      idempotencyKey: "first-completed",
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 1,
      previousHash: hashContent(fixture.raw),
      targetRevision: 2,
      targetHash: "revision-two-hash",
      targetContent: "revision two",
    });
    runtime.completeOperation(first.id, { revision: 2 });

    assert.throws(
      () =>
        runtime.beginOperation({
          idempotencyKey: "silent-rollback",
          entityType: "story",
          entityId: "STO-001",
          actor: "test",
          previousRevision: 1,
          previousHash: hashContent(fixture.raw),
          targetRevision: 2,
          targetHash: "different-target",
          targetContent: "different target",
        }),
      (error) => error.code === "revision_conflict" && /doctor/u.test(error.message),
    );
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("recovery aplica el payload si Markdown conserva el hash anterior", async () => {
  const fixture = await prepareStoryFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const targetStory = { ...fixture.story, revision: 2, status: "developing" };
    const targetContent = serializeStory(targetStory, "\nHistoria de prueba.\n");
    const operation = runtime.beginOperation({
      idempotencyKey: "recover-previous",
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 1,
      previousHash: hashContent(fixture.raw),
      targetRevision: 2,
      targetHash: hashContent(targetContent),
      targetContent,
    });

    const recovered = await recoverPendingOperations(fixture.project, runtime);
    assert.deepEqual(recovered, [
      { operationId: operation.id, status: "completed", action: "applied" },
    ]);
    assert.equal((await readStory(fixture.project, "STO-001")).story.revision, 2);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("recovery confirma sin reescribir si Markdown ya tiene el hash objetivo", async () => {
  const fixture = await prepareStoryFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const targetStory = { ...fixture.story, revision: 2, status: "developing" };
    const targetContent = serializeStory(targetStory, "\nHistoria de prueba.\n");
    const operation = runtime.beginOperation({
      idempotencyKey: "recover-target",
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 1,
      previousHash: hashContent(fixture.raw),
      targetRevision: 2,
      targetHash: hashContent(targetContent),
      targetContent,
    });
    await atomicWriteFile(fixture.filePath, targetContent, { rootPath: fixture.rootPath });

    const before = (await fs.stat(fixture.filePath)).mtimeMs;
    const recovered = await recoverPendingOperations(fixture.project, runtime);
    const after = (await fs.stat(fixture.filePath)).mtimeMs;
    assert.deepEqual(recovered, [
      { operationId: operation.id, status: "completed", action: "confirmed" },
    ]);
    assert.equal(after, before);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("recovery pone en cuarentena una tercera versión", async () => {
  const fixture = await prepareStoryFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const targetContent = serializeStory(
      { ...fixture.story, revision: 2, status: "developing" },
      "\nHistoria de prueba.\n",
    );
    const operation = runtime.beginOperation({
      idempotencyKey: "recover-conflict",
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 1,
      previousHash: hashContent(fixture.raw),
      targetRevision: 2,
      targetHash: hashContent(targetContent),
      targetContent,
    });
    await atomicWriteFile(fixture.filePath, "manual divergence", { rootPath: fixture.rootPath });

    const recovered = await recoverPendingOperations(fixture.project, runtime);
    assert.deepEqual(recovered, [
      { operationId: operation.id, status: "quarantined", action: "conflict" },
    ]);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("recovery rechaza un payload objetivo corrupto aunque su hash coincida", async () => {
  const fixture = await prepareStoryFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const corruptTarget = "not valid markdown frontmatter";
    const operation = runtime.beginOperation({
      idempotencyKey: "recover-corrupt-target",
      entityType: "story",
      entityId: "STO-001",
      actor: "test",
      previousRevision: 1,
      previousHash: hashContent(fixture.raw),
      targetRevision: 2,
      targetHash: hashContent(corruptTarget),
      targetContent: corruptTarget,
    });

    const recovered = await recoverPendingOperations(fixture.project, runtime);
    assert.deepEqual(recovered, [
      { operationId: operation.id, status: "quarantined", action: "invalid_target" },
    ]);
    assert.equal(await fs.readFile(fixture.filePath, "utf8"), fixture.raw);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("runtime rechaza runtime.sqlite si es un symlink", async () => {
  const fixture = await createProjectFixture();
  const outside = path.join(fixture.rootPath, "outside.sqlite");
  await fs.mkdir(path.join(fixture.rootPath, ".local-kanban"));
  await fs.writeFile(outside, "");
  await fs.symlink(outside, path.join(fixture.rootPath, ".local-kanban", "runtime.sqlite"));
  try {
    assert.throws(
      () => openRuntime(fixture.rootPath),
      (error) => error.code === "runtime_path_invalid",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("un fallo posterior al rename conserva el journal pendiente para recovery", async () => {
  const fixture = await prepareStoryFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const current = await readStory(fixture.project, "STO-001");
    const nextStory = { ...current.story, revision: 2, status: "developing" };
    const commandResult = {
      storyId: "STO-001",
      revision: 2,
      status: "developing",
      epic: null,
      gates: { isReady: true },
      nextAction: "continue",
    };
    await assert.rejects(
      persistStory({
        project: fixture.project,
        runtime,
        current,
        nextStory,
        actor: "test",
        idempotencyKey: "post-rename-failure",
        result: commandResult,
        writeFile: async (filePath, content, options) => {
          await atomicWriteFile(filePath, content, options);
          throw new Error("simulated directory fsync failure");
        },
      }),
      /simulated directory fsync failure/u,
    );

    assert.equal(runtime.listPendingOperations().length, 1);
    const recovered = await recoverPendingOperations(fixture.project, runtime);
    assert.equal(recovered[0].action, "confirmed");
    assert.equal(runtime.listPendingOperations().length, 0);
    assert.deepEqual(runtime.getByIdempotencyKey("post-rename-failure").result, commandResult);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});
