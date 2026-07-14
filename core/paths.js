import fs from "node:fs/promises";
import path from "node:path";

export const MAX_MARKDOWN_BYTES = 1024 * 1024;

const ENTITY_ID_PATTERN = /^(STO|EPI)-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/u;
const ENTITY_PREFIXES = {
  story: "STO",
  epic: "EPI",
  STO: "STO",
  EPI: "EPI",
};

export class FilesystemSafetyError extends Error {
  constructor(message, code = "FILESYSTEM_SAFETY_ERROR") {
    super(message);
    this.name = "FilesystemSafetyError";
    this.code = code;
  }
}

function isWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertRelativePath(value, label) {
  const relativePath = String(value ?? "").trim();

  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new FilesystemSafetyError(`${label} debe ser una ruta relativa segura.`, "UNSAFE_RELATIVE_PATH");
  }

  const normalized = path.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new FilesystemSafetyError(`${label} no puede escapar de la raiz del proyecto.`, "PATH_ESCAPE");
  }

  return normalized;
}

async function lstatIfExists(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function assertSafeEntityId(value, expectedKind) {
  if (typeof value !== "string" || value !== value.trim() || value.length > 128 || !ENTITY_ID_PATTERN.test(value)) {
    throw new FilesystemSafetyError("ID de entidad no seguro.", "UNSAFE_ENTITY_ID");
  }

  if (expectedKind) {
    const expectedPrefix = ENTITY_PREFIXES[expectedKind];
    if (!expectedPrefix) {
      throw new TypeError(`Tipo de entidad no soportado: ${expectedKind}`);
    }

    if (!value.startsWith(`${expectedPrefix}-`)) {
      throw new FilesystemSafetyError(`El ID debe comenzar por ${expectedPrefix}-.`, "ENTITY_ID_KIND_MISMATCH");
    }
  }

  return value;
}

export async function assertNoSymlinkComponents(rootPath, candidatePath) {
  const rootAbsolute = path.resolve(rootPath);
  const candidateAbsolute = path.resolve(candidatePath);
  const canonicalRoot = await fs.realpath(rootAbsolute);
  const relative = isWithinRoot(rootAbsolute, candidateAbsolute)
    ? path.relative(rootAbsolute, candidateAbsolute)
    : isWithinRoot(canonicalRoot, candidateAbsolute)
      ? path.relative(canonicalRoot, candidateAbsolute)
      : null;

  if (relative === null) {
    throw new FilesystemSafetyError("La ruta escapa de la raiz permitida.", "PATH_ESCAPE");
  }

  const canonicalCandidate = path.resolve(canonicalRoot, relative);

  if (!isWithinRoot(canonicalRoot, canonicalCandidate)) {
    throw new FilesystemSafetyError("La ruta resuelta escapa de la raiz permitida.", "PATH_ESCAPE");
  }

  let currentPath = canonicalRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, component);
    const stat = await lstatIfExists(currentPath);
    if (!stat) {
      break;
    }
    if (stat.isSymbolicLink()) {
      throw new FilesystemSafetyError(`No se permiten symlinks en la ruta: ${currentPath}`, "SYMLINK_PATH");
    }
  }

  return canonicalCandidate;
}

export async function assertPathWithinRoot(rootPath, candidatePath) {
  if (!path.isAbsolute(rootPath) || !path.isAbsolute(candidatePath)) {
    throw new FilesystemSafetyError("La raiz y la ruta candidata deben ser absolutas.", "PATH_NOT_ABSOLUTE");
  }

  return assertNoSymlinkComponents(rootPath, candidatePath);
}

export async function resolveProjectPaths(project) {
  const configuredRoot = String(project?.rootPath ?? "").trim();
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new FilesystemSafetyError("rootPath debe ser una ruta absoluta.", "ROOT_NOT_ABSOLUTE");
  }

  const rootStat = await fs.lstat(configuredRoot);
  if (!rootStat.isDirectory()) {
    throw new FilesystemSafetyError("rootPath debe apuntar a un directorio.", "ROOT_NOT_DIRECTORY");
  }

  const rootPath = await fs.realpath(configuredRoot);
  const docsPath = assertRelativePath(project?.docsPath ?? "docs/kanban", "docsPath");
  const docsRoot = await assertNoSymlinkComponents(rootPath, path.resolve(rootPath, docsPath));
  const epicsDir = await assertNoSymlinkComponents(rootPath, path.join(docsRoot, "epics"));
  const storiesDir = await assertNoSymlinkComponents(rootPath, path.join(docsRoot, "stories"));
  const runtimeDir = await assertNoSymlinkComponents(rootPath, path.join(rootPath, ".local-kanban"));

  return {
    ...project,
    rootPath,
    docsPath,
    docsRoot,
    epicsDir,
    storiesDir,
    runtimeDir,
    runtimeDatabase: path.join(runtimeDir, "runtime.sqlite"),
  };
}

export async function resolveEntityPath(project, kind, entityId) {
  const prefix = ENTITY_PREFIXES[kind];
  if (!prefix) {
    throw new TypeError(`Tipo de entidad no soportado: ${kind}`);
  }

  assertSafeEntityId(entityId, prefix);
  const projectPaths = project?.docsRoot ? project : await resolveProjectPaths(project);
  const collectionDir = prefix === "STO" ? projectPaths.storiesDir : projectPaths.epicsDir;
  return assertNoSymlinkComponents(projectPaths.rootPath, path.join(collectionDir, `${entityId}.md`));
}

export async function readFileLimited(filePath, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_MARKDOWN_BYTES;
  const resolvedPath = options.rootPath
    ? await assertPathWithinRoot(options.rootPath, filePath)
    : path.resolve(filePath);
  const stat = await fs.lstat(resolvedPath);

  if (stat.isSymbolicLink()) {
    throw new FilesystemSafetyError("No se puede leer un fichero mediante symlink.", "SYMLINK_PATH");
  }
  if (!stat.isFile()) {
    throw new FilesystemSafetyError("La ruta no apunta a un fichero regular.", "NOT_REGULAR_FILE");
  }
  if (stat.size > maxBytes) {
    throw new FilesystemSafetyError(`El fichero supera el limite de ${maxBytes} bytes.`, "FILE_TOO_LARGE");
  }

  const content = await fs.readFile(resolvedPath);
  if (content.byteLength > maxBytes) {
    throw new FilesystemSafetyError(`El fichero supera el limite de ${maxBytes} bytes.`, "FILE_TOO_LARGE");
  }

  return options.encoding ? content.toString(options.encoding) : content;
}
