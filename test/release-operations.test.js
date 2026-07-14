import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..");

test("el arranque de produccion no reconstruye, espera health y PM2 es dependencia de runtime", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

  assert.doesNotMatch(pkg.scripts.start, /npm run build/u);
  assert.match(pkg.scripts.start, /check-production-build\.js.*pm2 startOrRestart/u);
  assert.match(pkg.scripts.start, /wait-for-health\.js/u);
  assert.match(pkg.scripts.restart, /check-production-build\.js.*pm2 restart.*wait-for-health\.js/u);
  assert.equal(pkg.dependencies.pm2, "^7.0.3");
  assert.equal(pkg.devDependencies.pm2, undefined);
});

test("el arranque exige bundle y configuración local válidos", async () => {
  const preflight = await fs.readFile(
    path.join(rootDir, "scripts", "check-production-build.js"),
    "utf8",
  );

  assert.match(preflight, /dist.*index\.html/su);
  assert.match(preflight, /config.*projects\.json/su);
  assert.match(preflight, /npm run setup/u);
});

test("la instalación y actualización documentadas ejecutan setup y verifican salud", async () => {
  const readme = await fs.readFile(path.join(rootDir, "README.md"), "utf8");
  const installation = await fs.readFile(
    path.join(rootDir, "docs", "INSTALLATION_AND_SETUP.md"),
    "utf8",
  );

  assert.match(readme, /npm run setup/u);
  assert.match(installation, /npm run setup/u);
  assert.match(installation, /curl --fail http:\/\/127\.0\.0\.1:4010\/api\/health/u);
});

test("setup y manifiesto exigen la misma version minima de Node", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const setup = await fs.readFile(path.join(rootDir, "scripts", "setup.js"), "utf8");

  assert.equal(pkg.engines.node, "^22.13.0 || ^24.0.0");
  assert.match(setup, /major === 24/u);
  assert.match(setup, /Node\.js 22\.13\+ o Node\.js 24 LTS/u);
  assert.doesNotMatch(setup, /Node\.js 18/u);
});

test("npm solo autoriza los scripts nativos revisados y fijados", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

  assert.deepEqual(pkg.allowScripts, {
    "fsevents@2.3.3": true,
    "fsevents@2.3.2": true,
  });
});

test("los launchers delegan el health acotado al arranque canónico", async () => {
  const launch = await fs.readFile(path.join(rootDir, "Launch_Kanban.command"), "utf8");
  const stop = await fs.readFile(path.join(rootDir, "Stop_Kanban.command"), "utf8");

  assert.match(launch, /^set -euo pipefail$/mu);
  assert.match(stop, /^set -euo pipefail$/mu);
  assert.match(launch, /npm run build/u);
  assert.match(launch, /npm start/u);
  assert.doesNotMatch(launch, /curl/u);
});

test("CI instala Gitleaks sin acciones Node 20 y verifica binario e historial", async () => {
  const workflow = await fs.readFile(path.join(rootDir, ".github", "workflows", "ci.yml"), "utf8");

  assert.doesNotMatch(workflow, /gitleaks\/gitleaks-action/u);
  assert.match(workflow, /gitleaks_8\.30\.1_linux_x64\.tar\.gz/u);
  assert.match(workflow, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/u);
  assert.match(workflow, /sha256sum --check --strict/u);
  assert.match(workflow, /--retry 3 --retry-all-errors/u);
  assert.match(workflow, /--log-opts="--all"/u);
});

test("el gate de release usa el smoke hermetico sin flags ignorados", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

  assert.match(pkg.scripts["test:skill"], /skill:smoke:isolated/u);
  assert.match(pkg.scripts["release:verify"], /npm run test:skill/u);
  assert.match(pkg.scripts["release:verify"], /npm run test:coverage/u);
  assert.doesNotMatch(pkg.scripts["release:verify"], /npm run test:unit/u);
  assert.doesNotMatch(pkg.scripts["release:verify"], /npm run test:quality/u);
  assert.match(pkg.scripts["release:verify"], /npm audit --audit-level=high/u);
  assert.doesNotMatch(pkg.scripts["release:verify"], /--local/u);
});

test("coverage aplica los umbrales de release acordados", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  const coverage = pkg.scripts["test:coverage"];

  assert.match(coverage, /--experimental-test-coverage/u);
  assert.match(coverage, /--test-coverage-lines=85/u);
  assert.match(coverage, /--test-coverage-branches=65/u);
  assert.match(coverage, /--test-coverage-functions=90/u);
  assert.match(coverage, /test\/\*\.test\.js/u);
});

test("la documentación distingue runtime, estados y fixtures de prueba", async () => {
  const architecture = await fs.readFile(
    path.join(rootDir, "docs", "ARCHITECTURE.md"),
    "utf8",
  );
  const projectSetup = await fs.readFile(
    path.join(rootDir, "docs", "PROJECT_KANBAN_SETUP.md"),
    "utf8",
  );
  const testing = await fs.readFile(path.join(rootDir, "docs", "TESTING.md"), "utf8");

  assert.doesNotMatch(architecture, /runtime reconstruible/u);
  assert.match(architecture, /historial operativo/u);
  assert.match(projectSetup, /funcional en `testing`/u);
  assert.match(projectSetup, /operacionalmente\s+en `verifying`/u);
  assert.match(testing, /fixtures, no\s+documentación de producto/u);
  assert.match(testing, /Node\.js 22 y 24/u);
});

test("el contrato prohíbe autogestionar el checkout proveedor", async () => {
  const skill = await fs.readFile(
    path.join(rootDir, "skills", "local-kanban", "SKILL.md"),
    "utf8",
  );
  const testing = await fs.readFile(path.join(rootDir, "docs", "TESTING.md"), "utf8");

  for (const contract of [skill, testing]) {
    assert.match(contract, /no puede ser simultáneamente proveedor y consumidor/u);
    assert.match(contract, /local-kanban init/u);
    assert.match(contract, /docs\/kanban/u);
    assert.match(contract, /\.local-kanban\/runtime\.sqlite/u);
    assert.match(contract, /KANBAN_CONFIG_PATH/u);
    assert.match(contract, /`HOME` aislado/u);
    assert.match(contract, /temporales descartables/u);
  }
});
