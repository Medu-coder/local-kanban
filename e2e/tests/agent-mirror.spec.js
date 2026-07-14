import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import matter from "gray-matter";
import { configPath, getStoryPath, resetFixtureWorkspace, updateMarkdownFrontmatter } from "../helpers/fixture.js";

test.beforeEach(async ({ page }) => {
  await resetFixtureWorkspace();
  await page.goto("/");
  await expect(page.getByTestId("current-project-name")).toHaveText("Proyecto de ejemplo");
});

test("si el agente mueve una historia en markdown, el tablero refleja la nueva columna y épica", async ({ page }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-002"), (data) => ({
    ...data,
    status: "testing",
    epic: "EPI-002",
  }));

  await expect(page.getByTestId("dropzone-EPI-002-testing")).toContainText("Infraestructura base completada");
  await expect(page.getByTestId("dropzone-EPI-001-done")).not.toContainText("Infraestructura base completada");
});

test("si el agente crea una historia sin épica en markdown, aparece en la lane Sin épica", async ({ page }) => {
  const source = await fs.readFile(getStoryPath("STO-001"), "utf8");
  const parsed = matter(source);
  const next = matter.stringify(parsed.content, {
    ...parsed.data,
    id: "STO-900",
    title: "Historia generada por agente",
    epic: null,
    status: "backlog",
  });

  await fs.writeFile(getStoryPath("STO-900"), next, "utf8");
  await page.reload();

  await expect(page.getByTestId("epic-lane-__no_epic__")).toContainText("Historia generada por agente");
});

test("si el agente introduce una dependencia huérfana, el detalle la muestra como referencia huérfana", async ({ page }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-001"), (data) => ({
    ...data,
    dependencies: [{ story_id: "STO-404", type: "hard" }],
  }));

  await page.reload();
  await page.getByTestId("story-card-STO-001").click();

  await expect(page.getByTestId("story-detail-panel")).toContainText("Referencia huérfana");
  await expect(page.getByTestId("story-detail-panel")).toContainText("STO-404");
});

test("la relación Blocks se deriva de dependencias hard canónicas", async ({ page }) => {
  await page.getByTestId("story-card-STO-001").click();
  const detail = page.getByTestId("story-detail-panel");
  await expect(detail).toContainText("Blocks");
  await expect(detail).toContainText("STO-003");
  await expect(detail).toContainText("Historia bloqueada por otra");
});

test("una historia en cuarentena nunca se presenta como ready", async ({ page }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-001"), (data) => ({
    ...data,
    schema_version: 999,
  }));

  await page.reload();
  const card = page.getByTestId("story-card-STO-001");
  await expect(page.getByTestId("project-degraded")).toContainText("1 garantía(s)");
  await expect(page.getByTestId("project-degraded")).toContainText("El documento no cumple el contrato canónico");
  await expect(page.getByText("Requiere atención")).toBeVisible();
  await expect(card).toContainText("Cuarentena");
  await expect(card).not.toContainText("Ready");
  await card.click();
  await expect(page.getByTestId("story-quarantine")).toBeVisible();
});

test("un done incompleto comparte degradación entre health, UI y mutaciones", async ({ page, request }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-001"), (data) => ({
    ...data,
    status: "done",
    acceptance_criteria: data.acceptance_criteria.map((criterion) =>
      criterion.kind === "manual" ? { ...criterion, checked: false } : criterion),
    subtasks: data.subtasks.map((subtask) => ({ ...subtask, done: false })),
    evidence: [],
  }));

  await page.reload();
  await expect(page.getByTestId("project-degraded")).toContainText("done");
  await expect(page.getByTestId("create-story-button")).toBeDisabled();
  await expect(page.getByTestId("manage-epics-button")).toBeDisabled();

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    health: "degraded",
    projects: [{
      id: "sample-project",
      canProceed: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "done_gate_incomplete", entityId: "STO-001" }),
      ]),
    }],
  });

  const mutation = await request.post("/api/projects/sample-project/epics", {
    data: { title: "No debe crearse", objective: "Probar fail closed" },
  });
  expect(mutation.status()).toBe(409);
  expect(await mutation.json()).toMatchObject({ code: "project_degraded" });
});

test("la pérdida del canal SSE se muestra y la reconexión refresca datos", async ({ page }) => {
  await page.route("**/api/events", (route) => route.abort());
  await page.reload();
  await expect(page.getByTestId("sync-degraded")).toContainText("datos pueden estar obsoletos");

  await page.unroute("**/api/events");
  await page.getByRole("button", { name: "Reintentar ahora" }).click();
  await expect(page.getByTestId("sync-degraded")).toHaveCount(0);
});

test("un documento no-v1 degrada el proyecto y rechaza mutaciones", async ({ request }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-001"), (data) => {
    const { schema_version: _schemaVersion, revision: _revision, ...legacy } = data;
    return legacy;
  });
  const before = await fs.readFile(getStoryPath("STO-001"), "utf8");
  const response = await request.post(
    "/api/projects/sample-project/stories/STO-001/subtasks/0/toggle",
    { data: {} },
  );

  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ code: "project_degraded" });
  expect(await fs.readFile(getStoryPath("STO-001"), "utf8")).toBe(before);
});

