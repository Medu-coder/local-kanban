import assert from "node:assert/strict";
import { test } from "node:test";

import { runBenchmark } from "../scripts/benchmark.js";
import { runAgentFlowEvals } from "../scripts/eval-agent-flow.js";

test("evals críticas del flujo agéntico son deterministas", async () => {
  const report = await runAgentFlowEvals();
  assert.equal(report.ok, true, JSON.stringify(report.results));
  assert.equal(report.passed, 6);
  assert.deepEqual(
    report.results.map((item) => item.id),
    [
      "concurrent_claim",
      "expired_lease",
      "invalid_completion",
      "checkpoint_handoff",
      "human_block",
      "fencing_conflict",
    ],
  );
});

test("benchmark largo conserva el resultado semántico esperado", async () => {
  const report = await runBenchmark();
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.stories, 1000);
  assert.equal(report.scheduledPerIteration, 20);
  assert.equal(report.firstScheduled, "STO-0001");
  assert.ok(report.iterationsPerSecond > 0);
});
