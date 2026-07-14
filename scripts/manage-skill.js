import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const sourceDir = path.join(rootDir, "skills", "local-kanban");
const skillsDir = path.join(os.homedir(), ".agents", "skills");
const targetPath = path.join(skillsDir, "local-kanban");
const legacyPaths = [
  path.join(os.homedir(), ".agents", "skills", "local-kanban-agent"),
  path.join(os.homedir(), ".codex", "skills", "local-kanban"),
  path.join(os.homedir(), ".codex", "skills", "local-kanban-agent"),
];

function fail(message) {
  throw new Error(message);
}

async function lstatOrNull(filePath) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function validateSource() {
  const skillPath = path.join(sourceDir, "SKILL.md");
  let contents;

  try {
    contents = await fs.readFile(skillPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(`No existe la skill canonica en ${skillPath}.`);
    }
    throw error;
  }

  if (!/^---\s*\n[\s\S]*?^name:\s*["']?local-kanban["']?\s*$[\s\S]*?^---\s*$/m.test(contents)) {
    fail(`El frontmatter de ${skillPath} debe declarar name: local-kanban.`);
  }

  if (/\bTODO\b/.test(contents)) {
    fail(`La skill canonica contiene marcadores TODO en ${skillPath}.`);
  }

  return fs.realpath(sourceDir);
}

async function resolveSymlink(linkPath) {
  const rawTarget = await fs.readlink(linkPath);
  const resolvedTarget = path.resolve(path.dirname(linkPath), rawTarget);

  try {
    return await fs.realpath(resolvedTarget);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function findLegacyPaths() {
  const found = [];

  for (const legacyPath of legacyPaths) {
    if (await lstatOrNull(legacyPath)) {
      found.push(legacyPath);
    }
  }

  return found;
}

async function install() {
  const canonicalSource = await validateSource();
  await fs.mkdir(skillsDir, { recursive: true });

  const current = await lstatOrNull(targetPath);
  if (current?.isSymbolicLink()) {
    const currentTarget = await resolveSymlink(targetPath);
    if (currentTarget === canonicalSource) {
      console.log(`Skill local-kanban ya enlazada: ${targetPath} -> ${canonicalSource}`);
      return;
    }

    await fs.unlink(targetPath);
  } else if (current) {
    fail(
      `No se reemplaza ${targetPath} porque no es un symlink. ` +
        "Mueve o elimina esa copia manualmente y vuelve a ejecutar la instalacion.",
    );
  }

  await fs.symlink(canonicalSource, targetPath, "dir");
  console.log(`Skill local-kanban enlazada: ${targetPath} -> ${canonicalSource}`);

  const legacy = await findLegacyPaths();
  if (legacy.length > 0) {
    console.warn(`Aviso: existen rutas legacy que deben revisarse: ${legacy.join(", ")}`);
  }
}

async function verify() {
  const canonicalSource = await validateSource();
  const current = await lstatOrNull(targetPath);

  if (!current) {
    fail(`Falta ${targetPath}. Ejecuta npm run skill:install.`);
  }
  if (!current.isSymbolicLink()) {
    fail(`${targetPath} debe ser un symlink, no una copia local.`);
  }

  const currentTarget = await resolveSymlink(targetPath);
  if (!currentTarget) {
    fail(`El symlink ${targetPath} esta roto. Ejecuta npm run skill:install.`);
  }
  if (currentTarget !== canonicalSource) {
    fail(
      `${targetPath} apunta a ${currentTarget}, pero debe apuntar a ${canonicalSource}. ` +
        "Ejecuta npm run skill:install para repararlo.",
    );
  }

  const legacy = await findLegacyPaths();
  if (legacy.length > 0) {
    fail(`Existen instalaciones legacy o copias divergentes: ${legacy.join(", ")}.`);
  }

  console.log(`Skill local-kanban verificada: ${targetPath} -> ${canonicalSource}`);
}

async function main() {
  const command = process.argv[2];

  if (command === "install") {
    await install();
    return;
  }
  if (command === "verify") {
    await verify();
    return;
  }

  fail("Uso: node scripts/manage-skill.js <install|verify>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
