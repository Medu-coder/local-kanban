import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import matter from "gray-matter";

import { serializeStory } from "../../core/story-repository.js";
import { getEpicPath, getStoryPath, resetFixtureWorkspace } from "../helpers/fixture.js";

function canonicalStory(overrides = {}) {
  return {
    schema_version: 1,
    revision: 1,
    id: "STO-900",
    type: "story",
    project: "sample-project",
    title: "Transición HTTP canónica",
    objective: "Validar CAS e idempotencia a través del adaptador HTTP.",
    status: "backlog",
    priority: "high",
    risk: "standard",
    acceptance_criteria: [
      { id: "http-tested", label: "HTTP validado", kind: "manual", checked: false },
    ],
    readiness_criteria: [
      { id: "ready", label: "Lista para comenzar", kind: "manual", checked: false },
    ],
    dependencies: [],
    context_files: ["server/index.js"],
    validation: { commands: ["npm run test:e2e"] },
    subtasks: [{ id: "transition", title: "Transicionar", done: false }],
    ...overrides,
  };
}

test.beforeEach(async () => {
  await resetFixtureWorkspace();
  await fs.writeFile(
    getStoryPath("STO-900"),
    serializeStory(canonicalStory(), "\nHistoria canónica de integración.\n"),
    "utf8",
  );
  await fs.writeFile(
    getEpicPath("EPI-900"),
    matter.stringify("\nÉpica canónica.\n", {
      schema_version: 1,
      revision: 1,
      id: "EPI-900",
      type: "epic",
      project: "sample-project",
      title: "Épica canónica",
      objective: "Verificar que ninguna ruta legacy muta una épica v1.",
    }),
    "utf8",
  );
});

