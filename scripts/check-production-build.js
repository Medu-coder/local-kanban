import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const entryPoint = path.join(rootDir, "dist", "index.html");
const projectsConfig = path.join(rootDir, "config", "projects.json");

try {
  await fs.access(entryPoint);
} catch {
  console.error("Falta dist/index.html. Ejecuta npm run build antes de iniciar Local Kanban.");
  process.exitCode = 1;
}

try {
  const projects = JSON.parse(await fs.readFile(projectsConfig, "utf8"));
  if (!Array.isArray(projects)) {
    throw new TypeError("La configuración debe ser un array.");
  }
} catch (error) {
  console.error(
    `Falta una configuración local válida en config/projects.json. Ejecuta npm run setup. (${error.message})`,
  );
  process.exitCode = 1;
}
