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

  await page.reload();

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

test("una historia en cuarentena nunca se presenta como ready", async ({ page }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-001"), (data) => ({
    ...data,
    schema_version: 999,
  }));

  await page.reload();
  const card = page.getByTestId("story-card-STO-001");
  await expect(page.getByTestId("project-degraded")).toContainText("1 documento(s)");
  await expect(page.getByText("Requiere atención")).toBeVisible();
  await expect(card).toContainText("Cuarentena");
  await expect(card).not.toContainText("Ready");
  await card.click();
  await expect(page.getByTestId("story-quarantine")).toBeVisible();
});

test("un documento no-v1 permanece visible pero rechaza mutaciones", async ({ request }) => {
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
  expect(await response.json()).toMatchObject({ code: "legacy_document_read_only" });
  expect(await fs.readFile(getStoryPath("STO-001"), "utf8")).toBe(before);
});

test("un proyecto con ruta inexistente queda aislado sin bloquear la UI", async ({ page }) => {
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
  await page.getByRole("button", { name: /Proyecto de ejemplo/u }).click();
  await expect(page.getByTestId("story-card-STO-001")).toBeVisible();
});
