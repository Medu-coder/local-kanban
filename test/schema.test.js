import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../core/errors.js";
import {
  schemaNames,
  validateBlock,
  validateCriterion,
  validateEpic,
  validateEvidence,
  validateProject,
  validateSchema,
  validateStory,
} from "../core/schema.js";

const criterion = {
  id: "tests-pass",
  label: "La suite pasa",
  kind: "manual",
  checked: false,
  evidence_types: ["test"],
};

const story = {
  schema_version: 1,
  revision: 1,
  id: "STO-001",
  type: "story",
  project: "sample-project",
  title: "Aplicar el contrato",
  objective: "Rechazar historias inválidas antes de persistirlas.",
  status: "backlog",
  priority: "high",
  risk: "standard",
  acceptance_criteria: [criterion],
  readiness_criteria: [
    {
      id: "has-context",
      label: "Existe contexto",
      kind: "derived",
      rule: "has_context_files",
    },
  ],
  dependencies: [{ story_id: "STO-000", type: "hard", reason: "Contrato previo" }],
  context_files: ["core/schema.js"],
  validation: { commands: ["node --test test/schema.test.js"] },
  subtasks: [{ id: "write-tests", title: "Escribir tests", done: true }],
  blockers: [],
  evidence: [],
};

test("expone todos los schemas v1 requeridos", () => {
  assert.deepEqual(schemaNames, ["project", "epic", "story", "criterion", "block", "evidence"]);
});

test("valida documentos canónicos sin clonarlos ni mutarlos", () => {
  const project = {
    schema_version: 1,
    id: "sample-project",
    name: "Sample project",
    rootPath: "/tmp/sample-project",
    docsPath: "docs/kanban",
  };
  const epic = {
    schema_version: 1,
    revision: 1,
    id: "EPI-001",
    type: "epic",
    project: "sample-project",
    title: "Integridad",
    objective: "Evitar pérdida silenciosa de trabajo.",
  };
  const block = {
    type: "technical",
    description: "El test falla",
    owner: "codex-test",
    action: "Corregir el contrato",
    resume_condition: "La suite pasa",
    retry: { attempt: 1, max_attempts: 3 },
  };
  const evidence = {
    id: "evidence-001",
    type: "test",
    story_id: "STO-001",
    criterion_id: "tests-pass",
    attempt_id: "attempt-001",
    commit: "abcdef1",
    command: "node --test test/schema.test.js",
    exit_code: 0,
    summary: "Suite correcta",
    recorded_at: "2026-07-14T10:00:00.000Z",
    actor: "codex-test",
  };

  assert.equal(validateProject(project), project);
  assert.equal(validateEpic(epic), epic);
  assert.equal(validateStory(story), story);
  assert.equal(validateCriterion(criterion), criterion);
  assert.equal(validateBlock(block), block);
  assert.equal(validateEvidence(evidence), evidence);
});

test("no aplica coerción, defaults ni eliminación de campos", () => {
  const invalid = structuredClone(story);
  invalid.revision = "1";
  invalid.unknown = true;

  assert.throws(
    () => validateStory(invalid),
    (error) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "schema_invalid");
      assert.equal(error.status, 400);
      assert.equal(error.details.schema, "story");
      assert.ok(error.details.errors.some((item) => item.keyword === "type"));
      assert.ok(error.details.errors.some((item) => item.keyword === "additionalProperties"));
      return true;
    }
  );
  assert.equal(invalid.revision, "1");
  assert.equal(invalid.unknown, true);
});

test("exige los gates mínimos de una historia", () => {
  for (const field of [
    "objective",
    "acceptance_criteria",
    "dependencies",
    "context_files",
    "validation",
    "risk",
  ]) {
    const invalid = structuredClone(story);
    delete invalid[field];
    assert.throws(() => validateStory(invalid), { code: "schema_invalid" }, field);
  }
});

test("distingue criterios manuales y derivados estrictamente", () => {
  assert.throws(
    () => validateCriterion({ id: "bad", label: "Bad", kind: "derived", checked: true }),
    { code: "schema_invalid" }
  );
  assert.throws(
    () => validateCriterion({ id: "bad", label: "Bad", kind: "manual", checked: false, rule: "has_context_files" }),
    { code: "schema_invalid" }
  );
});

test("solo permite retry en bloqueos técnicos", () => {
  assert.throws(
    () =>
      validateBlock({
        type: "human",
        description: "Falta decisión",
        owner: "Eduardo",
        action: "Elegir opción",
        resume_condition: "Decisión registrada",
        retry: { attempt: 0, max_attempts: 2 },
      }),
    { code: "schema_invalid" }
  );
});

test("rechaza schemas desconocidos con un error de integración", () => {
  assert.throws(() => validateSchema("missing", {}), {
    code: "schema_unknown",
    status: 500,
  });
});
