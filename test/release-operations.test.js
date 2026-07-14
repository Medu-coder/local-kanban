import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..");

test("el arranque de produccion no reconstruye y PM2 es dependencia de runtime", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

  assert.doesNotMatch(pkg.scripts.start, /npm run build/u);
  assert.match(pkg.scripts.start, /check-production-build\.js.*pm2 startOrRestart/u);
  assert.equal(pkg.dependencies.pm2, "^7.0.3");
  assert.equal(pkg.devDependencies.pm2, undefined);
});

test("setup y manifiesto exigen la misma version minima de Node", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const setup = await fs.readFile(path.join(rootDir, "scripts", "setup.js"), "utf8");

  assert.equal(pkg.engines.node, ">=22.13.0");
  assert.match(setup, /Node\.js 22\.13\.0 o superior/u);
  assert.doesNotMatch(setup, /Node\.js 18/u);
});

test("los launchers fallan de forma segura y esperan el health endpoint con limite", async () => {
  const launch = await fs.readFile(path.join(rootDir, "Launch_Kanban.command"), "utf8");
  const stop = await fs.readFile(path.join(rootDir, "Stop_Kanban.command"), "utf8");

  assert.match(launch, /^set -euo pipefail$/mu);
  assert.match(stop, /^set -euo pipefail$/mu);
  assert.match(launch, /\/api\/health/u);
  assert.match(launch, /MAX_HEALTH_ATTEMPTS/u);
  assert.match(launch, /npm run build/u);
});

test("el gate de release usa el smoke hermetico sin flags ignorados", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

  assert.match(pkg.scripts["test:skill"], /skill:smoke:isolated/u);
  assert.match(pkg.scripts["release:verify"], /npm run test:skill/u);
  assert.match(pkg.scripts["release:verify"], /npm audit --audit-level=high/u);
  assert.doesNotMatch(pkg.scripts["release:verify"], /--local/u);
});
