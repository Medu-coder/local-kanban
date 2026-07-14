import assert from "node:assert/strict";
import { test } from "node:test";

import { transitionStory } from "../core/story.js";
import { createEvidence, createStory } from "./helpers.js";

test("developing exige readiness y dependencias hard completas", () => {
  const story = createStory({
    readiness_criteria: [
      { id: "approved", label: "Aprobado", kind: "manual", checked: false },
    ],
    dependencies: [{ story_id: "STO-000", type: "hard" }],
  });

  assert.throws(
    () =>
      transitionStory(
        story,
        { expectedRevision: 1, nextStatus: "developing", actorRole: "orchestrator" },
        { "STO-000": "backlog" },
      ),
    (error) => error.code === "readiness_incomplete" && error.status === 409,
  );
});

test("una transición válida incrementa exactamente una revisión", () => {
  const result = transitionStory(createStory(), {
    expectedRevision: 1,
    nextStatus: "developing",
    actorRole: "orchestrator",
  });

  assert.equal(result.story.status, "developing");
  assert.equal(result.story.revision, 2);
  assert.equal(result.gates.isReady, true);
});

test("solo el orquestador puede cerrar", () => {
  const story = createStory({
    status: "testing",
    acceptance_criteria: [
      { id: "tests-pass", label: "Tests pasan", kind: "manual", checked: true },
    ],
    subtasks: [{ id: "implement", title: "Implementar", done: true }],
    evidence: [createEvidence()],
  });

  assert.throws(
    () =>
      transitionStory(story, {
        expectedRevision: 1,
        nextStatus: "done",
        actorRole: "specialist",
      }),
    (error) => error.code === "orchestrator_required" && error.status === 403,
  );
});

test("done exige aceptación, subtareas y evidencia", () => {
  const story = createStory({ status: "testing" });

  assert.throws(
    () =>
      transitionStory(story, {
        expectedRevision: 1,
        nextStatus: "done",
        actorRole: "orchestrator",
      }),
    (error) =>
      error.code === "completion_incomplete" &&
      error.details.evidenceRequired === true &&
      error.details.pendingSubtasks.includes("implement"),
  );
});

test("riesgo high exige evidencia de review independiente", () => {
  const story = createStory({
    status: "testing",
    risk: "high",
    acceptance_criteria: [
      { id: "tests-pass", label: "Tests pasan", kind: "manual", checked: true },
    ],
    subtasks: [{ id: "implement", title: "Implementar", done: true }],
    evidence: [createEvidence()],
  });

  assert.throws(
    () =>
      transitionStory(story, {
        expectedRevision: 1,
        nextStatus: "done",
        actorRole: "orchestrator",
      }),
    (error) => error.code === "completion_incomplete" && error.details.reviewRequired === true,
  );

  const completed = transitionStory(
    {
      ...story,
      evidence: [
        ...story.evidence,
        {
          ...createEvidence("STO-001", "review"),
          actor: "independent-reviewer",
          attempt_id: "review-attempt-1",
        },
      ],
    },
    { expectedRevision: 1, nextStatus: "done", actorRole: "orchestrator" },
  );
  assert.equal(completed.story.status, "done");
});

test("un review del mismo actor o intento no cuenta como independiente", () => {
  const implementation = createEvidence();
  const story = createStory({
    status: "testing",
    risk: "high",
    acceptance_criteria: [
      { id: "tests-pass", label: "Tests pasan", kind: "manual", checked: true },
    ],
    subtasks: [{ id: "implement", title: "Implementar", done: true }],
    evidence: [implementation, createEvidence("STO-001", "review")],
  });

  assert.throws(
    () =>
      transitionStory(story, {
        expectedRevision: 1,
        nextStatus: "done",
        actorRole: "orchestrator",
      }),
    (error) => error.code === "completion_incomplete" && error.details.reviewRequired === true,
  );
});

test("evidencia adicional no puede hacer independiente el review del implementador", () => {
  const implementation = createEvidence();
  const story = createStory({
    status: "testing",
    risk: "high",
    acceptance_criteria: [
      { id: "tests-pass", label: "Tests pasan", kind: "manual", checked: true },
    ],
    subtasks: [{ id: "implement", title: "Implementar", done: true }],
    evidence: [
      implementation,
      { ...createEvidence(), id: "evidence-lint", type: "lint", actor: "automation", attempt_id: "lint-1" },
      createEvidence("STO-001", "review"),
    ],
  });

  assert.throws(
    () =>
      transitionStory(story, {
        expectedRevision: 1,
        nextStatus: "done",
        actorRole: "orchestrator",
      }),
    (error) => error.code === "completion_incomplete" && error.details.reviewRequired === true,
  );
});

test("un blocker activo impide desarrollar o cerrar", () => {
  const story = createStory({
    blockers: [
      {
        type: "human",
        description: "Falta decisión",
        owner: "Eduardo",
        action: "Elegir opción",
        resume_condition: "Decisión registrada",
      },
    ],
  });

  assert.throws(
    () =>
      transitionStory(story, {
        expectedRevision: 1,
        nextStatus: "developing",
        actorRole: "orchestrator",
      }),
    (error) => error.code === "readiness_incomplete" && error.details.blockers.includes("human"),
  );
});

test("CAS rechaza una revisión obsoleta", () => {
  assert.throws(
    () =>
      transitionStory(createStory({ revision: 3 }), {
        expectedRevision: 2,
        nextStatus: "developing",
        actorRole: "orchestrator",
      }),
    (error) => error.code === "revision_conflict" && error.details.actual === 3,
  );
});
