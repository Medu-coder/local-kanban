import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { getStoryPath, resetFixtureWorkspace } from "../helpers/fixture.js";

async function dragStory(page, storyId, laneId, statusId) {
  const source = page.getByTestId(`story-card-${storyId}`);
  const target = page.getByTestId(`dropzone-${laneId}-${statusId}`);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

  await source.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await source.dispatchEvent("dragend", { dataTransfer });
}

test.beforeEach(async ({ page }) => {
  await resetFixtureWorkspace();
  await page.goto("/");
  await expect(page.getByTestId("current-project-name")).toHaveText("Proyecto de ejemplo");
});

test("carga el proyecto y cierra el detalle al pinchar fuera", async ({ page }) => {
  await page.getByTestId("story-card-STO-001").click();
  await expect(page.getByTestId("story-detail-panel")).toBeVisible();
  await page.getByTestId("kanban-board").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("story-detail-panel")).toHaveCount(0);
});

test("abre una historia mediante deep link estable", async ({ page }) => {
  await page.goto("/?project=sample-project&story=STO-001");
  await expect(page.getByTestId("story-detail-panel")).toBeVisible();
  await expect(page.getByTestId("story-detail-panel")).toContainText("STO-001");
  await expect(page).toHaveURL(/project=sample-project.*story=STO-001/u);
});

test("crea una historia desde toolbar y la muestra en el tablero", async ({ page }) => {
  await page.getByTestId("create-story-button").click();
  await page.getByTestId("story-title-input").fill("Nueva historia E2E");
  await page.getByTestId("story-agent-owner-input").fill("codex-e2e");
  await page.getByTestId("story-execution-mode-select").selectOption("agent");
  await page.getByTestId("story-context-files-input").fill("src/new-file.ts");
  await page.getByTestId("save-story-button").click();

  await expect(page.getByTestId("story-card-STO-nueva-historia-e2e")).toBeVisible();
  const file = await fs.readFile(getStoryPath("STO-nueva-historia-e2e"), "utf8");
  await expect(file).toContain("agent_owner: codex-e2e");
});

test("rechaza la creación rápida fuera de backlog para exigir transición canónica", async ({ page }) => {
  await page.getByTestId("quick-create-EPI-002-testing").click();
  await page.getByTestId("story-title-input").fill("Historia rapida");
  await page.getByTestId("story-agent-owner-input").fill("codex-fast");
  await page.getByTestId("story-context-files-input").fill("src/fast.ts");
  await page.getByTestId("save-story-button").click();

  await expect(page.getByText("Una historia nueva debe crearse en backlog y avanzar mediante transiciones.")).toBeVisible();
  await expect(page.getByTestId("story-card-STO-historia-rapida")).toHaveCount(0);
});

test("filtra por épica y busca historias por texto", async ({ page }) => {
  await page.getByTestId("epic-filter").selectOption("EPI-002");
  await expect(page.getByTestId("story-card-STO-003")).toBeVisible();
  await expect(page.getByTestId("story-card-STO-001")).toHaveCount(0);
  await expect(page.getByTestId("epic-lane-EPI-002")).toBeVisible();
  await expect(page.getByTestId("epic-lane-EPI-001")).toHaveCount(0);
  await expect(page.getByTestId("epic-lane-__no_epic__")).toHaveCount(0);

  await page.getByTestId("epic-filter").selectOption("all");
  await page.getByTestId("search-input").fill("Infraestructura base");
  await expect(page.getByTestId("story-card-STO-002")).toBeVisible();
  await expect(page.getByTestId("story-card-STO-001")).toHaveCount(0);
});

test("crea y edita una épica desde el gestor", async ({ page }) => {
  await page.getByTestId("manage-epics-button").click();
  await expect(page.getByTestId("epic-manager-panel")).toBeVisible();
  await page.getByTestId("create-epic-button").click();
  await page.getByTestId("epic-title-input").fill("Nueva épica E2E");
  await page.getByTestId("epic-description-input").fill("Descripción E2E");
  await page.getByTestId("save-epic-button").click();

  await expect(page.getByTestId("epic-manager-panel").getByText("Nueva épica E2E")).toBeVisible();
});

