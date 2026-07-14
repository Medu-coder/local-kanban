import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const testPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(testPath), "..");
const scriptPath = path.join(rootDir, "scripts", "manage-skill.js");
const sourceDir = await fs.realpath(path.join(rootDir, "skills", "local-kanban"));
const temporaryHomes = [];

afterEach(async () => {
  await Promise.all(temporaryHomes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

async function createHome() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-skill-"));
  temporaryHomes.push(home);
  return home;
}

async function run(command, home) {
  return execFileAsync(process.execPath, [scriptPath, command], {
    env: { ...process.env, HOME: home },
  });
}

async function expectFailure(command, home, pattern) {
  await assert.rejects(run(command, home), (error) => {
    assert.match(`${error.stdout ?? ""}${error.stderr ?? ""}`, pattern);
    return true;
  });
}

test("install crea el symlink canonico y verify lo valida", async () => {
  const home = await createHome();
  const target = path.join(home, ".agents", "skills", "local-kanban");

  await run("install", home);

  assert.equal((await fs.lstat(target)).isSymbolicLink(), true);
  assert.equal(await fs.realpath(target), sourceDir);
  await run("verify", home);
});

test("install es idempotente", async () => {
  const home = await createHome();
  const target = path.join(home, ".agents", "skills", "local-kanban");

  await run("install", home);
  const firstTarget = await fs.readlink(target);
  await run("install", home);

  assert.equal(await fs.readlink(target), firstTarget);
  assert.equal(await fs.realpath(target), sourceDir);
});

test("install repara un symlink roto o dirigido a otra ruta", async () => {
  const home = await createHome();
  const skillsDir = path.join(home, ".agents", "skills");
  const target = path.join(skillsDir, "local-kanban");
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.symlink(path.join(home, "missing-skill"), target, "dir");

  await run("install", home);

  assert.equal(await fs.realpath(target), sourceDir);
});

test("install no reemplaza un directorio real", async () => {
  const home = await createHome();
  const target = path.join(home, ".agents", "skills", "local-kanban");
  await fs.mkdir(target, { recursive: true });

  await expectFailure("install", home, /no es un symlink/i);
  assert.equal((await fs.lstat(target)).isDirectory(), true);
});

test("verify rechaza instalaciones legacy", async () => {
  const home = await createHome();
  const legacy = path.join(home, ".codex", "skills", "local-kanban-agent");
  await run("install", home);
  await fs.mkdir(legacy, { recursive: true });

  await expectFailure("verify", home, /legacy|divergentes/i);
});

test("un comando desconocido falla con ayuda breve", async () => {
  const home = await createHome();
  await expectFailure("unknown", home, /install\|verify/);
});
