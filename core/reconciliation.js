import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

import { hashContent } from "./story-repository.js";
import { readFileLimited, resolveProjectPaths } from "./paths.js";
import { validateEpic, validateStory } from "./schema.js";

async function markdownFiles(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function reconcileProjectDocuments(project, runtime, options = {}) {
  const paths = project.docsRoot ? project : await resolveProjectPaths(project);
  const results = [];
  for (const [entityType, directory, validate] of [
    ["epic", paths.epicsDir, validateEpic],
    ["story", paths.storiesDir, validateStory],
  ]) {
    for (const filePath of await markdownFiles(directory)) {
      try {
        const raw = await readFileLimited(filePath, { rootPath: paths.rootPath, encoding: "utf8" });
        const parsed = matter(raw);
        validate(parsed.data);
        const expectedId = path.basename(filePath, ".md");
        if (parsed.data.id !== expectedId || parsed.data.project !== project.id) {
          throw new Error("ID, nombre de fichero o proyecto no coinciden.");
        }
        results.push(
          runtime.reconcileDocument({
            entityType,
            entityId: parsed.data.id,
            revision: parsed.data.revision,
            contentHash: hashContent(raw),
            actor: options.actor ?? "watcher",
          }),
        );
      } catch (error) {
        const entityId = path.basename(filePath, ".md");
        runtime.quarantineEntity({
          entityType,
          entityId,
          reason: "invalid_document",
          actor: options.actor ?? "watcher",
          details: { filePath, error: error.code ?? "invalid_document", message: error.message },
        });
        results.push({ status: "quarantined", entityType, entityId, reason: "invalid_document" });
      }
    }
  }
  return results;
}
