import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["bin", "core", "scripts", "server", "test", "e2e"];

async function collect(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(target)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(target);
    }
  }
  return files;
}

for (const relative of roots) {
  const directory = path.join(root, relative);
  try {
    for (const filePath of await collect(directory)) {
      await execFileAsync(process.execPath, ["--check", filePath]);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

for (const fileName of await fs.readdir(path.join(root, "schemas", "v1"))) {
  if (fileName.endsWith(".json")) {
    JSON.parse(await fs.readFile(path.join(root, "schemas", "v1", fileName), "utf8"));
  }
}

console.log("Static checks OK");
