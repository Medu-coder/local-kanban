import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { serializeStory } from "../core/story-repository.js";
import { showStoryWorkflow } from "../core/workflow-commands.js";
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
