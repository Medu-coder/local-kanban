import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function check(id, status, summary, details = null, action = null) {
  return { id, status, summary, details, action };
}

async function lstatOrNull(filePath) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function inspectPaths(paths) {
  const required = [paths.rootPath, paths.docsRoot, paths.storiesDir, paths.epicsDir, paths.runtimeDir];
  const failures = [];
  for (const filePath of required) {
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        failures.push({ filePath, reason: "not_a_regular_directory" });
        continue;
      }
      await fs.access(filePath, constants.R_OK | constants.W_OK);
    } catch (error) {
      failures.push({ filePath, reason: error.code ?? error.message });
    }
  }
  return failures.length === 0
    ? check("paths", "pass", "Rutas canónicas legibles y escribibles.")
    : check(
        "paths",
        "fail",
        "Hay rutas ausentes, inseguras o sin permisos.",
        { failures },
        "Corrige rutas/permisos y vuelve a ejecutar local-kanban doctor.",
      );
}

function inspectSqlite(runtime) {
  const integrityRows = runtime.db.prepare("PRAGMA quick_check").all();
  const integrity = integrityRows.map((row) => Object.values(row)[0]);
  const operations = Object.fromEntries(
    runtime.db
      .prepare("SELECT status, COUNT(*) AS count FROM operations GROUP BY status ORDER BY status")
      .all()
      .map((row) => [row.status, Number(row.count)]),
  );
  const quarantined = operations.quarantined ?? 0;
  const pending = operations.pending ?? 0;
  if (integrity.length !== 1 || integrity[0] !== "ok") {
    return check(
      "sqlite",
      "fail",
      "SQLite no supera PRAGMA quick_check.",
      { integrity, operations },
      "Conserva runtime.sqlite y escala recuperación; no lo edites manualmente.",
    );
  }
  if (quarantined > 0 || pending > 0) {
    return check(
      "sqlite",
      "fail",
      "SQLite es íntegra, pero conserva operaciones sin reconciliar.",
      { integrity, operations },
      "Resuelve las operaciones pendientes o en cuarentena antes de continuar.",
    );
  }
  return check("sqlite", "pass", "SQLite íntegra y sin operaciones abiertas.", { integrity, operations });
}

function collectMetrics(runtime) {
  const count = (sql) => Number(runtime.db.prepare(sql).get().count);
  const grouped = (sql, key) =>
    Object.fromEntries(runtime.db.prepare(sql).all().map((row) => [row[key], Number(row.count)]));
  return {
    audit: {
      total: count("SELECT COUNT(*) AS count FROM audit_events"),
      byEvent: grouped(
        "SELECT event_type, COUNT(*) AS count FROM audit_events GROUP BY event_type ORDER BY event_type",
        "event_type",
      ),
    },
    operations: grouped(
      "SELECT status, COUNT(*) AS count FROM operations GROUP BY status ORDER BY status",
      "status",
    ),
    claims: grouped("SELECT status, COUNT(*) AS count FROM claims GROUP BY status ORDER BY status", "status"),
    attemptsOpen: count("SELECT COUNT(*) AS count FROM attempts WHERE outcome IS NULL"),
    checkpoints: count("SELECT COUNT(*) AS count FROM checkpoints"),
    openBlocks: count("SELECT COUNT(*) AS count FROM blocks WHERE status = 'open'"),
  };
}

async function inspectGit(rootPath) {
  try {
    const [{ stdout: inside }, { stdout: status }, { stdout: worktrees }] = await Promise.all([
      execFileAsync("git", ["-C", rootPath, "rev-parse", "--is-inside-work-tree"]),
      execFileAsync("git", ["-C", rootPath, "status", "--porcelain=v1"]),
      execFileAsync("git", ["-C", rootPath, "worktree", "list", "--porcelain"]),
    ]);
    if (inside.trim() !== "true" || !worktrees.trim()) {
      throw new Error("Git no reconoce el repositorio o sus worktrees.");
    }
    const worktreeCount = worktrees.split(/\n\n+/u).filter(Boolean).length;
    return check("git", "pass", "Repositorio Git y worktrees accesibles.", {
      dirty: Boolean(status.trim()),
      changedEntries: status.trim() ? status.trim().split("\n").length : 0,
      worktreeCount,
    });
  } catch (error) {
    return check(
      "git",
      "warning",
      "No se puede inspeccionar el repositorio Git o sus worktrees.",
      { error: String(error.stderr ?? error.message).trim() },
      "Repara el repositorio Git antes de asignar trabajo concurrente.",
    );
  }
}

async function inspectSkill(options = {}) {
  if (options.checkSkill === false) {
    return check("skill", "pass", "Comprobación de skill omitida explícitamente.", { skipped: true });
  }
  const source = options.skillSource ?? path.resolve(moduleDir, "..", "skills", "local-kanban");
  const target = options.skillTarget ?? path.join(os.homedir(), ".agents", "skills", "local-kanban");
  const targetStat = await lstatOrNull(target);
  if (!targetStat) {
    return check(
      "skill",
      "warning",
      "La skill canónica no está instalada en este entorno.",
      { source, target },
      "Ejecuta npm run skill:install desde el repositorio Local Kanban.",
    );
  }
  if (!targetStat.isSymbolicLink()) {
    return check(
      "skill",
      "fail",
      "La instalación local de la skill es una copia, no el symlink canónico.",
      { source, target },
      "Retira la copia tras revisarla y ejecuta npm run skill:install.",
    );
  }
  try {
    const [canonicalSource, canonicalTarget] = await Promise.all([fs.realpath(source), fs.realpath(target)]);
    if (canonicalSource !== canonicalTarget) {
      return check(
        "skill",
        "fail",
        "La skill instalada apunta a otro checkout.",
        { expected: canonicalSource, actual: canonicalTarget },
        "Ejecuta npm run skill:install desde el checkout que gobierna este runtime.",
      );
    }
    return check("skill", "pass", "Skill canónica enlazada al checkout vigente.", {
      source: canonicalSource,
      target,
    });
  } catch (error) {
    return check(
      "skill",
      "fail",
      "El symlink de la skill está roto o su fuente no existe.",
      { source, target, error: error.code ?? error.message },
      "Ejecuta npm run skill:install y npm run skill:verify.",
    );
  }
}

export async function diagnoseProject({ validation, recovery, paths, runtime, ...options }) {
  const validationCheck = validation.ok
    ? check("schema_dag", "pass", "Schemas, referencias y DAG válidos.", validation.counts)
    : check(
        "schema_dag",
        "fail",
        "Hay documentos, referencias o dependencias inválidas.",
        { counts: validation.counts, invalid: validation.invalid },
        "Corrige los documentos señalados mediante la CLI y repite validate.",
      );
  const recoveryFailures = recovery.filter((item) => item.status === "quarantined");
  const recoveryCheck = recoveryFailures.length === 0
    ? check("recovery", "pass", "Recovery completado sin nuevas cuarentenas.", { operations: recovery })
    : check(
        "recovery",
        "fail",
        "Recovery detectó divergencias y puso operaciones en cuarentena.",
        { operations: recoveryFailures },
        "No continúes mutando esas entidades; revisa Markdown y auditoría.",
      );
  const checks = [
    validationCheck,
    await inspectPaths(paths),
    inspectSqlite(runtime),
    recoveryCheck,
    await inspectGit(paths.rootPath),
    await inspectSkill(options),
  ];
  const health = checks.some((item) => item.status !== "pass") ? "degraded" : "healthy";
  return {
    ok: !checks.some((item) => item.status === "fail"),
    health,
    checks,
    metrics: collectMetrics(runtime),
  };
}
