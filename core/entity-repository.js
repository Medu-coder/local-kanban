import { createHash } from "node:crypto";

import matter from "gray-matter";

import { atomicWriteFile } from "./atomic-write.js";
import { DomainError } from "./errors.js";
import { readFileLimited, resolveEntityPath, resolveProjectPaths } from "./paths.js";
import { validateEpic, validateStory } from "./schema.js";

const ENTITY_TYPES = Object.freeze({
  story: {
    documentKey: "story",
    notFoundCode: "story_not_found",
    notFoundMessage: "Historia no encontrada.",
    validator: validateStory,
  },
  epic: {
    documentKey: "epic",
    notFoundCode: "epic_not_found",
    notFoundMessage: "Épica no encontrada.",
    validator: validateEpic,
  },
});

function entityConfig(entityType) {
  const config = ENTITY_TYPES[entityType];
  if (!config) {
    throw new TypeError(`Tipo de entidad no soportado: ${entityType}`);
  }
  return config;
}

export function hashEntityContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function serializeEntity(entityType, entity, body = "") {
  entityConfig(entityType).validator(entity);
  return matter.stringify(body, entity);
}

export async function readEntity(project, entityType, entityId, options = {}) {
  const config = entityConfig(entityType);
  const projectPaths = project.docsRoot ? project : await resolveProjectPaths(project);
  const filePath = await resolveEntityPath(projectPaths, entityType, entityId);
  let raw;
  try {
    raw = await readFileLimited(filePath, {
      rootPath: projectPaths.rootPath,
      encoding: "utf8",
    });
  } catch (error) {
    if (error.code === "ENOENT" && options.allowMissing) {
      return {
        entity: null,
        body: "",
        raw: "",
        hash: hashEntityContent(""),
        filePath,
        projectPaths,
        exists: false,
      };
    }
    if (error.code === "ENOENT") {
      throw new DomainError(config.notFoundCode, config.notFoundMessage, {
        details: { entityId },
        status: 404,
      });
    }
    throw error;
  }

  const parsed = matter(raw);
  config.validator(parsed.data);
  if (parsed.data.id !== entityId) {
    throw new DomainError(`${entityType}_id_mismatch`, "El ID no coincide con el nombre del fichero.", {
      details: { requested: entityId, documentId: parsed.data.id, filePath },
      status: 409,
    });
  }
  return {
    entity: parsed.data,
    body: parsed.content,
    raw,
    hash: hashEntityContent(raw),
    filePath,
    projectPaths,
    exists: true,
    [config.documentKey]: parsed.data,
  };
}

export async function persistEntity({
  project,
  runtime,
  current,
  entityType,
  nextEntity,
  body,
  actor,
  idempotencyKey,
  requestFingerprint,
  result,
  writeFile = atomicWriteFile,
}) {
  const config = entityConfig(entityType);
  config.validator(nextEntity);

  const previousRevision = current.entity?.revision ?? 0;
  if (
    nextEntity.id !== (current.entity?.id ?? nextEntity.id) ||
    nextEntity.revision !== previousRevision + 1
  ) {
    throw new DomainError("revision_conflict", "La escritura no avanza exactamente una revisión.", {
      details: { previous: previousRevision, target: nextEntity.revision },
      status: 409,
    });
  }

  const targetContent = serializeEntity(entityType, nextEntity, body ?? current.body);
  const targetHash = hashEntityContent(targetContent);
  const operation = runtime.beginOperation({
    idempotencyKey,
    entityType,
    entityId: nextEntity.id,
    actor,
    requestFingerprint,
    previousRevision,
    previousHash: current.hash,
    targetRevision: nextEntity.revision,
    targetHash,
    targetContent,
    result,
  });

  if (operation.status === "completed") {
    return operation.result;
  }
  if (operation.status !== "pending") {
    throw new DomainError("operation_not_retryable", "La operación anterior no puede reintentarse.", {
      details: { operationId: operation.id, status: operation.status },
      status: 409,
    });
  }

  try {
    await writeFile(current.filePath, targetContent, {
      rootPath: current.projectPaths.rootPath,
    });
  } catch (error) {
    let currentHash = null;
    try {
      currentHash = hashEntityContent(
        await readFileLimited(current.filePath, {
          rootPath: current.projectPaths.rootPath,
          encoding: "utf8",
        }),
      );
    } catch (readError) {
      if (readError.code === "ENOENT") {
        currentHash = hashEntityContent("");
      }
    }
    if (currentHash === current.hash) {
      runtime.failOperation(operation.id, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }

  runtime.completeOperation(operation.id, result);
  return result;
}

export const readCanonicalStory = (project, storyId, options) =>
  readEntity(project, "story", storyId, options);

export const readCanonicalEpic = (project, epicId, options) =>
  readEntity(project, "epic", epicId, options);
