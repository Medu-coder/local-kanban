import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import matter from "gray-matter";

import { openRuntime } from "../../core/runtime.js";
import { serializeStory } from "../../core/story-repository.js";
import { getEpicPath, getStoryPath, projectRoot, resetFixtureWorkspace } from "../helpers/fixture.js";

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
      objective: "Verificar que ninguna ruta no canónica muta una épica v1.",
    }),
    "utf8",
  );
});

test("HTTP v1 reserva estados a la CLI y permite reorganizar backlog con CAS", async ({ request }) => {
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
  expect((await blocked.json()).code).toBe("agent_workflow_required");

  const filePath = getStoryPath("STO-900");
  const payload = {
    status: "backlog",
    epicId: "EPI-900",
    expectedRevision: 1,
    idempotencyKey: "canonical-planning-move-1",
  };
  const moved = await request.post(endpoint, { data: payload });
  expect(moved.status()).toBe(200);
  expect(await moved.json()).toMatchObject({
    ok: true,
    storyId: "STO-900",
    revision: 2,
    status: "backlog",
  });

  const retried = await request.post(endpoint, { data: payload });
  expect(retried.status()).toBe(200);
  expect(await retried.json()).toMatchObject({ revision: 2, status: "backlog" });

  const stale = await request.post(endpoint, {
    data: { ...payload, epicId: null, idempotencyKey: "canonical-stale-1" },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("revision_conflict");

  const persisted = matter(await fs.readFile(filePath, "utf8"));
  expect(persisted.data.revision).toBe(2);
  expect(persisted.data.status).toBe("backlog");
  expect(persisted.data.epic).toBe("EPI-900");

  const timeline = await request.get(
    "/api/projects/sample-project/stories/STO-900/timeline",
  );
  expect(timeline.status()).toBe(200);
  const timelinePayload = await timeline.json();
  expect(timelinePayload).toMatchObject({
    storyId: "STO-900",
    coordination: { operationalStatus: "unclaimed" },
  });
  expect(timelinePayload.events.some((event) => event.eventType === "operation_completed")).toBe(true);
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
    objective: "Mantener un contrato de planificación completo.",
    description: "Descripción actualizada",
    scope: ["server/index.js"],
    status: "backlog",
    priority: "high",
    risk: "standard",
    executionMode: "agent",
    storyType: "feature",
    contextFiles: ["server/index.js"],
    validation: { commands: ["npm run test:e2e"] },
    readyCriteria: [],
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
    objective: "Mantener un objetivo canónico explícito.",
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
  expect(story.data.readiness_criteria).toEqual([]);
  expect(story.content.trim()).toBe("Historia canónica de integración.");
  expect(story.data.subtasks[0]).toMatchObject({ id: "transition", done: true });
  expect(epic.data.revision).toBe(2);
  expect(epic.content.trim()).toBe("Épica canónica.");
});

test("la UI no suplanta checks agénticos ni acepta planificación incompleta", async ({ request }) => {
  const filePath = getStoryPath("STO-900");
  const parsed = matter(await fs.readFile(filePath, "utf8"));
  parsed.data.execution_mode = "agent";
  await fs.writeFile(filePath, matter.stringify(parsed.content, parsed.data), "utf8");

  const readiness = await request.post(
    "/api/projects/sample-project/stories/STO-900/criteria/ready/0/toggle",
    { data: { expectedRevision: 1, idempotencyKey: "agent-readiness-allowed-1" } },
  );
  expect(readiness.status()).toBe(200);

  const toggle = await request.post(
    "/api/projects/sample-project/stories/STO-900/criteria/done/0/toggle",
    { data: { expectedRevision: 2, idempotencyKey: "agent-check-denied-1" } },
  );
  expect(toggle.status()).toBe(409);
  expect(await toggle.json()).toMatchObject({ code: "agent_workflow_required" });

  const editorBypass = await request.put(
    "/api/projects/sample-project/stories/STO-900",
    {
      data: {
        title: "Intento de completar desde el editor",
        objective: "Probar que el editor no suplanta el trabajo agéntico.",
        description: "Debe rechazarse.",
        scope: ["server/index.js"],
        status: "backlog",
        priority: "high",
        risk: "standard",
        executionMode: "agent",
        storyType: "feature",
        contextFiles: ["server/index.js"],
        validation: { commands: ["npm run test:e2e"] },
        readyCriteria: [{ id: "ready", label: "Lista para comenzar", kind: "manual", checked: true }],
        doneCriteria: [{ id: "http-tested", label: "HTTP validado", kind: "manual", checked: true }],
        subtasks: [{ id: "transition", title: "Transicionar", done: false }],
        body: "Historia canónica de integración.",
        expectedRevision: 2,
        idempotencyKey: "agent-editor-bypass-denied-1",
      },
    },
  );
  expect(editorBypass.status()).toBe(409);
  expect(await editorBypass.json()).toMatchObject({ code: "agent_workflow_required" });

  const incomplete = await request.post("/api/projects/sample-project/stories", {
    data: {
      id: "STO-902",
      title: "Contrato incompleto",
      status: "backlog",
      priority: "medium",
      executionMode: "agent",
      contextFiles: [],
      doneCriteria: [],
      idempotencyKey: "incomplete-contract-1",
    },
  });
  expect(incomplete.status()).toBe(400);
  expect(await incomplete.json()).toMatchObject({
    code: "planning_contract_incomplete",
    details: { missing: expect.arrayContaining(["objective", "scope", "validation.commands"]) },
  });
});

test("la UI no modifica planificación protegida por un claim activo", async ({ request }) => {
  const associated = await request.post("/api/projects/sample-project/stories/STO-900/move", {
    data: {
      status: "backlog",
      epicId: "EPI-900",
      expectedRevision: 1,
      idempotencyKey: "associate-before-claim-1",
    },
  });
  expect(associated.status()).toBe(200);

  const runtime = openRuntime(projectRoot);
  try {
    runtime.claimStory({ storyId: "STO-900", agentId: "agent-e2e" });
  } finally {
    runtime.close();
  }

  const update = {
    title: "Cambio concurrente no permitido",
    objective: "No interferir con el intento activo.",
    description: "Debe rechazarse.",
    scope: ["server/index.js"],
    status: "backlog",
    priority: "high",
    risk: "standard",
    executionMode: "human",
    storyType: "feature",
    contextFiles: ["server/index.js"],
    validation: { commands: ["npm run test:e2e"] },
    readyCriteria: [{ id: "ready", label: "Lista", kind: "manual", checked: false }],
    doneCriteria: [{ id: "http-tested", label: "HTTP validado", kind: "manual", checked: false }],
    subtasks: [{ title: "Transicionar", done: false }],
    body: "Historia canónica de integración.",
    expectedRevision: 2,
    idempotencyKey: "active-claim-edit-1",
  };
  const response = await request.put("/api/projects/sample-project/stories/STO-900", { data: update });
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ code: "active_claim_protected" });

  const epicResponse = await request.put("/api/projects/sample-project/epics/EPI-900", {
    data: {
      title: "Cambio de épica concurrente no permitido",
      objective: "No alterar el marco del intento activo.",
      description: "Debe rechazarse.",
      labels: [],
      body: "Épica canónica.",
      expectedRevision: 1,
      idempotencyKey: "active-claim-epic-edit-1",
    },
  });
  expect(epicResponse.status()).toBe(409);
  expect(await epicResponse.json()).toMatchObject({ code: "active_claim_protected" });
});

test("POST crea stories y epics v1 de forma idempotente desde payloads de la UI", async ({ request }) => {
  const storyPayload = {
    id: "STO-901",
    title: "Creación canónica",
    objective: "Crear una historia completa desde la UI.",
    description: "Creada desde el contrato compatible de la UI.",
    scope: ["server/index.js"],
    status: "backlog",
    priority: "medium",
    risk: "standard",
    agentOwner: "codex-e2e",
    executionMode: "agent",
    storyType: "feature",
    contextFiles: ["server/index.js"],
    validation: { commands: ["npm run test:e2e"] },
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
    objective: "Agrupar contratos creados desde la UI.",
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