test("exige crear en backlog incluso con ready checklist vacío", async ({ page }) => {
  await page.getByTestId("create-story-button").click();
  await page.getByTestId("story-title-input").fill("Historia lista sin checklist");
  await page.getByTestId("story-agent-owner-input").fill("codex-ready");
  await page.getByTestId("story-execution-mode-select").selectOption("agent");
  await page.getByTestId("story-status-select").selectOption("developing");
  await page.getByTestId("story-context-files-input").fill("src/ready.ts");
  await page.getByTestId("save-story-button").click();

  await expect(page.getByText("Una historia nueva debe crearse en backlog y avanzar mediante transiciones.")).toBeVisible();
  await expect(page.getByTestId("story-card-STO-historia-lista-sin-checklist")).toHaveCount(0);
});

test("rechaza crear directamente en done", async ({ page }) => {
  await page.getByTestId("create-story-button").click();
  await page.getByTestId("story-title-input").fill("Historia sin validacion final");
  await page.getByTestId("story-agent-owner-input").fill("codex-done");
  await page.getByTestId("story-status-select").selectOption("done");
  await page.getByTestId("story-context-files-input").fill("src/done.ts");
  await page.getByTestId("save-story-button").click();

  await expect(page.getByText("Una historia nueva debe crearse en backlog y avanzar mediante transiciones.")).toBeVisible();
  await expect(page.getByTestId("story-card-STO-historia-sin-validacion-final")).toHaveCount(0);
});

test("crea una historia sin épica y luego la mueve a una épica", async ({ page }) => {
  await page.getByTestId("create-story-button").click();
  await page.getByTestId("story-title-input").fill("Historia sin epic");
  await page.getByTestId("story-agent-owner-input").fill("codex-no-epic");
  await page.getByTestId("story-context-files-input").fill("src/no-epic.ts");
  await page.getByTestId("save-story-button").click();

  await expect(page.getByTestId("epic-lane-__no_epic__")).toContainText("Historia sin epic");
  await dragStory(page, "STO-historia-sin-epic", "EPI-001", "backlog");
  await expect(page.getByTestId("dropzone-EPI-001-backlog")).toContainText("Historia sin epic");
});

test("abre y cierra detalle de épica pinchando fuera", async ({ page }) => {
  await page.getByTestId("epic-lane-title-EPI-001").click();
  await expect(page.getByText("Historias de la épica")).toBeVisible();
  await page.getByTestId("kanban-board").click({ position: { x: 10, y: 10 } });
  await expect(page.getByText("Historias de la épica")).toHaveCount(0);
});

test("colapsa y expande una épica sin perder historias", async ({ page }) => {
  await expect(page.getByTestId("dropzone-EPI-001-backlog")).toContainText("Preparar contrato agentico");
  await page.getByTestId("toggle-lane-EPI-001").click();
  await expect(page.getByTestId("dropzone-EPI-001-backlog")).toHaveCount(0);
  await page.getByTestId("toggle-lane-EPI-001").click();
  await expect(page.getByTestId("dropzone-EPI-001-backlog")).toContainText("Preparar contrato agentico");
});

test("contrae todas las lanes visibles desde el resumen del toolbar", async ({ page }) => {
  await expect(page.getByTestId("dropzone-EPI-001-backlog")).toContainText("Preparar contrato agentico");
  await expect(page.getByTestId("toggle-lane-EPI-001")).toBeVisible();
  await expect(page.getByTestId("toggle-lane-EPI-002")).toBeVisible();

  await page.getByTestId("collapse-all-lanes-button").click();

  await expect(page.getByTestId("dropzone-EPI-001-backlog")).toHaveCount(0);
  await expect(page.getByTestId("dropzone-EPI-002-backlog")).toHaveCount(0);
  await expect(page.getByTestId("collapse-all-lanes-button")).toBeDisabled();
});

