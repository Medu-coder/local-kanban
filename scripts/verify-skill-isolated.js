import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");

async function run(command, args, environment) {
  const result = await execFileAsync(command, args, {
    cwd: rootDir,
    env: environment,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function main() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-skill-isolated-"));
  const home = path.join(workspace, "home");
  const prefix = path.join(workspace, "npm-prefix");
  const binDir = path.join(prefix, "bin");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  const environment = {
    ...process.env,
    HOME: home,
    NPM_CONFIG_PREFIX: prefix,
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };

  try {
    await run("npm", ["link"], environment);
    await run(process.execPath, ["scripts/manage-skill.js", "install"], environment);
    await run(process.execPath, ["scripts/verify-skill-consumer.js"], environment);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  if (error?.stdout) process.stdout.write(error.stdout);
  if (error?.stderr) process.stderr.write(error.stderr);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
