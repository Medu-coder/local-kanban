import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import matter from "gray-matter";
import { getStoryPath, resetFixtureWorkspace, updateMarkdownFrontmatter } from "../helpers/fixture.js";

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
    blocked_by: ["STO-404"],
  }));

  await page.reload();
  await page.getByTestId("story-card-STO-001").click();

  await expect(page.getByTestId("story-detail-panel")).toContainText("Referencia huérfana");
  await expect(page.getByTestId("story-detail-panel")).toContainText("STO-404");
});

test("si los criterios vienen como strings legacy, la UI los migra visualmente a checklist manual", async ({ page }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-001"), (data) => ({
    ...data,
    ready_criteria: ["Checklist legacy ready"],
    done_criteria: ["Checklist legacy done"],
  }));

  await page.reload();
  await page.getByTestId("story-card-STO-001").click();

  await expect(page.getByTestId("story-detail-panel")).toContainText("Checklist legacy ready");
  await expect(page.getByTestId("story-detail-panel")).toContainText("Checklist legacy done");
  await expect(page.getByTestId("story-detail-panel")).toContainText("manual");
});

test("si el agente completa dependencias y subtareas en markdown, la validación visual se actualiza", async ({ page }) => {
  await updateMarkdownFrontmatter(getStoryPath("STO-001"), (data) => ({
    ...data,
    subtasks: [
      { title: "Definir frontmatter", done: true },
      { title: "Pintar indicadores", done: true },
    ],
    ready_criteria: [
      { id: "owner", label: "Agente asignado", kind: "derived", rule: "has_agent_owner" },
    ],
    done_criteria: [
      { id: "subtasks-done", label: "Todas las subtareas completadas", kind: "derived", rule: "all_subtasks_done" },
    ],
  }));

  await page.reload();
  await page.getByTestId("story-card-STO-001").click();

  await expect(page.getByTestId("story-detail-panel")).toContainText("Done validado");
  await expect(page.getByTestId("story-card-STO-001")).toContainText("Done validado");
});

