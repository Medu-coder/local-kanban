import { createHash } from "node:crypto";

import { DomainError } from "./errors.js";
import {
  persistEntity,
  readCanonicalEpic,
  readCanonicalStory,
} from "./entity-repository.js";
import { resolveProjectPaths } from "./paths.js";
import { openRuntime } from "./runtime.js";
import { validateEpic, validateProject, validateStory } from "./schema.js";
import { recoverPendingOperations } from "./story-repository.js";

const IMMUTABLE_FIELDS = Object.freeze(["schema_version", "revision", "id", "type", "project"]);

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function commandFingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function assertCommandEnvelope(options, minimumRevision) {
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < minimumRevision) {
    throw new DomainError("command_invalid", "expectedRevision no es válido.", {
      details: { expectedRevision: options.expectedRevision, minimumRevision },
    });
  }
  if (typeof options.idempotencyKey !== "string" || !options.idempotencyKey.trim()) {
    throw new DomainError("command_invalid", "idempotencyKey es obligatorio.");
  }
  if (typeof options.actor !== "string" || !options.actor.trim()) {
    throw new DomainError("command_invalid", "actor es obligatorio.");
  }
  if (!options.project) {
    throw new DomainError("command_invalid", "project es obligatorio.");
  }
}

function assertCreateRevision(options) {
  assertCommandEnvelope(options, 0);
  if (options.expectedRevision !== 0) {
    throw new DomainError("revision_conflict", "La creación exige expectedRevision 0.", {
      details: { expected: options.expectedRevision, actual: 0 },
      status: 409,
    });
  }
}

function assertUpdateRevision(options) {
  assertCommandEnvelope(options, 1);
}

function assertProjectMembership(entity, project, entityType) {
  if (entity.project !== project.id) {
    throw new DomainError("project_mismatch", `La ${entityType === "story" ? "historia" : "épica"} pertenece a otro proyecto.`, {
      details: { entityId: entity.id, documentProject: entity.project, projectId: project.id },
      status: 409,
    });
  }
}

function buildUpdatedEntity(current, replacement, patch) {
  if (replacement !== undefined && patch !== undefined) {
    throw new DomainError("command_invalid", "Usa entity o patch, pero no ambos.");
  }
  if (replacement === undefined && patch === undefined) {
    throw new DomainError("command_invalid", "Falta el contenido de la actualización.");
  }

  if (patch !== undefined) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new DomainError("command_invalid", "patch debe ser un objeto.");
    }
    for (const field of IMMUTABLE_FIELDS) {
      if (Object.hasOwn(patch, field)) {
        throw new DomainError("immutable_field", `No se puede modificar ${field}.`, {
          details: { field },
          status: 409,
        });
      }
    }
    return { ...current, ...patch, revision: current.revision + 1 };
  }

  if (!replacement || typeof replacement !== "object" || Array.isArray(replacement)) {
    throw new DomainError("command_invalid", "entity debe ser un objeto.");
  }
  for (const field of ["schema_version", "id", "type", "project"]) {
    if (replacement[field] !== current[field]) {
      throw new DomainError("immutable_field", `No se puede modificar ${field}.`, {
        details: { field },
        status: 409,
      });
    }
  }
  if (replacement.revision !== undefined && replacement.revision !== current.revision) {
    throw new DomainError("revision_conflict", "La revisión del payload no coincide con la actual.", {
      details: { payload: replacement.revision, actual: current.revision },
      status: 409,
    });
  }
  return { ...replacement, revision: current.revision + 1 };
}

async function executeCanonical(options, intent, callback) {
  const project = validateProject(options.project);
  const paths = await resolveProjectPaths(project);
  const runtime = openRuntime(paths.rootPath);
  const fingerprint = commandFingerprint(intent);
  const idempotencyKey = options.idempotencyKey.trim();
  try {
    let existing = runtime.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.request_fingerprint !== fingerprint) {
        throw new DomainError("idempotency_conflict", "La clave de idempotencia ya se utilizó con otra intención.", {
          details: { idempotencyKey },
          status: 409,
        });
      }
      if (existing.status === "pending") {
        await recoverPendingOperations(paths, runtime);
        existing = runtime.getByIdempotencyKey(idempotencyKey);
      }
      if (existing.status === "completed") {
        return existing.result;
      }
      throw new DomainError("operation_not_retryable", "La operación no puede reintentarse.", {
        details: { operationId: existing.id, status: existing.status },
        status: 409,
      });
    }

    await recoverPendingOperations(paths, runtime);
    return await callback({ project, paths, runtime, fingerprint, idempotencyKey });
  } finally {
    runtime.close();
  }
}

