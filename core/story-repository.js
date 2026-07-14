import { createHash, randomUUID } from "node:crypto";
import matter from "gray-matter";

import { atomicWriteFile } from "./atomic-write.js";
import { DomainError } from "./errors.js";
import { readFileLimited, resolveEntityPath, resolveProjectPaths } from "./paths.js";
import { validateEpic, validateStory } from "./schema.js";

export function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function serializeStory(story, body = "") {
  validateStory(story);
  return matter.stringify(body, story);
}

export async function readStory(project, storyId) {
  const projectPaths = project.docsRoot ? project : await resolveProjectPaths(project);
  const filePath = await resolveEntityPath(projectPaths, "story", storyId);
  let raw;
  try {
    raw = await readFileLimited(filePath, { rootPath: projectPaths.rootPath, encoding: "utf8" });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new DomainError("story_not_found", "Historia no encontrada.", {
        details: { storyId },
        status: 404,
      });
    }
    throw error;
  }
  const parsed = matter(raw);
  validateStory(parsed.data);
  if (parsed.data.id !== storyId) {
    throw new DomainError("story_id_mismatch", "El ID no coincide con el nombre del fichero.", {
      details: { requested: storyId, documentId: parsed.data.id, filePath },
      status: 409,
    });
  }
  return {
    story: parsed.data,
    body: parsed.content,
    raw,
    hash: hashContent(raw),
    filePath,
    projectPaths,
  };
}

export async function readEpic(project, epicId) {
  const projectPaths = project.docsRoot ? project : await resolveProjectPaths(project);
  const filePath = await resolveEntityPath(projectPaths, "epic", epicId);
  let raw;
  try {
    raw = await readFileLimited(filePath, { rootPath: projectPaths.rootPath, encoding: "utf8" });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new DomainError("epic_not_found", "Épica no encontrada.", {
        details: { epicId },
        status: 404,
      });
    }
    throw error;
  }
  const parsed = matter(raw);
  validateEpic(parsed.data);
  if (parsed.data.id !== epicId) {
    throw new DomainError("epic_id_mismatch", "El ID no coincide con el nombre del fichero.", {
      details: { requested: epicId, documentId: parsed.data.id, filePath },
      status: 409,
    });
  }
  return { epic: parsed.data, body: parsed.content, raw, hash: hashContent(raw), filePath, projectPaths };
}

export async function persistStory({
  project,
  runtime,
  current,
  nextStory,
  body,
  actor,
  idempotencyKey = randomUUID(),
  requestFingerprint = idempotencyKey,
  result: requestedResult,
  writeFile = atomicWriteFile,
}) {
  validateStory(nextStory);
  if (nextStory.id !== current.story.id || nextStory.revision !== current.story.revision + 1) {
    throw new DomainError("revision_conflict", "La escritura no avanza exactamente una revisión.", {
      details: { previous: current.story.revision, target: nextStory.revision },
      status: 409,
    });
  }

  const targetContent = serializeStory(nextStory, body ?? current.body);
  const targetHash = hashContent(targetContent);
  const result = requestedResult ?? {
    storyId: nextStory.id,
    revision: nextStory.revision,
    status: nextStory.status,
    epic: nextStory.epic ?? null,
  };
  const operation = runtime.beginOperation({
    idempotencyKey,
    entityType: "story",
    entityId: nextStory.id,
    actor,
    requestFingerprint,
    previousRevision: current.story.revision,
    previousHash: current.hash,
    targetRevision: nextStory.revision,
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
    await writeFile(current.filePath, targetContent, { rootPath: current.projectPaths.rootPath });
  } catch (error) {
    let currentHash = null;
    try {
      currentHash = hashContent(
        await readFileLimited(current.filePath, {
          rootPath: current.projectPaths.rootPath,
          encoding: "utf8",
        }),
      );
    } catch {
      // Preserve the original write error.
    }
    if (currentHash === current.hash) {
      runtime.failOperation(operation.id, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }

  runtime.completeOperation(operation.id, result);
  return result;
}

export async function recoverPendingOperations(project, runtime) {
  const projectPaths = project.docsRoot ? project : await resolveProjectPaths(project);
  const results = [];

  for (const operation of runtime.listPendingOperations()) {
    if (!["story", "epic"].includes(operation.entity_type)) {
      runtime.quarantineOperation(operation.id, "Tipo de entidad no soportado.");
      results.push({ operationId: operation.id, status: "quarantined" });
      continue;
    }

    try {
      if (hashContent(operation.target_content) !== operation.target_hash) {
        throw new Error("El hash del payload objetivo no coincide.");
      }
      const parsedTarget = matter(operation.target_content);
      const validator = operation.entity_type === "story" ? validateStory : validateEpic;
      validator(parsedTarget.data);
      if (
        parsedTarget.data.id !== operation.entity_id ||
        parsedTarget.data.project !== project.id ||
        parsedTarget.data.revision !== operation.target_revision ||
        operation.target_revision !== operation.previous_revision + 1
      ) {
        throw new Error("ID o revisión objetivo no coinciden con el journal.");
      }
    } catch (error) {
      runtime.quarantineOperation(
        operation.id,
        `Payload objetivo inválido: ${error instanceof Error ? error.message : String(error)}`,
      );
      results.push({ operationId: operation.id, status: "quarantined", action: "invalid_target" });
      continue;
    }

    const filePath = await resolveEntityPath(projectPaths, operation.entity_type, operation.entity_id);
    let currentContent = "";
    try {
      currentContent = await readFileLimited(filePath, {
        rootPath: projectPaths.rootPath,
        encoding: "utf8",
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    const currentHash = hashContent(currentContent);

    if (currentHash === operation.target_hash) {
      runtime.completeOperation(operation.id);
      results.push({ operationId: operation.id, status: "completed", action: "confirmed" });
    } else if (currentHash === operation.previous_hash) {
      await atomicWriteFile(filePath, operation.target_content, { rootPath: projectPaths.rootPath });
      runtime.completeOperation(operation.id);
      results.push({ operationId: operation.id, status: "completed", action: "applied" });
    } else {
      runtime.quarantineOperation(
        operation.id,
        "Markdown no coincide con la revisión anterior ni con el payload objetivo.",
      );
      results.push({ operationId: operation.id, status: "quarantined", action: "conflict" });
    }
  }

  return results;
}
