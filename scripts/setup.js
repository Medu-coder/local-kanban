import fs from "node:fs/promises";
import path from "node:path";
import process, { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const configDir = path.join(rootDir, "config");
const exampleConfigPath = path.join(configDir, "projects.example.json");
const localConfigPath = path.join(configDir, "projects.json");
const args = new Set(process.argv.slice(2));
const rawArgs = process.argv.slice(2);
const force = args.has("--force");
const noInteractive = args.has("--no-interactive");
const forceInteractive = process.env.LOCAL_KANBAN_SETUP_INTERACTIVE === "1";

function getArgValue(flag) {
  const exactIndex = rawArgs.indexOf(flag);
  if (exactIndex !== -1) {
    return rawArgs[exactIndex + 1] ?? "";
  }

  const prefixed = rawArgs.find((arg) => arg.startsWith(`${flag}=`));
  return prefixed ? prefixed.slice(flag.length + 1) : "";
}

function parseProjectsArg() {
  const raw = getArgValue("--projects-json");

  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : null;
}

function parseNodeMajorVersion(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  return Number.parseInt(normalized.split(".")[0] ?? "0", 10);
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

async function ensureConfigFile() {
  await fs.mkdir(configDir, { recursive: true });

  if (force) {
    await fs.copyFile(exampleConfigPath, localConfigPath);
    return "reset";
  }

  try {
    await fs.access(localConfigPath);
    return "kept";
  } catch {
    await fs.copyFile(exampleConfigPath, localConfigPath);
    return "created";
  }
}

async function readProjectsConfig() {
  const raw = await fs.readFile(localConfigPath, "utf8");
  return JSON.parse(raw);
}

async function writeProjectsConfig(projects) {
  await fs.writeFile(localConfigPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
}

function normalizeProject(project, index) {
  const name = String(project?.name ?? "").trim();
  const inferredId = project?.id ?? slugify(name) ?? `project-${index + 1}`;
  const id = String(inferredId).trim();
  const rootPath = String(project?.rootPath ?? "").trim();
  const docsPath = String(project?.docsPath ?? "docs/kanban").trim() || "docs/kanban";

  if (!name) {
    throw new Error(`El proyecto ${index + 1} no tiene name.`);
  }

  if (!id) {
    throw new Error(`El proyecto ${index + 1} no tiene id valido.`);
  }

  if (!rootPath || !path.isAbsolute(rootPath)) {
    throw new Error(`El proyecto ${index + 1} debe usar rootPath absoluto.`);
  }

  return { id, name, rootPath, docsPath };
}

async function applyProjectsArg() {
  const projectsArg = parseProjectsArg();

  if (!projectsArg) {
    return "skipped";
  }

  const normalized = projectsArg.map(normalizeProject);
  await writeProjectsConfig(normalized);
  return "configured";
}

async function promptYesNo(rl, question, defaultValue) {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();

  if (!answer) {
    return defaultValue;
  }

  return ["y", "yes", "s", "si"].includes(answer);
}

async function promptNonEmpty(rl, question, fallback = "") {
  while (true) {
    const answer = (await rl.question(question)).trim();

    if (answer) {
      return answer;
    }

    if (fallback) {
      return fallback;
    }
  }
}

async function promptAbsolutePath(rl, question) {
  while (true) {
    const answer = (await rl.question(question)).trim();

    if (!answer) {
      continue;
    }

    if (!path.isAbsolute(answer)) {
      console.log("La ruta debe ser absoluta.");
      continue;
    }

    return answer;
  }
}

async function promptProject(rl, index) {
  const name = await promptNonEmpty(rl, `Nombre del proyecto ${index}: `);
  const defaultId = slugify(name) || `project-${index}`;
  const id = await promptNonEmpty(rl, `ID del proyecto ${index} [${defaultId}]: `, defaultId);
  const rootPath = await promptAbsolutePath(rl, `Ruta absoluta del proyecto ${index}: `);
  const docsPath = await promptNonEmpty(rl, "Ruta de docs Kanban [docs/kanban]: ", "docs/kanban");

  return {
    id,
    name,
    rootPath,
    docsPath,
  };
}

async function runGuidedConfiguration(configStatus) {
  if ((!input.isTTY && !forceInteractive) || noInteractive) {
    return "skipped";
  }

  const rl = readline.createInterface({ input, output });

  try {
    const shouldConfigure =
      configStatus === "kept"
        ? await promptYesNo(rl, "Ya existe config/projects.json. Quieres reconfigurarlo ahora?", false)
        : await promptYesNo(rl, "Quieres configurar los proyectos ahora?", true);

    if (!shouldConfigure) {
      return "skipped";
    }

    const projects = [];
    let index = 1;

    do {
      projects.push(await promptProject(rl, index));
      index += 1;
    } while (await promptYesNo(rl, "Quieres anadir otro proyecto?", false));

    await writeProjectsConfig(projects);
    return "configured";
  } finally {
    rl.close();
  }
}

async function main() {
  const nodeMajor = parseNodeMajorVersion(process.version);

  if (nodeMajor < 18) {
    console.error("Local Kanban requiere Node.js 18 o superior.");
    process.exit(1);
  }

  const configStatus = await ensureConfigFile();
  const projectsArgStatus = await applyProjectsArg();
  const wizardStatus =
    projectsArgStatus === "configured"
      ? "configured"
      : await runGuidedConfiguration(configStatus);
  const projectCount = (await readProjectsConfig()).length;

  console.log("");
  console.log("Local Kanban setup completado.");
  console.log(`Directorio: ${rootDir}`);

  if (configStatus === "created") {
    console.log("Se ha creado config/projects.json a partir de la plantilla.");
  } else if (configStatus === "reset") {
    console.log("Se ha regenerado config/projects.json desde la plantilla.");
  } else {
    console.log("Se mantiene el config/projects.json existente.");
  }

  if (wizardStatus === "configured") {
    console.log(`Se han configurado ${projectCount} proyecto(s) en el asistente.`);
  } else {
    console.log("No se han cambiado las rutas de proyecto en este paso.");
  }

  console.log("");
  console.log("Siguientes pasos:");
  if (projectCount === 0) {
    console.log("1. Edita config/projects.json con las rutas absolutas de tus proyectos locales.");
    console.log("2. Ejecuta npm run dev para levantar la UI y la API local.");
    console.log("3. Si preparas un proyecto nuevo, revisa docs/PROJECT_KANBAN_SETUP.md.");
  } else {
    console.log("1. Ejecuta npm run dev para levantar la UI y la API local.");
    console.log("2. Si preparas un proyecto nuevo, revisa docs/PROJECT_KANBAN_SETUP.md.");
  }
}

main().catch((error) => {
  console.error("No se pudo completar el setup de Local Kanban.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