function createResult(entityType, entity) {
  const idKey = entityType === "story" ? "storyId" : "epicId";
  return {
    id: entity.id,
    [idKey]: entity.id,
    revision: entity.revision,
    [entityType]: entity,
  };
}

async function createEntityCommand(entityType, options) {
  assertCreateRevision(options);
  if (options.body !== undefined && typeof options.body !== "string") {
    throw new DomainError("command_invalid", "body debe ser texto.");
  }
  const entity = options[entityType];
  const validator = entityType === "story" ? validateStory : validateEpic;
  validator(entity);
  const intent = {
    command: `create_${entityType}`,
    entity,
    body: options.body ?? "",
    expectedRevision: options.expectedRevision,
    actor: options.actor.trim(),
  };

  return executeCanonical(options, intent, async ({ project, paths, runtime, fingerprint, idempotencyKey }) => {
    assertProjectMembership(entity, project, entityType);
    if (entity.revision !== 1) {
      throw new DomainError("revision_conflict", "Una entidad nueva debe comenzar en revisión 1.", {
        details: { target: entity.revision },
        status: 409,
      });
    }
    const current = entityType === "story"
      ? await readCanonicalStory(paths, entity.id, { allowMissing: true })
      : await readCanonicalEpic(paths, entity.id, { allowMissing: true });
    if (current.exists) {
      throw new DomainError(`${entityType}_already_exists`, "La entidad ya existe.", {
        details: { entityId: entity.id },
        status: 409,
      });
    }
    const result = createResult(entityType, entity);
    return persistEntity({
      project: paths,
      runtime,
      current,
      entityType,
      nextEntity: entity,
      body: options.body ?? "",
      actor: options.actor.trim(),
      idempotencyKey,
      requestFingerprint: fingerprint,
      result,
    });
  });
}

async function updateEntityCommand(entityType, options) {
  assertUpdateRevision(options);
  if (Object.hasOwn(options, "body")) {
    throw new DomainError("body_preserved", "El body Markdown no se modifica mediante update.", {
      status: 409,
    });
  }
  const entityId = options[`${entityType}Id`];
  const replacement = options[entityType];
  const intent = {
    command: `update_${entityType}`,
    entityId,
    entity: replacement ?? null,
    patch: options.patch ?? null,
    expectedRevision: options.expectedRevision,
    actor: options.actor.trim(),
  };

  return executeCanonical(options, intent, async ({ project, paths, runtime, fingerprint, idempotencyKey }) => {
    const current = entityType === "story"
      ? await readCanonicalStory(paths, entityId)
      : await readCanonicalEpic(paths, entityId);
    assertProjectMembership(current.entity, project, entityType);
    if (current.entity.revision !== options.expectedRevision) {
      throw new DomainError("revision_conflict", "La revisión esperada no coincide con la actual.", {
        details: { expected: options.expectedRevision, actual: current.entity.revision },
        status: 409,
      });
    }
    const nextEntity = buildUpdatedEntity(current.entity, replacement, options.patch);
    (entityType === "story" ? validateStory : validateEpic)(nextEntity);
    const result = createResult(entityType, nextEntity);
    return persistEntity({
      project: paths,
      runtime,
      current,
      entityType,
      nextEntity,
      actor: options.actor.trim(),
      idempotencyKey,
      requestFingerprint: fingerprint,
      result,
    });
  });
}

function criterionField(criteriaType) {
  if (["ready", "readiness", "readiness_criteria"].includes(criteriaType)) {
    return "readiness_criteria";
  }
  if (["done", "acceptance", "acceptance_criteria"].includes(criteriaType)) {
    return "acceptance_criteria";
  }
  throw new DomainError("command_invalid", "Tipo de criterio no soportado.", {
    details: { criteriaType },
  });
}

