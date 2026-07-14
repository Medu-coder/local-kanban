import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createProjectFixture() {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-core-"));
  await fs.mkdir(path.join(rootPath, ".git"));
  await fs.mkdir(path.join(rootPath, "docs", "kanban", "stories"), { recursive: true });
  await fs.mkdir(path.join(rootPath, "docs", "kanban", "epics"), { recursive: true });
  return {
    rootPath,
    project: {
      schema_version: 1,
      id: "sample-project",
      name: "Sample project",
      rootPath,
      docsPath: "docs/kanban",
    },
    async cleanup() {
      await fs.rm(rootPath, { recursive: true, force: true });
    },
  };
}

export function createStory(overrides = {}) {
  return {
    schema_version: 1,
    revision: 1,
    id: "STO-001",
    type: "story",
    project: "sample-project",
    title: "Implementar transición segura",
    objective: "Persistir una transición sin perder trabajo.",
    status: "backlog",
    priority: "medium",
    risk: "standard",
    acceptance_criteria: [
      { id: "tests-pass", label: "Tests pasan", kind: "manual", checked: false },
    ],
    readiness_criteria: [],
    dependencies: [],
    context_files: ["core/story.js"],
    validation: { commands: ["npm run test:unit"] },
    subtasks: [{ id: "implement", title: "Implementar", done: false }],
    ...overrides,
  };
}

export function createEvidence(storyId = "STO-001", type = "test") {
  return {
    id: `evidence-${type}`,
    type,
    story_id: storyId,
    attempt_id: "attempt-1",
    commit: "abcdef1",
    summary: `${type} validado`,
    recorded_at: "2026-07-14T10:00:00.000Z",
    actor: "codex-test",
  };
}
