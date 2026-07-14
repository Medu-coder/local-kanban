import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { scheduleStories } from "../core/coordination.js";

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function storyId(index) {
  return `STO-${String(index).padStart(4, "0")}`;
}

function buildStories(scenario) {
  return Array.from({ length: scenario.storyCount }, (_, offset) => {
    const index = offset + 1;
    const dependencyIndex =
      index > scenario.dependencyStride && index % scenario.dependencyStride === 0
        ? index - scenario.dependencyStride
        : null;
    return {
      id: storyId(index),
      revision: 1,
      title: `Historia ${index}`,
      objective: `Procesar unidad ${index}`,
      status: "backlog",
      priority: index % 11 === 0 ? "high" : index % 3 === 0 ? "low" : "medium",
      risk: "standard",
      rank: index,
      execution_mode: "agent",
      acceptance_criteria: [],
      readiness_criteria: [],
      blockers: [],
      dependencies: dependencyIndex
        ? [{ story_id: storyId(dependencyIndex), type: "hard" }]
        : [],
      context_files: [],
      validation: { commands: [] },
      subtasks: [],
    };
  });
}

export async function runBenchmark(options = {}) {
  const scenarioPath = options.scenarioPath ?? path.join(rootPath, "fixtures", "long-project", "scenario.json");
  const scenario = JSON.parse(await fs.readFile(scenarioPath, "utf8"));
  const stories = buildStories(scenario);
  let scheduled = [];
  const started = performance.now();
  for (let index = 0; index < scenario.iterations; index += 1) {
    scheduled = scheduleStories(stories, { wipLimit: scenario.wipLimit });
  }
  const durationMs = performance.now() - started;
  const semanticPass =
    scheduled.length === scenario.expectedScheduledCount &&
    scheduled[0]?.story.id === scenario.expectedFirstStory;
  return {
    ok: semanticPass,
    scenario: scenario.name,
    seed: scenario.seed,
    stories: scenario.storyCount,
    iterations: scenario.iterations,
    scheduledPerIteration: scheduled.length,
    firstScheduled: scheduled[0]?.story.id ?? null,
    durationMs: Number(durationMs.toFixed(3)),
    iterationsPerSecond: Number(((scenario.iterations * 1000) / durationMs).toFixed(2)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBenchmark();
  console.log(JSON.stringify(result, null, process.argv.includes("--json") ? 0 : 2));
  if (!result.ok) process.exitCode = 1;
}