test("mantiene los stages flotando con el scroll interno del workspace", async ({ page }) => {
  const mainPanel = page.locator(".main-panel");
  const stageRow = page.getByTestId("board-status-row");

  const before = await stageRow.boundingBox();
  expect(before).not.toBeNull();

  await mainPanel.evaluate((node) => {
    node.scrollTop = 1400;
  });

  await expect.poll(async () => {
    return mainPanel.evaluate((node) => node.scrollTop);
  }).toBeGreaterThan(0);

  await expect.poll(async () => {
    return page.evaluate(() => window.scrollY);
  }).toBe(0);

  const after = await stageRow.boundingBox();
  expect(after).not.toBeNull();
  expect(after.y).toBeLessThan(80);
  expect(Math.abs(after.y - before.y)).toBeGreaterThan(100);
});

test("cierra el editor de historia al pinchar fuera del sidebar", async ({ page }) => {
  await page.getByTestId("create-story-button").click();
  await expect(page.getByTestId("story-editor-panel")).toBeVisible();
  await page.getByTestId("kanban-board").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("story-editor-panel")).toHaveCount(0);
});

test("alterna a la vista grafo y abre detalles desde un nodo", async ({ page }) => {
  await page.getByTestId("workspace-view-graph").click();
  await expect(page.getByTestId("story-graph-view")).toBeVisible();
  await expect(page.getByTestId("graph-node-story-STO-001")).toBeVisible();

  await page.getByTestId("graph-node-story-STO-001").click();
  await expect(page.getByTestId("story-detail-panel")).toBeVisible();
  await expect(page.getByTestId("story-detail-panel").getByText("Preparar contrato agentico")).toBeVisible();

  await page.getByTestId("workspace-view-kanban").click();
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  await expect(page.getByTestId("current-project-name")).toHaveText("Proyecto de ejemplo");
});

test("usa la densidad por defecto actual y mantiene el sticky del kanban tras cambiar densidad", async ({ page }) => {
  await expect(page.getByTestId("density-select")).toHaveValue("dense");

  const mainPanel = page.locator(".main-panel");
  const stageRow = page.getByTestId("board-status-row");

  await page.getByTestId("density-select").selectOption("dense");

  const before = await stageRow.boundingBox();
  expect(before).not.toBeNull();

  await mainPanel.evaluate((node) => {
    node.scrollTop = 1400;
  });

  await expect.poll(async () => {
    return mainPanel.evaluate((node) => node.scrollTop);
  }).toBeGreaterThan(0);

  const after = await stageRow.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after.y - before.y)).toBeGreaterThan(100);
  expect(after.y).toBeLessThan(80);
});

test("persiste la densidad y el grafo sigue operativo", async ({ page }) => {
  await page.getByTestId("density-select").selectOption("dense");
  await page.reload();
  await expect(page.getByTestId("current-project-name")).toHaveText("Proyecto de ejemplo");
  await expect(page.getByTestId("density-select")).toHaveValue("dense");

  const stageTitleSize = await page.locator(".board-column__header h2").first().evaluate((node) => {
    return Number.parseFloat(window.getComputedStyle(node).fontSize);
  });
  expect(stageTitleSize).toBeLessThan(28);

  await page.getByTestId("workspace-view-graph").click();
  await expect(page.getByTestId("story-graph-view")).toBeVisible();
  await expect(page.getByTestId("graph-node-story-STO-001")).toBeVisible();

  const graphHeight = await page.locator(".graph-canvas").evaluate((node) => {
    return Number.parseFloat(window.getComputedStyle(node).height);
  });
  expect(graphHeight).toBeLessThan(700);

  await page.getByTestId("graph-node-story-STO-001").click();
  await expect(page.getByTestId("story-detail-panel")).toBeVisible();
});