test("un Markdown mayor de 1 MiB queda aislado sin derribar ni inflar el servicio", async ({ request }) => {
  const oversizedStoryPath = getStoryPath("STO-OVERSIZED");
  await fs.writeFile(oversizedStoryPath, Buffer.alloc(1024 * 1024 + 1, "a"));

  const projectsResponse = await request.get("/api/projects");
  expect(projectsResponse.status()).toBe(200);
  const responseBody = await projectsResponse.body();
  expect(responseBody.byteLength).toBeLessThan(256 * 1024);

  const payload = JSON.parse(responseBody.toString("utf8"));
  const project = payload.projects.find(({ id }) => id === "sample-project");
  expect(project).toMatchObject({
    health: "degraded",
    degradations: {
      canProceed: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_document",
          entityId: "STO-OVERSIZED",
          cause: expect.stringContaining("1048576"),
          details: expect.objectContaining({ error: "FILE_TOO_LARGE" }),
        }),
      ]),
    },
  });
  expect(project.stories).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "STO-OVERSIZED" })]),
  );

  const healthResponse = await request.get("/api/health");
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toMatchObject({
    ok: true,
    health: "degraded",
    projects: [
      expect.objectContaining({
        id: "sample-project",
        canProceed: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalid_document", entityId: "STO-OVERSIZED" }),
        ]),
      }),
    ],
  });

  expect((await request.get("/api/projects")).status()).toBe(200);
});

test("un proyecto con ruta inexistente queda aislado y sus endpoints no derriban el servicio", async ({ page, request }) => {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  config.unshift({
    schema_version: 1,
    id: "missing-project",
    name: "Proyecto no disponible",
    rootPath: "/ruta/que/no/existe",
    docsPath: "docs/kanban",
  });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  await page.reload();
  await page.getByRole("button", { name: /Proyecto no disponible/u }).click();

  await expect(page.getByTestId("current-project-name")).toHaveText("Proyecto no disponible");
  await expect(page.getByTestId("project-unavailable")).toContainText("Revisa su rootPath");
  await expect(page.getByTestId("create-story-button")).toHaveCount(0);

  const unavailableRequests = [
    await request.get("/api/projects/missing-project/stories/STO-X/timeline"),
    await request.post("/api/projects/missing-project/stories/STO-X/coordination/release", { data: {} }),
    await request.post("/api/projects/missing-project/stories/STO-X/blocks/BLOCK-X/resolve", { data: {} }),
  ];
  for (const response of unavailableRequests) {
    expect(response.status()).toBe(503);
    expect(await response.json()).toMatchObject({ code: "project_unavailable" });
  }
  expect((await request.get("/api/health")).status()).toBe(200);

  await page.getByRole("button", { name: /Proyecto de ejemplo/u }).click();
  await expect(page.getByTestId("story-card-STO-001")).toBeVisible();
});

test("la API rechaza Origins ajenos a loopback", async ({ request }) => {
  const response = await request.get("/api/health", {
    headers: { Origin: "https://attacker.example" },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ code: "local_origin_rejected" });
});

test("la envolvente HTTP aplica headers defensivos y errores JSON acotados", async ({ request }) => {
  const epicsUrl = "http://127.0.0.1:4011/api/projects/sample-project/epics";
  const health = await request.get("http://127.0.0.1:4011/api/health");
  expect(health.status()).toBe(200);
  expect(health.headers()).toMatchObject({
    "content-security-policy": "frame-ancestors 'none'",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  expect(health.headers()["x-powered-by"]).toBeUndefined();

  const invalidHostBeforeJson = await request.post(epicsUrl, {
    headers: {
      Host: "attacker.example",
      "Content-Type": "application/json",
    },
    data: "{",
  });
  expect(invalidHostBeforeJson.status()).toBe(403);
  expect(await invalidHostBeforeJson.json()).toMatchObject({ code: "local_origin_rejected" });

  const oversizedBody = "a".repeat(128 * 1024);
  const invalidOriginBeforeSize = await request.post(epicsUrl, {
    headers: {
      Origin: "https://attacker.example",
      "Content-Type": "application/json",
    },
    data: oversizedBody,
  });
  expect(invalidOriginBeforeSize.status()).toBe(403);
  expect(await invalidOriginBeforeSize.json()).toMatchObject({ code: "local_origin_rejected" });

  const malformed = await request.post(epicsUrl, {
    headers: { "Content-Type": "application/json" },
    data: "{",
  });
  expect(malformed.status()).toBe(400);
  expect(malformed.headers()["content-type"]).toContain("application/json");
  expect(await malformed.json()).toEqual({
    ok: false,
    code: "invalid_json",
    error: "El cuerpo de la petición no contiene JSON válido.",
  });

  const oversized = await request.post(epicsUrl, {
    headers: { "Content-Type": "application/json" },
    data: oversizedBody,
  });
  expect(oversized.status()).toBe(413);
  expect(oversized.headers()["content-type"]).toContain("application/json");
  expect(await oversized.json()).toEqual({
    ok: false,
    code: "payload_too_large",
    error: "El cuerpo de la petición supera el límite permitido.",
  });
});
