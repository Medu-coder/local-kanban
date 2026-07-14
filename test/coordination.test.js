import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOperationalCapsule, scheduleStories } from "../core/coordination.js";
import { DEFAULT_LEASE_DURATION_MS, openRuntime } from "../core/runtime.js";
import { createProjectFixture, createStory } from "./helpers.js";

const start = "2026-07-14T10:00:00.000Z";

test("claim es atómico y asigna un lease de 30 minutos", async () => {
  const fixture = await createProjectFixture();
  const first = openRuntime(fixture.rootPath);
  const second = openRuntime(fixture.rootPath);
  try {
    const claimed = first.claimStory({ storyId: "STO-001", agentId: "agent-a", now: start });
    assert.equal(claimed.claim.fencingToken, 1);
    assert.equal(
      new Date(claimed.claim.leaseExpiresAt).getTime() - new Date(start).getTime(),
      DEFAULT_LEASE_DURATION_MS,
    );
    const renewed = first.renewClaim({
      storyId: "STO-001",
      attemptId: claimed.attempt.id,
      fencingToken: claimed.claim.fencingToken,
      agentId: "agent-a",
      now: "2026-07-14T10:05:00.000Z",
    });
    assert.equal(renewed.leaseExpiresAt, "2026-07-14T10:35:00.000Z");
    assert.equal(
      first.verifyClaim({
        storyId: "STO-001",
        attemptId: claimed.attempt.id,
        fencingToken: claimed.claim.fencingToken,
        now: "2026-07-14T10:06:00.000Z",
      }).attemptId,
      claimed.attempt.id,
    );
    assert.throws(
      () =>
        first.verifyClaim({
          storyId: "STO-001",
          attemptId: claimed.attempt.id,
          fencingToken: claimed.claim.fencingToken + 1,
          now: "2026-07-14T10:06:00.000Z",
        }),
      (error) => error.code === "fencing_conflict",
    );
    assert.throws(
      () => second.claimStory({ storyId: "STO-001", agentId: "agent-b", now: start }),
      (error) => error.code === "story_already_claimed" && error.status === 409,
    );
  } finally {
    second.close();
    first.close();
    await fixture.cleanup();
  }
});

