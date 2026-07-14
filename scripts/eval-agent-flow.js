import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { openRuntime } from "../core/runtime.js";
import { transitionStory } from "../core/story.js";

async function withRuntime(run) {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-eval-"));
  await fs.mkdir(path.join(rootPath, ".git"));
  const runtime = openRuntime(rootPath);
  try {
    return await run(runtime, rootPath);
  } finally {
    runtime.close();
    await fs.rm(rootPath, { recursive: true, force: true });
  }
}

async function expectCode(action, expectedCodes) {
  try {
    await action();
    return { pass: false, observed: "no_error" };
  } catch (error) {
    const allowed = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
    return { pass: allowed.includes(error.code), observed: error.code ?? error.name };
  }
}

function closableStory(overrides = {}) {
  return {
    schema_version: 1,
    revision: 3,
    id: "STO-001",
    type: "story",
    project: "eval-project",
    title: "Evaluar cierre",
    objective: "Impedir cierres sin evidencia.",
    status: "testing",
    priority: "medium",
    risk: "standard",
    acceptance_criteria: [{ id: "accepted", label: "Aceptado", kind: "manual", checked: false }],
    readiness_criteria: [],
    dependencies: [],
    context_files: ["core/story.js"],
    validation: { commands: ["npm run test:unit"] },
    subtasks: [{ id: "implementation", title: "Implementar", done: true }],
    ...overrides,
  };
}

const scenarios = [
  {
    id: "concurrent_claim",
    run: () => withRuntime(async (first, rootPath) => {
      const second = openRuntime(rootPath);
      try {
        first.claimStory({ storyId: "STO-001", agentId: "agent-a", now: "2026-07-14T10:00:00Z" });
        return expectCode(
          () => second.claimStory({ storyId: "STO-001", agentId: "agent-b", now: "2026-07-14T10:00:01Z" }),
          "story_already_claimed",
        );
      } finally {
        second.close();
      }
    }),
  },
  {
    id: "expired_lease",
    run: () => withRuntime(async (runtime) => {
      const acquired = runtime.claimStory({ storyId: "STO-001", agentId: "agent-a", now: "2026-07-14T10:00:00Z" });
      return expectCode(
        () => runtime.renewClaim({
          storyId: "STO-001",
          attemptId: acquired.attempt.id,
          fencingToken: acquired.claim.fencingToken,
          now: "2026-07-14T10:31:00Z",
        }),
        "lease_stale",
      );
    }),
  },
  {
    id: "invalid_completion",
    run: async () => expectCode(
      () => transitionStory(
        closableStory(),
        { expectedRevision: 3, nextStatus: "done", actorRole: "orchestrator" },
      ),
      "completion_incomplete",
    ),
  },
  {
    id: "checkpoint_handoff",
    run: () => withRuntime(async (runtime) => {
      const first = runtime.claimStory({ storyId: "STO-001", agentId: "agent-a", now: "2026-07-14T10:00:00Z" });
      runtime.recordCheckpoint({
        storyId: "STO-001",
        attemptId: first.attempt.id,
        fencingToken: first.claim.fencingToken,
        summary: "Implementación lista para continuar",
        payload: { nextAction: "validar" },
        now: "2026-07-14T10:05:00Z",
      });
      runtime.releaseClaim({
        storyId: "STO-001",
        attemptId: first.attempt.id,
        fencingToken: first.claim.fencingToken,
        outcome: "released",
        now: "2026-07-14T10:06:00Z",
      });
      const second = runtime.claimStory({ storyId: "STO-001", agentId: "agent-b", now: "2026-07-14T10:07:00Z" });
      const state = runtime.getCoordinationState("STO-001", { now: "2026-07-14T10:07:01Z" });
      return {
        pass: second.claim.fencingToken === 2 && state.checkpoint?.payload.nextAction === "validar",
        observed: { fencingToken: second.claim.fencingToken, checkpoint: state.checkpoint?.summary },
      };
    }),
  },
  {
    id: "human_block",
    run: () => withRuntime(async (runtime) => {
      const acquired = runtime.claimStory({ storyId: "STO-001", agentId: "agent-a", now: "2026-07-14T10:00:00Z" });
      runtime.addBlock({
        storyId: "STO-001",
        attemptId: acquired.attempt.id,
        fencingToken: acquired.claim.fencingToken,
        type: "human",
        description: "Hace falta una decisión de producto",
        owner: "human",
        action: "Elegir política",
        resumeCondition: "Decisión registrada",
        now: "2026-07-14T10:02:00Z",
      });
      const state = runtime.getCoordinationState("STO-001", { now: "2026-07-14T10:02:01Z" });
      return {
        pass: state.operationalStatus === "waiting" && state.blocks[0]?.type === "human",
        observed: { operationalStatus: state.operationalStatus, blockType: state.blocks[0]?.type },
      };
    }),
  },
  {
    id: "fencing_conflict",
    run: () => withRuntime(async (runtime) => {
      const first = runtime.claimStory({ storyId: "STO-001", agentId: "agent-a", now: "2026-07-14T10:00:00Z" });
      runtime.releaseClaim({
        storyId: "STO-001",
        attemptId: first.attempt.id,
        fencingToken: first.claim.fencingToken,
        now: "2026-07-14T10:01:00Z",
      });
      runtime.claimStory({ storyId: "STO-001", agentId: "agent-b", now: "2026-07-14T10:02:00Z" });
      return expectCode(
        () => runtime.renewClaim({
          storyId: "STO-001",
          attemptId: first.attempt.id,
          fencingToken: first.claim.fencingToken,
          now: "2026-07-14T10:03:00Z",
        }),
        ["claim_owned_by_other", "fencing_conflict"],
      );
    }),
  },
];

export async function runAgentFlowEvals() {
  const results = [];
  for (const scenario of scenarios) {
    try {
      results.push({ id: scenario.id, ...(await scenario.run()) });
    } catch (error) {
      results.push({ id: scenario.id, pass: false, observed: error.code ?? error.message });
    }
  }
  return {
    ok: results.every((item) => item.pass),
    passed: results.filter((item) => item.pass).length,
    total: results.length,
    results,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await runAgentFlowEvals();
  console.log(JSON.stringify(report, null, process.argv.includes("--json") ? 0 : 2));
  if (!report.ok) process.exitCode = 1;
}
