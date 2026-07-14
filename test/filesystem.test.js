import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteFile } from "../core/atomic-write.js";
import {
  MAX_MARKDOWN_BYTES,
  assertSafeEntityId,
  readFileLimited,
  resolveEntityPath,
  resolveProjectPaths,
} from "../core/paths.js";

async function withTempDir(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-filesystem-"));
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test("acepta IDs STO/EPI seguros y rechaza escapes o prefijos incorrectos", () => {
  assert.equal(assertSafeEntityId("STO-001", "story"), "STO-001");
  assert.equal(assertSafeEntityId("EPI-core_v2.1", "epic"), "EPI-core_v2.1");

  for (const unsafeId of [
    "STO-../secret",
    "STO-/tmp",
    "STO-foo/bar",
    "STO-foo\\bar",
    " STO-001",
    "STO-",
    "sto-001",
    `STO-${"a".repeat(125)}`,
  ]) {
    assert.throws(() => assertSafeEntityId(unsafeId), { code: "UNSAFE_ENTITY_ID" });
  }

  assert.throws(() => assertSafeEntityId("EPI-001", "story"), {
    code: "ENTITY_ID_KIND_MISMATCH",
  });
});

test("resuelve root, docsPath y entidades sin permitir escapes", async () => {
  await withTempDir(async (rootPath) => {
    await fs.mkdir(path.join(rootPath, "docs", "kanban", "stories"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "docs", "kanban", "epics"), { recursive: true });

    const paths = await resolveProjectPaths({ rootPath, docsPath: "docs/kanban" });
    assert.equal(paths.rootPath, await fs.realpath(rootPath));
    assert.equal(
      await resolveEntityPath(paths, "story", "STO-001"),
      path.join(paths.storiesDir, "STO-001.md"),
    );

    await assert.rejects(resolveProjectPaths({ rootPath, docsPath: "../outside" }), {
      code: "PATH_ESCAPE",
    });
    await assert.rejects(resolveProjectPaths({ rootPath, docsPath: path.join(rootPath, "docs") }), {
      code: "UNSAFE_RELATIVE_PATH",
    });
  });
});

test("rechaza symlinks existentes en docsPath y en el fichero de entidad", async () => {
  await withTempDir(async (sandbox) => {
    const rootPath = path.join(sandbox, "project");
    const outsidePath = path.join(sandbox, "outside");
    await fs.mkdir(rootPath);
    await fs.mkdir(outsidePath);
    await fs.symlink(outsidePath, path.join(rootPath, "docs"));

    await assert.rejects(resolveProjectPaths({ rootPath, docsPath: "docs/kanban" }), {
      code: "SYMLINK_PATH",
    });

    await fs.unlink(path.join(rootPath, "docs"));
    await fs.mkdir(path.join(rootPath, "docs", "kanban", "stories"), { recursive: true });
    await fs.mkdir(path.join(rootPath, "docs", "kanban", "epics"), { recursive: true });
    const externalFile = path.join(outsidePath, "story.md");
    await fs.writeFile(externalFile, "outside", "utf8");
    await fs.symlink(externalFile, path.join(rootPath, "docs", "kanban", "stories", "STO-001.md"));

    const paths = await resolveProjectPaths({ rootPath, docsPath: "docs/kanban" });
    await assert.rejects(resolveEntityPath(paths, "story", "STO-001"), {
      code: "SYMLINK_PATH",
    });
  });
});

test("escribe atomicamente en el mismo directorio y limpia temporales", async () => {
  await withTempDir(async (rootPath) => {
    const storiesDir = path.join(rootPath, "docs", "kanban", "stories");
    await fs.mkdir(storiesDir, { recursive: true });
    const targetPath = path.join(storiesDir, "STO-001.md");
    const canonicalTargetPath = path.join(await fs.realpath(rootPath), "docs", "kanban", "stories", "STO-001.md");

    assert.equal(await atomicWriteFile(targetPath, "primera\n", { rootPath }), canonicalTargetPath);
    assert.equal(await fs.readFile(targetPath, "utf8"), "primera\n");

    await atomicWriteFile(targetPath, "segunda\n", { rootPath });
    assert.equal(await fs.readFile(targetPath, "utf8"), "segunda\n");
    assert.deepEqual(
      (await fs.readdir(storiesDir)).filter((name) => name.endsWith(".tmp")),
      [],
    );
  });
});

test("no sigue un symlink de destino al escribir", async () => {
  await withTempDir(async (sandbox) => {
    const rootPath = path.join(sandbox, "project");
    const storiesDir = path.join(rootPath, "docs", "kanban", "stories");
    const outsidePath = path.join(sandbox, "outside.md");
    await fs.mkdir(storiesDir, { recursive: true });
    await fs.writeFile(outsidePath, "intacto", "utf8");
    const targetPath = path.join(storiesDir, "STO-001.md");
    await fs.symlink(outsidePath, targetPath);

    await assert.rejects(atomicWriteFile(targetPath, "ataque", { rootPath }), {
      code: "SYMLINK_PATH",
    });
    assert.equal(await fs.readFile(outsidePath, "utf8"), "intacto");
  });
});

test("aplica el limite de 1 MiB tanto en escritura como en lectura", async () => {
  await withTempDir(async (rootPath) => {
    const targetPath = path.join(rootPath, "story.md");
    const allowed = Buffer.alloc(MAX_MARKDOWN_BYTES, 0x61);
    await atomicWriteFile(targetPath, allowed, { rootPath });
    assert.equal((await readFileLimited(targetPath, { rootPath })).byteLength, MAX_MARKDOWN_BYTES);

    await assert.rejects(
      atomicWriteFile(targetPath, Buffer.alloc(MAX_MARKDOWN_BYTES + 1), { rootPath }),
      { code: "FILE_TOO_LARGE" },
    );
    assert.equal((await fs.stat(targetPath)).size, MAX_MARKDOWN_BYTES);

    const oversizedPath = path.join(rootPath, "oversized.md");
    await fs.writeFile(oversizedPath, Buffer.alloc(MAX_MARKDOWN_BYTES + 1));
    await assert.rejects(readFileLimited(oversizedPath, { rootPath }), {
      code: "FILE_TOO_LARGE",
    });
  });
});
