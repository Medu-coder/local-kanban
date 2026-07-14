import { randomUUID } from "node:crypto";

export function createLogger({ sink = process.stderr, correlationId = randomUUID(), context = {} } = {}) {
  function write(level, event, payload = {}) {
    sink.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        correlationId,
        ...context,
        ...payload,
      })}\n`,
    );
  }

  return {
    correlationId,
    info: (event, payload) => write("info", event, payload),
    warn: (event, payload) => write("warn", event, payload),
    error: (event, payload) => write("error", event, payload),
    child: (extraContext) => createLogger({ sink, correlationId, context: { ...context, ...extraContext } }),
  };
}
