import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { healthConfiguration, waitForHealth } from "../scripts/wait-for-health.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function configuration(overrides = {}) {
  return {
    url: "http://127.0.0.1:4010/api/health",
    attempts: 3,
    intervalMs: 1,
    requestTimeoutMs: 1000,
    ...overrides,
  };
}

test("wait-for-health acepta un health sano o degradado y conserva el intento", async () => {
  for (const health of ["healthy", "degraded"]) {
    let calls = 0;
    const result = await waitForHealth({
      configuration: configuration(),
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? new Response("no disponible", { status: 503 })
          : Response.json({ ok: true, health });
      },
      sleep: async () => {},
    });

    assert.equal(result.payload.health, health);
    assert.equal(result.attempt, 2);
  }
});

test("wait-for-health falla cerrado tras agotar intentos", async () => {
  let calls = 0;
  await assert.rejects(
    waitForHealth({
      configuration: configuration({ attempts: 2 }),
      fetch: async () => {
        calls += 1;
        return Response.json({ ok: false, health: "healthy" });
      },
      sleep: async () => {},
    }),
    /tras 2 intentos.*respuesta health inválida/u,
  );
  assert.equal(calls, 2);
});

test("wait-for-health rechaza configuración inválida antes de consultar la red", () => {
  assert.throws(
    () => healthConfiguration({ LOCAL_KANBAN_HEALTH_ATTEMPTS: "0" }),
    /LOCAL_KANBAN_HEALTH_ATTEMPTS debe ser un entero positivo/u,
  );
  assert.throws(
    () => healthConfiguration({ LOCAL_KANBAN_HEALTH_URL: "file:///tmp/health" }),
    /debe usar http o https/u,
  );
  assert.throws(
    () => healthConfiguration({ LOCAL_KANBAN_HEALTH_REQUEST_TIMEOUT_MS: "no" }),
    /LOCAL_KANBAN_HEALTH_REQUEST_TIMEOUT_MS debe ser un entero positivo/u,
  );
});

test("wait-for-health valida la respuesta de un servidor HTTP real", async (t) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, health: "healthy" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();

  const result = await waitForHealth({
    configuration: configuration({ url: `http://127.0.0.1:${address.port}/api/health` }),
  });
  assert.equal(result.payload.health, "healthy");
  assert.equal(result.attempt, 1);
});

test("el ejecutable falla con diagnóstico accionable cuando no hay servicio", () => {
  const result = spawnSync(process.execPath, [path.join(rootDir, "scripts", "wait-for-health.js")], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      LOCAL_KANBAN_HEALTH_URL: "http://127.0.0.1:1/api/health",
      LOCAL_KANBAN_HEALTH_ATTEMPTS: "2",
      LOCAL_KANBAN_HEALTH_INTERVAL_MS: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /no quedó listo.*tras 2 intentos/su);
  assert.match(result.stderr, /npm run status/u);
  assert.match(result.stderr, /npm run restart/u);
});
