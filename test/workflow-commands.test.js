import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { serializeStory } from "../core/story-repository.js";
import { createStoryWorkflow, showStoryWorkflow } from "../core/workflow-commands.js";
import { createProjectFixture, createStory } from "./helpers.js";

test("show evalúa dependencias contra el estado canónico del proyecto", async () => {
  const fixture = await createProjectFixture();
  try {
    const storiesDir = path.join(fixture.rootPath, "docs", "kanban", "stories");
    await fs.writeFile(
      path.join(storiesDir, "STO-BASE.md"),
      serializeStory(createStory({ id: "STO-BASE", status: "done" })),
      "utf8",
    );
    await fs.writeFile(
      path.join(storiesDir, "STO-DEP.md"),
      serializeStory(createStory({
        id: "STO-DEP",
        dependencies: [{ story_id: "STO-BASE", type: "hard" }],
      })),
      "utf8",
    );

    const capsule = await showStoryWorkflow({ project: fixture.project, storyId: "STO-DEP" });

    assert.deepEqual(capsule.gates.pendingDependencies, []);
    assert.equal(capsule.gates.isReady, true);
  } finally {
    await fixture.cleanup();
  }
});

test("create story expone tipos canónicos y diagnostica spike antes de persistir", async () => {
  const fixture = await createProjectFixture();
  const base = {
    project: fixture.project,
    title: "Explorar alternativa",
    objective: "Resolver una incógnita técnica",
    acceptance: ["Conclusión documentada"],
    validationCommands: ["node -e \"process.exit(0)\""],
    contextFiles: ["README.md"],
  };
  try {
    await assert.rejects(
      createStoryWorkflow({ ...base, storyId: "STO-SPIKE", storyType: "spike" }),
      (error) => {
        assert.equal(error.code, "option_invalid");
        assert.deepEqual(error.details.allowed, ["feature", "bug", "tech_debt", "research", "chore"]);
        assert.match(error.details.suggestion, /research/u);
        return true;
      },
    );
    await assert.rejects(
      fs.access(path.join(fixture.rootPath, "docs", "kanban", "stories", "STO-SPIKE.md")),
    );

    const created = await createStoryWorkflow({
      ...base,
      storyId: "STO-RESEARCH",
      storyType: "research",
      executionMode: "hybrid",
      priority: "high",
    });
    assert.equal(created.story.story_type, "research");
    assert.equal(created.story.execution_mode, "hybrid");
    assert.equal(created.story.priority, "high");
    assert.equal(created.story.risk, "standard");

    const defaults = await createStoryWorkflow({ ...base, storyId: "STO-DEFAULTS" });
    assert.equal(defaults.story.story_type, "feature");
    assert.equal(defaults.story.execution_mode, "agent");
  } finally {
    await fixture.cleanup();
  }
});
