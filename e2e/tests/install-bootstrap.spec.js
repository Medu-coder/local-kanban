import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function copySetupFixture(targetDir) {
  await fs.mkdir(path.join(targetDir, "scripts"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "config"), { recursive: true });

  await fs.copyFile(path.resolve("scripts/setup.js"), path.join(targetDir, "scripts", "setup.js"));
  await fs.copyFile(
    path.resolve("config/projects.example.json"),
    path.join(targetDir, "config", "projects.example.json"),
  );
}

test("el bootstrap crea config local y es idempotente", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-setup-"));

  try {
    await copySetupFixture(tempRoot);

    await execFileAsync("node", ["scripts/setup.js", "--no-interactive"], {
      cwd: tempRoot,
    });

    const createdConfig = await fs.readFile(path.join(tempRoot, "config", "projects.json"), "utf8");
    const exampleConfig = await fs.readFile(path.join(tempRoot, "config", "projects.example.json"), "utf8");

    expect(createdConfig).toBe(exampleConfig);

    await fs.writeFile(
      path.join(tempRoot, "config", "projects.json"),
      '[{"id":"custom","name":"Custom","rootPath":"/tmp/custom","docsPath":"docs/kanban"}]\n',
      "utf8",
    );

    await execFileAsync("node", ["scripts/setup.js", "--no-interactive"], {
      cwd: tempRoot,
    });

    const preservedConfig = await fs.readFile(path.join(tempRoot, "config", "projects.json"), "utf8");
    expect(preservedConfig).toContain('"id":"custom"');

    await execFileAsync("node", ["scripts/setup.js", "--force", "--no-interactive"], {
      cwd: tempRoot,
    });

    const resetConfig = await fs.readFile(path.join(tempRoot, "config", "projects.json"), "utf8");
    expect(resetConfig).toBe(exampleConfig);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("el bootstrap acepta proyectos guiados por parametro y deja la configuracion lista", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-kanban-guided-"));

  try {
    await copySetupFixture(tempRoot);

    const child = spawn(
      "node",
      [
        "scripts/setup.js",
        "--projects-json",
        JSON.stringify([
          {
            name: "Proyecto Demo",
            rootPath: "/tmp/proyecto-demo",
          },
        ]),
      ],
      {
      cwd: tempRoot,
        env: {
          ...process.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    await new Promise((resolve, reject) => {
      child.on("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`setup guiado termino con codigo ${code ?? "null"}`));
      });
      child.on("error", reject);
    });

    const configured = JSON.parse(await fs.readFile(path.join(tempRoot, "config", "projects.json"), "utf8"));

    expect(configured).toEqual([
      {
        id: "proyecto-demo",
        name: "Proyecto Demo",
        rootPath: "/tmp/proyecto-demo",
        docsPath: "docs/kanban",
      },
    ]);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
