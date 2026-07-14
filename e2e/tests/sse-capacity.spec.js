import { expect, test } from "@playwright/test";
import http from "node:http";

const eventsUrl = new URL("http://127.0.0.1:4011/api/events");

function connectSse() {
  return new Promise((resolve, reject) => {
    const request = http.get(eventsUrl, {
      headers: { Accept: "text/event-stream" },
    });
    request.once("error", reject);
    request.once("response", (response) => {
      resolve({ request, response });
    });
  });
}

async function readJsonResponse({ response }) {
  let body = "";
  for await (const chunk of response) {
    body += chunk;
  }
  return JSON.parse(body);
}

function closeSse(connection) {
  connection.response.destroy();
  connection.request.destroy();
}

async function reconnectAfterCleanup() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const connection = await connectSse();
    if (connection.response.statusCode === 200) {
      return connection;
    }
    await readJsonResponse(connection);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("El servidor SSE no liberó capacidad después de cerrar un cliente.");
}

test("SSE limita clientes, rechaza capacidad extra y permite reconectar tras liberar", async () => {
  const connections = [];

  try {
    for (let index = 0; index < 32; index += 1) {
      const connection = await connectSse();
      expect(connection.response.statusCode).toBe(200);
      connections.push(connection);
    }

    const rejected = await connectSse();
    expect(rejected.response.statusCode).toBe(503);
    expect(rejected.response.headers["content-type"]).toContain("application/json");
    expect(await readJsonResponse(rejected)).toMatchObject({
      ok: false,
      code: "sse_capacity_reached",
      nextAction: expect.stringContaining("Cierra otra pestaña"),
    });

    closeSse(connections.pop());
    const replacement = await reconnectAfterCleanup();
    expect(replacement.response.statusCode).toBe(200);
    connections.push(replacement);
  } finally {
    for (const connection of connections) {
      closeSse(connection);
    }
  }
});
