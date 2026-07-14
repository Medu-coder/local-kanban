import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import matter from "gray-matter";

import { atomicWriteFile } from "../core/atomic-write.js";
import {
  createEpicCommand,
  createStoryCommand,
  toggleStoryCriterionCommand,
  toggleStorySubtaskCommand,
  updateEpicCommand,
  updateStoryCommand,
} from "../core/entity-commands.js";
import {
  persistEntity,
  readCanonicalEpic,
  readCanonicalStory,
} from "../core/entity-repository.js";
import { openRuntime } from "../core/runtime.js";
import { recoverPendingOperations } from "../core/story-repository.js";
import { createProjectFixture, createStory } from "./helpers.js";

const actor = "test-agent";

function createEpic(overrides = {}) {
  return {
    schema_version: 1,
    revision: 1,
    id: "EPI-001",
    type: "epic",
    project: "sample-project",
    title: "Core canónico",
    objective: "Centralizar mutaciones seguras.",
    labels: ["core"],
    ...overrides,
  };
}

async function seedStory(fixture, overrides = {}, body = "\nCuerpo original.\n") {
  const story = createStory(overrides);
  await createStoryCommand({
    project: fixture.project,
    story,
    body,
    expectedRevision: 0,
    idempotencyKey: `seed-${story.id}`,
    actor,
  });
  return story;
}

async function seedEpic(fixture, overrides = {}, body = "\nCuerpo de épica.\n") {
  const epic = createEpic(overrides);
  await createEpicCommand({
    project: fixture.project,
    epic,
    body,
    expectedRevision: 0,
    idempotencyKey: `seed-${epic.id}`,
    actor,
  });
  return epic;
}

test("create story v1 usa journal, conserva body y es idempotente", async () => {
  const fixture = await createProjectFixture();
  try {
    const story = createStory();
    const options = {
      project: fixture.project,
      story,
      body: "\nContexto humano que no debe perderse.\n",
      expectedRevision: 0,
      idempotencyKey: "create-story",
      actor,
    };
    const first = await createStoryCommand(options);
    const retry = await createStoryCommand(options);
    const stored = await readCanonicalStory(fixture.project, story.id);

    assert.deepEqual(retry, first);
    assert.equal(first.revision, 1);
    assert.equal(stored.body, options.body);
    assert.deepEqual(stored.entity, story);

    const runtime = openRuntime(fixture.rootPath);
    try {
      const operation = runtime.getByIdempotencyKey("create-story");
      assert.equal(operation.status, "completed");
      assert.equal(operation.previous_revision, 0);
      assert.equal(operation.target_revision, 1);
      assert.deepEqual(operation.result, first);
    } finally {
      runtime.close();
    }
  } finally {
    await fixture.cleanup();
  }
});

