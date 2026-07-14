import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const defaultHealthUrl = "http://127.0.0.1:4010/api/health";

function positiveInteger(value, fallback, name) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError(`${name} debe ser un entero positivo.`);
  }
  return candidate;
}

export function healthConfiguration(env = process.env) {
  const url = new URL(env.LOCAL_KANBAN_HEALTH_URL ?? defaultHealthUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new TypeError("LOCAL_KANBAN_HEALTH_URL debe usar http o https.");
  }
  return {
    url: url.toString(),
    attempts: positiveInteger(env.LOCAL_KANBAN_HEALTH_ATTEMPTS, 60, "LOCAL_KANBAN_HEALTH_ATTEMPTS"),
    intervalMs: positiveInteger(
      env.LOCAL_KANBAN_HEALTH_INTERVAL_MS,
      1000,
      "LOCAL_KANBAN_HEALTH_INTERVAL_MS",
    ),
    requestTimeoutMs: positiveInteger(
      env.LOCAL_KANBAN_HEALTH_REQUEST_TIMEOUT_MS,
      1000,
      "LOCAL_KANBAN_HEALTH_REQUEST_TIMEOUT_MS",
    ),
  };
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForHealth(options = {}) {
  const configuration = options.configuration ?? healthConfiguration(options.env);
  const request = options.fetch ?? globalThis.fetch;
  const pause = options.sleep ?? sleep;
  let lastFailure = "sin respuesta";

  for (let attempt = 1; attempt <= configuration.attempts; attempt += 1) {
    try {
      const response = await request(configuration.url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(configuration.requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (payload?.ok !== true || !["healthy", "degraded"].includes(payload.health)) {
        throw new Error("respuesta health inválida");
      }
      return { payload, attempt, configuration };
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (attempt < configuration.attempts) {
        await pause(configuration.intervalMs);
      }
    }
  }

  throw new Error(
    `Local Kanban no quedó listo en ${configuration.url} tras ` +
      `${configuration.attempts} intentos (${lastFailure}).`,
  );
}

async function main() {
  try {
    const result = await waitForHealth();
    console.log(
      `Local Kanban listo: health=${result.payload.health} ` +
        `(${result.configuration.url}, intento ${result.attempt}/${result.configuration.attempts}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Siguiente acción: ejecuta `npm run status` y `npm run logs -- --lines 80 --nostream`; " +
        "después corrige la causa y repite `npm run restart`.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