function selectedIndex(items, id, index, entityName) {
  const idProvided = id !== undefined && id !== null;
  const indexProvided = index !== undefined && index !== null;
  if (idProvided === indexProvided) {
    throw new DomainError("command_invalid", `Indica ${entityName}Id o ${entityName}Index, exclusivamente.`);
  }
  if (indexProvided) {
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new DomainError("command_invalid", `${entityName}Index no es válido.`, {
        details: { index },
      });
    }
    if (!items[index]) {
      throw new DomainError(`${entityName}_not_found`, `${entityName} no encontrado.`, {
        details: { index },
        status: 404,
      });
    }
    return index;
  }
  if (typeof id !== "string" || !id.trim() || id !== id.trim()) {
    throw new DomainError("command_invalid", `${entityName}Id no es válido.`, {
      details: { id },
    });
  }
  const matches = items.flatMap((item, itemIndex) => item.id === id ? [itemIndex] : []);
  if (matches.length !== 1) {
    throw new DomainError(
      matches.length === 0 ? `${entityName}_not_found` : `${entityName}_ambiguous`,
      matches.length === 0 ? `${entityName} no encontrado.` : `${entityName} ambiguo.`,
      { details: { id }, status: matches.length === 0 ? 404 : 409 },
    );
  }
  return matches[0];
}

export const createStoryCommand = (options) => createEntityCommand("story", options);
export const updateStoryCommand = (options) => updateEntityCommand("story", options);
export const createEpicCommand = (options) => createEntityCommand("epic", options);
export const updateEpicCommand = (options) => updateEntityCommand("epic", options);

export async function toggleStoryCriterionCommand(options) {
  assertUpdateRevision(options);
  const field = criterionField(options.criteriaType);
  const intent = {
    command: "toggle_story_criterion",
    storyId: options.storyId,
    criteriaType: field,
    criterionId: options.criterionId ?? null,
    criterionIndex: options.criterionIndex ?? null,
    expectedRevision: options.expectedRevision,
    actor: options.actor.trim(),
  };
  return executeCanonical(options, intent, async ({ project, paths, runtime, fingerprint, idempotencyKey }) => {
    const current = await readCanonicalStory(paths, options.storyId);
    assertProjectMembership(current.entity, project, "story");
    if (current.entity.revision !== options.expectedRevision) {
      throw new DomainError("revision_conflict", "La revisión esperada no coincide con la actual.", {
        details: { expected: options.expectedRevision, actual: current.entity.revision },
        status: 409,
      });
    }
    const criteria = [...(current.entity[field] ?? [])];
    const index = selectedIndex(criteria, options.criterionId, options.criterionIndex, "criterion");
    if (criteria[index].kind !== "manual") {
      throw new DomainError("criterion_derived", "Solo se pueden modificar criterios manuales.", {
        details: { criterionId: criteria[index].id },
        status: 409,
      });
    }
    criteria[index] = { ...criteria[index], checked: !criteria[index].checked };
    const nextStory = { ...current.entity, revision: current.entity.revision + 1, [field]: criteria };
    validateStory(nextStory);
    const result = {
      ...createResult("story", nextStory),
      criteriaType: field,
      criteria,
      toggledCriterion: criteria[index],
    };
    return persistEntity({
      project: paths,
      runtime,
      current,
      entityType: "story",
      nextEntity: nextStory,
      actor: options.actor.trim(),
      idempotencyKey,
      requestFingerprint: fingerprint,
      result,
    });
  });
}

export async function toggleStorySubtaskCommand(options) {
  assertUpdateRevision(options);
  const intent = {
    command: "toggle_story_subtask",
    storyId: options.storyId,
    subtaskId: options.subtaskId ?? null,
    subtaskIndex: options.subtaskIndex ?? null,
    expectedRevision: options.expectedRevision,
    actor: options.actor.trim(),
  };
  return executeCanonical(options, intent, async ({ project, paths, runtime, fingerprint, idempotencyKey }) => {
    const current = await readCanonicalStory(paths, options.storyId);
    assertProjectMembership(current.entity, project, "story");
    if (current.entity.revision !== options.expectedRevision) {
      throw new DomainError("revision_conflict", "La revisión esperada no coincide con la actual.", {
        details: { expected: options.expectedRevision, actual: current.entity.revision },
        status: 409,
      });
    }
    const subtasks = [...(current.entity.subtasks ?? [])];
    const index = selectedIndex(subtasks, options.subtaskId, options.subtaskIndex, "subtask");
    subtasks[index] = { ...subtasks[index], done: !subtasks[index].done };
    const nextStory = { ...current.entity, revision: current.entity.revision + 1, subtasks };
    validateStory(nextStory);
    const result = {
      ...createResult("story", nextStory),
      subtasks,
      toggledSubtask: subtasks[index],
    };
    return persistEntity({
      project: paths,
      runtime,
      current,
      entityType: "story",
      nextEntity: nextStory,
      actor: options.actor.trim(),
      idempotencyKey,
      requestFingerprint: fingerprint,
      result,
    });
  });
}