test("lease stale bloquea reasignación hasta release y el fencing crece", async () => {
  const fixture = await createProjectFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const first = runtime.claimStory({ storyId: "STO-001", agentId: "agent-a", now: start });
    const expiredAt = "2026-07-14T10:31:00.000Z";
    assert.equal(runtime.markStaleClaims({ now: expiredAt }).length, 1);
    assert.throws(
      () => runtime.claimStory({ storyId: "STO-001", agentId: "agent-b", now: expiredAt }),
      (error) => error.code === "stale_claim_requires_release",
    );
    assert.throws(
      () =>
        runtime.verifyClaim({
          storyId: "STO-001",
          attemptId: first.attempt.id,
          fencingToken: first.claim.fencingToken,
          now: expiredAt,
        }),
      (error) => error.code === "lease_stale",
    );
    runtime.releaseClaim({
      storyId: "STO-001",
      attemptId: first.attempt.id,
      fencingToken: first.claim.fencingToken,
      actor: "orchestrator",
      now: expiredAt,
    });
    const second = runtime.claimStory({ storyId: "STO-001", agentId: "agent-b", now: expiredAt });
    assert.equal(second.claim.fencingToken, 2);
    assert.throws(
      () =>
        runtime.verifyClaim({
          storyId: "STO-001",
          attemptId: first.attempt.id,
          fencingToken: first.claim.fencingToken,
          now: expiredAt,
        }),
      (error) => ["claim_owned_by_other", "fencing_conflict"].includes(error.code),
    );
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("checkpoint y bloqueos renuevan lease y dejan auditoría compacta", async () => {
  const fixture = await createProjectFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const claimed = runtime.claimStory({ storyId: "STO-001", agentId: "agent-a", now: start });
    const identity = {
      storyId: "STO-001",
      attemptId: claimed.attempt.id,
      fencingToken: claimed.claim.fencingToken,
      agentId: "agent-a",
    };
    const checkpoint = runtime.recordCheckpoint({
      ...identity,
      summary: "Implementación base lista",
      payload: { tests: ["npm run test:unit"], nextAction: "validar" },
      now: "2026-07-14T10:10:00.000Z",
    });
    assert.equal(checkpoint.checkpoint.payload.nextAction, "validar");
    assert.equal(checkpoint.claim.leaseExpiresAt, "2026-07-14T10:40:00.000Z");
    const verifying = runtime.setOperationalStatus({
      ...identity,
      operationalStatus: "verifying",
      now: "2026-07-14T10:11:00.000Z",
    });
    assert.equal(verifying.attempt.operationalStatus, "verifying");

    const opened = runtime.addBlock({
      ...identity,
      type: "human",
      description: "Falta decisión de alcance",
      owner: "Eduardo",
      action: "Elegir compatibilidad",
      resumeCondition: "Decisión registrada",
      now: "2026-07-14T10:12:00.000Z",
    });
    assert.equal(runtime.getCoordinationState("STO-001", { now: "2026-07-14T10:12:01.000Z" }).operationalStatus, "waiting");
    runtime.resolveBlock({
      ...identity,
      blockId: opened.block.id,
      actor: "orchestrator",
      now: "2026-07-14T10:13:00.000Z",
    });
    const state = runtime.getCoordinationState("STO-001", { now: "2026-07-14T10:13:01.000Z" });
    assert.equal(state.operationalStatus, "running");
    assert.equal(state.blocks.length, 0);
    assert.equal(state.checkpoint.summary, "Implementación base lista");
    assert.deepEqual(
      runtime.listAuditEvents({ storyId: "STO-001" }).map((event) => event.eventType),
      [
        "claim_acquired",
        "checkpoint_recorded",
        "operational_status_changed",
        "block_opened",
        "block_resolved",
      ],
    );
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});

test("scheduler aplica rank, prioridad, desbloqueos e ID de forma determinista", () => {
  const stories = [
    createStory({ id: "STO-D", rank: 1, priority: "high", execution_mode: "agent" }),
    createStory({ id: "STO-C", rank: 0, priority: "low", execution_mode: "agent" }),
    createStory({ id: "STO-B", rank: 1, priority: "high", execution_mode: "agent" }),
    createStory({
      id: "STO-A",
      rank: 1,
      priority: "high",
      execution_mode: "agent",
      dependencies: [{ story_id: "STO-B", type: "hard" }],
    }),
  ];
  const scheduled = scheduleStories(stories, { wipLimit: 3 });
  assert.deepEqual(scheduled.map((item) => item.story.id), ["STO-C", "STO-B", "STO-D"]);
  assert.equal(scheduled[1].unlockCount, 1);
});

test("cápsula incluye solo estado operativo y contexto accionable", async () => {
  const fixture = await createProjectFixture();
  const runtime = openRuntime(fixture.rootPath);
  try {
    const story = createStory({ scope: ["core/**"] });
    const claimed = runtime.claimStory({ storyId: story.id, agentId: "agent-a", now: start });
    runtime.addBlock({
      storyId: story.id,
      attemptId: claimed.attempt.id,
      fencingToken: claimed.claim.fencingToken,
      type: "environment",
      description: "Entorno no disponible",
      owner: "orchestrator",
      action: "Restaurar entorno",
      resumeCondition: "Entorno disponible",
      now: start,
    });
    const coordination = runtime.getCoordinationState(story.id, { now: start });
    const capsule = buildOperationalCapsule({
      story,
      coordination,
      gates: { isReady: true },
      nextAction: "implementar",
    });
    assert.equal(capsule.execution.attemptId, claimed.attempt.id);
    assert.equal(capsule.nextAction, "implementar");
    assert.equal(capsule.objective, story.objective);
    assert.deepEqual(capsule.gates.activeBlockers, ["environment"]);
    assert.equal(capsule.gates.isReady, false);
    assert.equal(capsule.blocks[0].id, coordination.blocks[0].id);
    assert.equal(capsule.blocks[0].description, "Entorno no disponible");
    assert.equal("history" in capsule, false);
  } finally {
    runtime.close();
    await fixture.cleanup();
  }
});
