import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const e2eRoot = path.join(repoRoot, ".e2e");
export const sourceProjectRoot = path.join(repoRoot, "e2e", "fixtures", "source-project");
export const workspaceRoot = path.join(e2eRoot, "workspace");
export const projectRoot = path.join(workspaceRoot, "sample-project");
export const configPath = path.join(e2eRoot, "projects.json");

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

export async function resetFixtureWorkspace() {
  await fs.mkdir(e2eRoot, { recursive: true });
  await removeIfExists(projectRoot);
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.cp(sourceProjectRoot, projectRoot, { recursive: true });

  const config = [
    {
      id: "sample-project",
      name: "Proyecto de ejemplo",
      rootPath: projectRoot,
      docsPath: "docs/kanban",
    },
  ];

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

export function getStoryPath(storyId) {
  return path.join(projectRoot, "docs", "kanban", "stories", `${storyId}.md`);
}

export function getEpicPath(epicId) {
  return path.join(projectRoot, "docs", "kanban", "epics", `${epicId}.md`);
}

export async function updateMarkdownFrontmatter(filePath, update) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw);
  const nextData =
    typeof update === "function" ? update(structuredClone(parsed.data ?? {})) : { ...(parsed.data ?? {}), ...update };
  const nextContent = matter.stringify(parsed.content, nextData);
  await fs.writeFile(filePath, nextContent, "utf8");
}