test("HTTP v1 aplica gates, CAS e idempotencia mediante el core", async ({ request }) => {
  const endpoint = "/api/projects/sample-project/stories/STO-900/move";
  const blocked = await request.post(endpoint, {
    data: {
      status: "developing",
      epicId: null,
      expectedRevision: 1,
      idempotencyKey: "canonical-blocked-1",
    },
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).code).toBe("readiness_incomplete");

  const filePath = getStoryPath("STO-900");
  const parsed = matter(await fs.readFile(filePath, "utf8"));
  parsed.data.readiness_criteria[0].checked = true;
  await fs.writeFile(filePath, matter.stringify(parsed.content, parsed.data), "utf8");

  const payload = {
    status: "developing",
    epicId: null,
    expectedRevision: 1,
    idempotencyKey: "canonical-transition-1",
  };
  const moved = await request.post(endpoint, { data: payload });
  expect(moved.status()).toBe(200);
  expect(await moved.json()).toMatchObject({
    ok: true,
    storyId: "STO-900",
    revision: 2,
    status: "developing",
  });

  const retried = await request.post(endpoint, { data: payload });
  expect(retried.status()).toBe(200);
  expect(await retried.json()).toMatchObject({ revision: 2, status: "developing" });

  const stale = await request.post(endpoint, {
    data: { ...payload, status: "testing", idempotencyKey: "canonical-stale-1" },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("revision_conflict");

  const persisted = matter(await fs.readFile(filePath, "utf8"));
  expect(persisted.data.revision).toBe(2);
  expect(persisted.data.status).toBe("developing");
});

test("PUT y toggles v1 aplican CAS, idempotencia y preservan el body", async ({ request }) => {
  const criterionEndpoint =
    "/api/projects/sample-project/stories/STO-900/criteria/ready/0/toggle";
  const criterionPayload = { expectedRevision: 1, idempotencyKey: "criterion-toggle-1" };
  const toggled = await request.post(criterionEndpoint, { data: criterionPayload });
  expect(toggled.status()).toBe(200);
  expect(await toggled.json()).toMatchObject({ revision: 2 });

  const retried = await request.post(criterionEndpoint, { data: criterionPayload });
  expect(retried.status()).toBe(200);
  expect(await retried.json()).toMatchObject({ revision: 2 });

  const stale = await request.post(
    "/api/projects/sample-project/stories/STO-900/subtasks/0/toggle",
    { data: { expectedRevision: 1, idempotencyKey: "subtask-stale-1" } },
  );
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("revision_conflict");

  const subtask = await request.post(
    "/api/projects/sample-project/stories/STO-900/subtasks/0/toggle",
    { data: { expectedRevision: 2, idempotencyKey: "subtask-toggle-1" } },
  );
  expect(subtask.status()).toBe(200);
  expect(await subtask.json()).toMatchObject({ revision: 3 });

  const storyUpdate = {
    title: "Historia editada mediante HTTP",
    description: "Descripción actualizada",
    status: "backlog",
    priority: "high",
    executionMode: "agent",
    storyType: "feature",
    contextFiles: ["server/index.js"],
    readyCriteria: [{ id: "ready", label: "Lista para comenzar", kind: "manual", checked: true }],
    doneCriteria: [{ id: "http-tested", label: "HTTP validado", kind: "manual", checked: false }],
    subtasks: [{ title: "Transicionar", done: true }],
    body: "Historia canónica de integración.",
    expectedRevision: 3,
    idempotencyKey: "story-put-1",
  };
  const updated = await request.put("/api/projects/sample-project/stories/STO-900", {
    data: storyUpdate,
  });
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toMatchObject({ revision: 4 });

  const updatedAgain = await request.put("/api/projects/sample-project/stories/STO-900", {
    data: storyUpdate,
  });
  expect(updatedAgain.status()).toBe(200);
  expect(await updatedAgain.json()).toMatchObject({ revision: 4 });

  const epicUpdate = {
    title: "Épica editada mediante HTTP",
    description: "Descripción canónica",
    labels: ["http"],
    body: "Épica canónica.",
    expectedRevision: 1,
    idempotencyKey: "epic-put-1",
  };
  const epicUpdated = await request.put("/api/projects/sample-project/epics/EPI-900", {
    data: epicUpdate,
  });
  expect(epicUpdated.status()).toBe(200);
  expect(await epicUpdated.json()).toMatchObject({ revision: 2 });

  const story = matter(await fs.readFile(getStoryPath("STO-900"), "utf8"));
  const epic = matter(await fs.readFile(getEpicPath("EPI-900"), "utf8"));
  expect(story.data.revision).toBe(4);
  expect(story.content.trim()).toBe("Historia canónica de integración.");
  expect(story.data.subtasks[0]).toMatchObject({ id: "transition", done: true });
  expect(epic.data.revision).toBe(2);
  expect(epic.content.trim()).toBe("Épica canónica.");
});

test("POST crea stories y epics v1 de forma idempotente desde payloads de la UI", async ({ request }) => {
  const storyPayload = {
    id: "STO-901",
    title: "Creación canónica",
    description: "Creada desde el contrato compatible de la UI.",
    status: "backlog",
    priority: "medium",
    agentOwner: "codex-e2e",
    executionMode: "agent",
    storyType: "feature",
    contextFiles: ["server/index.js"],
    subtasks: [{ title: "Persistir", done: false }],
    doneCriteria: [{ id: "persisted", label: "Persistida", kind: "manual", checked: false }],
    body: "Body inicial.",
    idempotencyKey: "story-create-901",
  };
  const created = await request.post("/api/projects/sample-project/stories", { data: storyPayload });
  expect(created.status()).toBe(201);
  expect(await created.json()).toMatchObject({ storyId: "STO-901", revision: 1 });

  const retry = await request.post("/api/projects/sample-project/stories", { data: storyPayload });
  expect(retry.status()).toBe(201);
  expect(await retry.json()).toMatchObject({ storyId: "STO-901", revision: 1 });

  const conflict = await request.post("/api/projects/sample-project/stories", {
    data: { ...storyPayload, title: "Otra intención" },
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).code).toBe("idempotency_conflict");

  const epicPayload = {
    id: "EPI-901",
    title: "Épica creada canónicamente",
    description: "Desde el payload de la UI.",
    labels: ["canonical"],
    body: "Body de épica.",
    idempotencyKey: "epic-create-901",
  };
  const epicCreated = await request.post("/api/projects/sample-project/epics", { data: epicPayload });
  expect(epicCreated.status()).toBe(201);
  expect(await epicCreated.json()).toMatchObject({ epicId: "EPI-901", revision: 1 });

  const story = matter(await fs.readFile(getStoryPath("STO-901"), "utf8"));
  const epic = matter(await fs.readFile(getEpicPath("EPI-901"), "utf8"));
  expect(story.data).toMatchObject({ schema_version: 1, revision: 1, risk: "standard" });
  expect(story.data.subtasks[0].id).toBe("subtask-persistir");
  expect(epic.data).toMatchObject({ schema_version: 1, revision: 1 });
});
