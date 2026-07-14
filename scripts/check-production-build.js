import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const entryPoint = path.join(rootDir, "dist", "index.html");

try {
  await fs.access(entryPoint);
} catch {
  console.error("Falta dist/index.html. Ejecuta npm run build antes de iniciar Local Kanban.");
  process.exitCode = 1;
}
