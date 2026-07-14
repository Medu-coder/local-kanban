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

test("las rutas de escritura legacy fallan cerrado para documentos v1", async ({ request }) => {
  const requests = [
    request.put("/api/projects/sample-project/stories/STO-900", {
      data: { title: "Overwrite legacy" },
    }),
    request.post("/api/projects/sample-project/stories/STO-900/subtasks/0/toggle", { data: {} }),
    request.post("/api/projects/sample-project/stories/STO-900/criteria/ready/0/toggle", { data: {} }),
    request.put("/api/projects/sample-project/epics/EPI-900", {
      data: { title: "Overwrite epic" },
    }),
  ];

  for (const response of await Promise.all(requests)) {
    expect(response.status()).toBe(409);
    expect((await response.json()).code).toBe("canonical_update_required");
  }

  const story = matter(await fs.readFile(getStoryPath("STO-900"), "utf8"));
  const epic = matter(await fs.readFile(getEpicPath("EPI-900"), "utf8"));
  expect(story.data.schema_version).toBe(1);
  expect(story.data.revision).toBe(1);
  expect(epic.data.schema_version).toBe(1);
  expect(epic.data.revision).toBe(1);
});