test("create epic v1 parte de revisión cero y rechaza un fichero existente", async () => {
  const fixture = await createProjectFixture();
  try {
    const epic = await seedEpic(fixture);
    const stored = await readCanonicalEpic(fixture.project, epic.id);
    assert.equal(stored.entity.schema_version, 1);
    assert.equal(stored.body, "\nCuerpo de épica.\n");

    await assert.rejects(
      createEpicCommand({
        project: fixture.project,
        epic,
        expectedRevision: 0,
        idempotencyKey: "duplicate-epic",
        actor,
      }),
      (error) => error.code === "epic_already_exists" && error.status === 409,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("update story aplica patch, incrementa una revisión y preserva body", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedStory(fixture);
    const result = await updateStoryCommand({
      project: fixture.project,
      storyId: "STO-001",
      patch: { title: "Título actualizado", labels: ["canonical"] },
      expectedRevision: 1,
      idempotencyKey: "update-story",
      actor,
    });
    const stored = await readCanonicalStory(fixture.project, "STO-001");

    assert.equal(result.revision, 2);
    assert.equal(stored.entity.title, "Título actualizado");
    assert.deepEqual(stored.entity.labels, ["canonical"]);
    assert.equal(stored.body, "\nCuerpo original.\n");

    await assert.rejects(
      updateStoryCommand({
        project: fixture.project,
        storyId: "STO-001",
        patch: { title: "No se aplica" },
        body: "body nuevo",
        expectedRevision: 2,
        idempotencyKey: "body-update",
        actor,
      }),
      (error) => error.code === "body_preserved" && error.status === 409,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("update story acepta reemplazo completo pero no cambia identidad ni body", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedStory(fixture);
    const current = (await readCanonicalStory(fixture.project, "STO-001")).entity;
    const result = await updateStoryCommand({
      project: fixture.project,
      storyId: "STO-001",
      story: { ...current, objective: "Nuevo objetivo." },
      expectedRevision: 1,
      idempotencyKey: "replace-story",
      actor,
    });
    assert.equal(result.story.objective, "Nuevo objetivo.");
    assert.equal((await readCanonicalStory(fixture.project, "STO-001")).body, "\nCuerpo original.\n");

    await assert.rejects(
      updateStoryCommand({
        project: fixture.project,
        storyId: "STO-001",
        patch: { id: "STO-OTHER" },
        expectedRevision: 2,
        idempotencyKey: "change-id",
        actor,
      }),
      (error) => error.code === "immutable_field" && error.status === 409,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("CRUD story no permite saltarse el comando de transición", async () => {
  const fixture = await createProjectFixture();
  try {
    await assert.rejects(
      createStoryCommand({
        project: fixture.project,
        story: createStory({ status: "developing" }),
        expectedRevision: 0,
        idempotencyKey: "create-developing",
        actor,
      }),
      (error) => error.code === "transition_required" && error.status === 409,
    );
    await seedStory(fixture);
    for (const [field, value] of [["status", "developing"], ["epic", "EPI-001"]]) {
      await assert.rejects(
        updateStoryCommand({
          project: fixture.project,
          storyId: "STO-001",
          patch: { [field]: value },
          expectedRevision: 1,
          idempotencyKey: `lifecycle-${field}`,
          actor,
        }),
        (error) => error.code === "transition_required" && error.details.field === field,
      );
    }
    assert.equal((await readCanonicalStory(fixture.project, "STO-001")).entity.revision, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("update epic incrementa revisión y preserva el body", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedEpic(fixture);
    const result = await updateEpicCommand({
      project: fixture.project,
      epicId: "EPI-001",
      patch: { title: "Épica actualizada" },
      expectedRevision: 1,
      idempotencyKey: "update-epic",
      actor,
    });
    const stored = await readCanonicalEpic(fixture.project, "EPI-001");
    assert.equal(result.revision, 2);
    assert.equal(stored.entity.title, "Épica actualizada");
    assert.equal(stored.body, "\nCuerpo de épica.\n");
  } finally {
    await fixture.cleanup();
  }
});

test("toggle criterion funciona por ID e índice y persiste cada CAS", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedStory(fixture, {
      readiness_criteria: [
        { id: "ready-one", label: "Primero", kind: "manual", checked: false },
        { id: "ready-two", label: "Segundo", kind: "manual", checked: false },
      ],
    });
    const byId = await toggleStoryCriterionCommand({
      project: fixture.project,
      storyId: "STO-001",
      criteriaType: "ready",
      criterionId: "ready-two",
      expectedRevision: 1,
      idempotencyKey: "criterion-id",
      actor,
    });
    assert.equal(byId.toggledCriterion.id, "ready-two");
    assert.equal(byId.toggledCriterion.checked, true);

    const byIndex = await toggleStoryCriterionCommand({
      project: fixture.project,
      storyId: "STO-001",
      criteriaType: "readiness",
      criterionIndex: 0,
      expectedRevision: 2,
      idempotencyKey: "criterion-index",
      actor,
    });
    assert.equal(byIndex.revision, 3);
    assert.equal(byIndex.toggledCriterion.id, "ready-one");
    assert.equal(byIndex.toggledCriterion.checked, true);
    assert.equal((await readCanonicalStory(fixture.project, "STO-001")).body, "\nCuerpo original.\n");
  } finally {
    await fixture.cleanup();
  }
});

test("toggle criterion rechaza criterios derivados y selectores ambiguos", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedStory(fixture, {
      readiness_criteria: [
        { id: "has-context", label: "Contexto", kind: "derived", rule: "has_context_files" },
      ],
    });
    await assert.rejects(
      toggleStoryCriterionCommand({
        project: fixture.project,
        storyId: "STO-001",
        criteriaType: "ready",
        criterionId: "has-context",
        expectedRevision: 1,
        idempotencyKey: "derived",
        actor,
      }),
      (error) => error.code === "criterion_derived" && error.status === 409,
    );
    await assert.rejects(
      toggleStoryCriterionCommand({
        project: fixture.project,
        storyId: "STO-001",
        criteriaType: "ready",
        criterionId: "has-context",
        criterionIndex: 0,
        expectedRevision: 1,
        idempotencyKey: "two-selectors",
        actor,
      }),
      (error) => error.code === "command_invalid",
    );
    await assert.rejects(
      toggleStoryCriterionCommand({
        project: fixture.project,
        storyId: "STO-001",
        criteriaType: "ready",
        criterionId: "has-context",
        criterionIndex: -1,
        expectedRevision: 1,
        idempotencyKey: "invalid-second-selector",
        actor,
      }),
      (error) => error.code === "command_invalid",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("toggle subtask funciona por ID e índice", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedStory(fixture, {
      subtasks: [
        { id: "first", title: "Primera", done: false },
        { id: "second", title: "Segunda", done: false },
      ],
    });
    const byId = await toggleStorySubtaskCommand({
      project: fixture.project,
      storyId: "STO-001",
      subtaskId: "second",
      expectedRevision: 1,
      idempotencyKey: "subtask-id",
      actor,
    });
    assert.equal(byId.toggledSubtask.id, "second");
    assert.equal(byId.toggledSubtask.done, true);

    const byIndex = await toggleStorySubtaskCommand({
      project: fixture.project,
      storyId: "STO-001",
      subtaskIndex: 0,
      expectedRevision: 2,
      idempotencyKey: "subtask-index",
      actor,
    });
    assert.equal(byIndex.revision, 3);
    assert.equal(byIndex.toggledSubtask.id, "first");
    assert.equal(byIndex.toggledSubtask.done, true);
  } finally {
    await fixture.cleanup();
  }
});

test("CAS obsoleto e idempotencia conflictiva fallan sin mutar", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedStory(fixture);
    const options = {
      project: fixture.project,
      storyId: "STO-001",
      patch: { title: "Ganador" },
      expectedRevision: 1,
      idempotencyKey: "same-command",
      actor,
    };
    await updateStoryCommand(options);
    const retry = await updateStoryCommand(options);
    assert.equal(retry.revision, 2);

    await assert.rejects(
      updateStoryCommand({ ...options, patch: { title: "Otra intención" } }),
      (error) => error.code === "idempotency_conflict" && error.status === 409,
    );
    await assert.rejects(
      updateStoryCommand({
        ...options,
        patch: { title: "Obsoleto" },
        idempotencyKey: "stale-revision",
      }),
      (error) => error.code === "revision_conflict" && error.details.actual === 2,
    );
    const stored = await readCanonicalStory(fixture.project, "STO-001");
    assert.equal(stored.entity.title, "Ganador");
    assert.equal(stored.entity.revision, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("comandos fallan cerrados sin CAS, idempotencia, actor o schema v1", async () => {
  const fixture = await createProjectFixture();
  try {
    const story = createStory();
    for (const invalid of [
      { expectedRevision: undefined, idempotencyKey: "key", actor },
      { expectedRevision: 0, idempotencyKey: "", actor },
      { expectedRevision: 0, idempotencyKey: "key", actor: "" },
    ]) {
      await assert.rejects(
        createStoryCommand({ project: fixture.project, story, ...invalid }),
        (error) => error.code === "command_invalid",
      );
    }
    await assert.rejects(
      createStoryCommand({
        project: fixture.project,
        story: { ...story, schema_version: 2 },
        expectedRevision: 0,
        idempotencyKey: "schema-v2",
        actor,
      }),
      (error) => error.code === "schema_invalid",
    );
    await assert.rejects(
      createStoryCommand({
        project: fixture.project,
        story,
        expectedRevision: 1,
        idempotencyKey: "bad-create-revision",
        actor,
      }),
      (error) => error.code === "revision_conflict" && error.status === 409,
    );
    await assert.rejects(fs.access(path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md")));
  } finally {
    await fixture.cleanup();
  }
});

test("Markdown resultante mantiene frontmatter v1 y body tras varios comandos", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedStory(fixture);
    await toggleStorySubtaskCommand({
      project: fixture.project,
      storyId: "STO-001",
      subtaskId: "implement",
      expectedRevision: 1,
      idempotencyKey: "raw-check",
      actor,
    });
    const raw = await fs.readFile(
      path.join(fixture.rootPath, "docs/kanban/stories/STO-001.md"),
      "utf8",
    );
    const parsed = matter(raw);
    assert.equal(parsed.data.schema_version, 1);
    assert.equal(parsed.data.revision, 2);
    assert.equal(parsed.content, "\nCuerpo original.\n");
  } finally {
    await fixture.cleanup();
  }
});

test("un fallo posterior al rename deja el journal recuperable también para CRUD genérico", async () => {
  const fixture = await createProjectFixture();
  try {
    await seedEpic(fixture);
    const current = await readCanonicalEpic(fixture.project, "EPI-001");
    const nextEpic = { ...current.entity, revision: 2, title: "Rename completado" };
    const runtime = openRuntime(fixture.rootPath);
    try {
      await assert.rejects(
        persistEntity({
          project: fixture.project,
          runtime,
          current,
          entityType: "epic",
          nextEntity: nextEpic,
          actor,
          idempotencyKey: "epic-post-rename",
          requestFingerprint: "epic-post-rename-fingerprint",
          result: { epicId: "EPI-001", revision: 2, epic: nextEpic },
          writeFile: async (filePath, content, options) => {
            await atomicWriteFile(filePath, content, options);
            throw new Error("fallo simulado después de rename");
          },
        }),
        /fallo simulado después de rename/u,
      );
      assert.equal(runtime.listPendingOperations().length, 1);
      const recovery = await recoverPendingOperations(fixture.project, runtime);
      assert.equal(recovery[0].action, "confirmed");
      assert.equal(runtime.listPendingOperations().length, 0);
      assert.equal((await readCanonicalEpic(fixture.project, "EPI-001")).entity.title, "Rename completado");
    } finally {
      runtime.close();
    }
  } finally {
    await fixture.cleanup();
  }
});
