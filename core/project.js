import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DomainError } from "./errors.js";
import { atomicWriteFile } from "./atomic-write.js";
import { assertNoSymlinkComponents } from "./paths.js";
import { validateProject } from "./schema.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const kanbanRoot = path.resolve(moduleDir, "..");
export const defaultProjectsConfigPath = path.join(kanbanRoot, "config", "projects.json");

const contractMarker = "<!-- local-kanban-contract -->";
const contractText = `${contractMarker}
## Local Kanban

- Invocar \`$local-kanban\` para planificar, reclamar, ejecutar y cerrar trabajo agéntico.
- No editar manualmente \`docs/kanban\`, \`.local-kanban\` ni el registro central salvo recuperación excepcional.
- El orquestador es el único rol que integra y marca historias como \`done\`.
`;

export function slugifyProject(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 50);
}

export async function findProjectRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);

  while (true) {
    try {
      await fs.lstat(path.join(current, ".git"));
      return current;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new DomainError(
        "project_root_not_found",
        "No se encontró una raíz Git desde el directorio actual.",
        { details: { startPath: path.resolve(startPath) } },
      );
    }
    current = parent;
  }
}

async function writeTextAtomic(filePath, content, rootPath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteFile(path.resolve(filePath), content, rootPath ? { rootPath } : {});
}

async function appendLineOnce(filePath, line, rootPath) {
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const lines = content.split(/\r?\n/u);
  if (lines.includes(line)) {
    return false;
  }

  const prefix = content && !content.endsWith("\n") ? "\n" : "";
  await writeTextAtomic(filePath, `${content}${prefix}${line}\n`, rootPath);
  return true;
}

async function ensureAgentContract(projectRoot) {
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  let content = "";
  try {
    content = await fs.readFile(agentsPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (content.includes(contractMarker)) {
    return false;
  }

  const separator = content ? (content.endsWith("\n") ? "\n" : "\n\n") : "";
  await writeTextAtomic(agentsPath, `${content}${separator}${contractText}`, projectRoot);
  return true;
}

async function readRegistry(configPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error("El registro debe ser un array JSON.");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw new DomainError(
      "projects_registry_invalid",
      "No se pudo leer config/projects.json.",
      { details: { configPath, cause: error.message }, status: 500 },
    );
  }
}

export async function getRegisteredProject(options = {}) {
  const rootPath = await findProjectRoot(options.cwd);
  const canonicalRoot = await fs.realpath(rootPath);
  const configPath = options.configPath ?? defaultProjectsConfigPath;
  const projects = await readRegistry(configPath);
  let project = null;
  for (const item of projects) {
    try {
      if ((await fs.realpath(item.rootPath)) === canonicalRoot) {
        project = item;
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  if (!project) {
    throw new DomainError(
      "project_not_registered",
      "El proyecto actual no está registrado. Ejecuta local-kanban init.",
      { details: { rootPath: canonicalRoot, configPath }, status: 404 },
    );
  }
  return { ...project, rootPath: canonicalRoot };
}

export async function registerProject(project, configPath = defaultProjectsConfigPath) {
  validateProject(project);
  const projects = await readRegistry(configPath);
  const normalizedRoot = await fs.realpath(project.rootPath);
  const canonicalProjects = await Promise.all(
    projects.map(async (item) => {
      try {
        return { item, canonicalRoot: await fs.realpath(item.rootPath) };
      } catch (error) {
        if (error.code === "ENOENT") {
          return { item, canonicalRoot: path.resolve(item.rootPath) };
        }
        throw error;
      }
    }),
  );
  const conflict = canonicalProjects.find(
    ({ item, canonicalRoot }) => item.id === project.id && canonicalRoot !== normalizedRoot,
  )?.item;
  if (conflict) {
    throw new DomainError(
      "project_id_conflict",
      `El ID ${project.id} ya pertenece a otro directorio.`,
      {
        details: { existingRoot: conflict.rootPath, requestedRoot: normalizedRoot },
        status: 409,
      },
    );
  }

  const nextProject = { ...project, rootPath: normalizedRoot };
  const existingIndex = canonicalProjects.findIndex(
    ({ item, canonicalRoot }) => item.id === project.id || canonicalRoot === normalizedRoot,
  );
  if (existingIndex === -1) {
    projects.push(nextProject);
  } else {
    projects[existingIndex] = nextProject;
  }

  await writeTextAtomic(configPath, `${JSON.stringify(projects, null, 2)}\n`);
  return nextProject;
}

export async function initializeProject(options = {}) {
  const rootPath = await findProjectRoot(options.cwd);
  const name = String(options.name ?? path.basename(rootPath)).trim();
  const id = String(options.id ?? slugifyProject(name)).trim();
  const docsPath = String(options.docsPath ?? "docs/kanban").trim();

  if (!id || !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/u.test(id)) {
    throw new DomainError("project_id_invalid", "El ID de proyecto no es válido.", {
      details: { id },
    });
  }
  if (!docsPath || path.isAbsolute(docsPath)) {
    throw new DomainError(
      "docs_path_invalid",
      "docsPath debe ser una ruta relativa dentro del proyecto.",
      { details: { docsPath } },
    );
  }

  const docsRoot = path.resolve(rootPath, docsPath);
  const relativeDocs = path.relative(rootPath, docsRoot);
  if (!relativeDocs || relativeDocs.startsWith("..") || path.isAbsolute(relativeDocs)) {
    throw new DomainError(
      "path_escape",
      "docsPath escapa de la raíz del proyecto.",
      { details: { rootPath, docsPath } },
    );
  }

  await assertNoSymlinkComponents(rootPath, docsRoot);
  await assertNoSymlinkComponents(rootPath, path.join(rootPath, ".local-kanban"));
  await assertNoSymlinkComponents(rootPath, path.join(rootPath, ".gitignore"));
  await assertNoSymlinkComponents(rootPath, path.join(rootPath, "AGENTS.md"));
  await fs.mkdir(path.join(docsRoot, "stories"), { recursive: true });
  await fs.mkdir(path.join(docsRoot, "epics"), { recursive: true });
  await fs.mkdir(path.join(rootPath, ".local-kanban"), { recursive: true, mode: 0o700 });
  await appendLineOnce(path.join(rootPath, ".gitignore"), ".local-kanban/", rootPath);
  await ensureAgentContract(rootPath);

  const project = await registerProject(
    {
      schema_version: 1,
      id,
      name,
      rootPath,
      docsPath,
    },
    options.configPath,
  );

  return { project, docsRoot, runtimePath: path.join(rootPath, ".local-kanban", "runtime.sqlite") };
}
