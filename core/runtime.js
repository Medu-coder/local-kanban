import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { DomainError } from "./errors.js";

const runtimeSchema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS entity_state (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    pending_operation_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
  );

  CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    actor TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    previous_revision INTEGER NOT NULL,
    previous_hash TEXT NOT NULL,
    target_revision INTEGER NOT NULL,
    target_hash TEXT NOT NULL,
    target_content TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'quarantined')),
    result_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS operations_pending_idx
    ON operations (status, entity_type, entity_id);

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    operation_id TEXT,
    event_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    actor TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

function now() {
  return new Date().toISOString();
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function mapOperation(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    result: parseJson(row.result_json),
  };
}

export class RuntimeStore {
  constructor(projectRoot) {
    const canonicalRoot = fs.realpathSync(projectRoot);
    const runtimeDir = path.join(canonicalRoot, ".local-kanban");
    const existingRuntime = fs.existsSync(runtimeDir) ? fs.lstatSync(runtimeDir) : null;
    if (existingRuntime?.isSymbolicLink()) {
      throw new DomainError("path_escape", ".local-kanban no puede ser un symlink.", {
        details: { runtimeDir },
        status: 400,
      });
    }
    if (existingRuntime && !existingRuntime.isDirectory()) {
      throw new DomainError("runtime_path_invalid", ".local-kanban debe ser un directorio.", {
        details: { runtimeDir },
        status: 400,
      });
    }
    fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
    this.filePath = path.join(runtimeDir, "runtime.sqlite");
    for (const candidate of [this.filePath, `${this.filePath}-wal`, `${this.filePath}-shm`]) {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new DomainError("runtime_path_invalid", "Los ficheros SQLite deben ser regulares.", {
          details: { filePath: candidate },
          status: 400,
        });
      }
    }
    this.db = new DatabaseSync(this.filePath);
    this.db.exec(runtimeSchema);
    fs.chmodSync(this.filePath, 0o600);
  }

  close() {
    this.db.close();
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getByIdempotencyKey(idempotencyKey) {
    return mapOperation(
      this.db.prepare("SELECT * FROM operations WHERE idempotency_key = ?").get(idempotencyKey),
    );
  }

  beginOperation(input) {
    return this.transaction(() => {
      const requestFingerprint = input.requestFingerprint ?? input.idempotencyKey;
      const existing = this.getByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        if (
          existing.entity_type !== input.entityType ||
          existing.entity_id !== input.entityId ||
          existing.target_hash !== input.targetHash ||
          existing.request_fingerprint !== requestFingerprint
        ) {
          throw new DomainError(
            "idempotency_conflict",
            "La clave de idempotencia ya se utilizó para otra operación.",
            { details: { idempotencyKey: input.idempotencyKey }, status: 409 },
          );
        }
        return existing;
      }

      const pending = this.db
        .prepare(
          `SELECT id FROM operations
           WHERE entity_type = ? AND entity_id = ? AND status = 'pending'
           LIMIT 1`,
        )
        .get(input.entityType, input.entityId);
      if (pending) {
        throw new DomainError(
          "revision_conflict",
          "La entidad tiene una operación pendiente de reconciliación.",
          { details: { operationId: pending.id }, status: 409 },
        );
      }

      const state = this.db
        .prepare("SELECT * FROM entity_state WHERE entity_type = ? AND entity_id = ?")
        .get(input.entityType, input.entityId);

      if (state && state.pending_operation_id) {
        throw new DomainError(
          "revision_conflict",
          "La entidad está siendo modificada por otra operación.",
          {
            details: { operationId: state.pending_operation_id, revision: state.revision },
            status: 409,
          },
        );
      }

      if (state && (state.revision !== input.previousRevision || state.content_hash !== input.previousHash)) {
        throw new DomainError(
          "revision_conflict",
          "Markdown y el runtime no coinciden; ejecuta local-kanban doctor.",
          {
            details: {
              runtimeRevision: state.revision,
              markdownRevision: input.previousRevision,
            },
            status: 409,
          },
        );
      }

      const operation = {
        id: randomUUID(),
        ...input,
        requestFingerprint,
        status: "pending",
        createdAt: now(),
      };

      this.db
        .prepare(
          `INSERT INTO operations (
             id, idempotency_key, entity_type, entity_id, actor, request_fingerprint,
             previous_revision, previous_hash, target_revision, target_hash,
             target_content, status, result_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          operation.id,
          operation.idempotencyKey,
          operation.entityType,
          operation.entityId,
          operation.actor,
          operation.requestFingerprint,
          operation.previousRevision,
          operation.previousHash,
          operation.targetRevision,
          operation.targetHash,
          operation.targetContent,
          JSON.stringify(operation.result ?? null),
          operation.createdAt,
        );

      this.db
        .prepare(
          `INSERT INTO entity_state (
             entity_type, entity_id, revision, content_hash, pending_operation_id, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             revision = excluded.revision,
             content_hash = excluded.content_hash,
             pending_operation_id = excluded.pending_operation_id,
             updated_at = excluded.updated_at`,
        )
        .run(
          operation.entityType,
          operation.entityId,
          operation.targetRevision,
          operation.targetHash,
          operation.id,
          operation.createdAt,
        );

      return operation;
    });
  }

  completeOperation(operationId, result = undefined) {
    return this.transaction(() => {
      const operation = mapOperation(
        this.db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId),
      );
      if (!operation) {
        throw new DomainError("operation_not_found", "Operación no encontrada.", {
          details: { operationId },
          status: 404,
        });
      }
      if (operation.status === "completed") {
        return operation;
      }
      if (operation.status !== "pending") {
        throw new DomainError("operation_not_pending", "La operación ya no está pendiente.", {
          details: { operationId, status: operation.status },
          status: 409,
        });
      }

      const completedAt = now();
      const finalResult = result === undefined ? operation.result : result;
      this.db
        .prepare(
          `UPDATE operations
           SET status = 'completed', result_json = ?, error = NULL, completed_at = ?
           WHERE id = ?`,
        )
        .run(JSON.stringify(finalResult ?? null), completedAt, operationId);
      this.db
        .prepare(
          `UPDATE entity_state SET pending_operation_id = NULL, updated_at = ?
           WHERE entity_type = ? AND entity_id = ? AND pending_operation_id = ?`,
        )
        .run(completedAt, operation.entity_type, operation.entity_id, operationId);
      this.appendAudit(
        {
          operationId,
          eventType: "operation_completed",
          entityType: operation.entity_type,
          entityId: operation.entity_id,
          actor: operation.actor,
          payload: finalResult ?? {},
        },
        false,
      );
      return { ...operation, status: "completed", result: finalResult, completed_at: completedAt };
    });
  }

  failOperation(operationId, error) {
    return this.transaction(() => {
      const operation = mapOperation(
        this.db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId),
      );
      if (!operation || operation.status !== "pending") {
        return operation;
      }
      const completedAt = now();
      this.db
        .prepare(
          `UPDATE operations SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`,
        )
        .run(String(error), completedAt, operationId);
      this.db
        .prepare(
          `UPDATE entity_state
           SET revision = ?, content_hash = ?, pending_operation_id = NULL, updated_at = ?
           WHERE entity_type = ? AND entity_id = ? AND pending_operation_id = ?`,
        )
        .run(
          operation.previous_revision,
          operation.previous_hash,
          completedAt,
          operation.entity_type,
          operation.entity_id,
          operationId,
        );
      return { ...operation, status: "failed", error: String(error), completed_at: completedAt };
    });
  }

  quarantineOperation(operationId, error) {
    return this.transaction(() => {
      const operation = mapOperation(
        this.db.prepare("SELECT * FROM operations WHERE id = ?").get(operationId),
      );
      if (!operation || operation.status !== "pending") {
        return operation;
      }
      const completedAt = now();
      this.db
        .prepare(
          `UPDATE operations SET status = 'quarantined', error = ?, completed_at = ? WHERE id = ?`,
        )
        .run(String(error), completedAt, operationId);
      return { ...operation, status: "quarantined", error: String(error), completed_at: completedAt };
    });
  }

  listPendingOperations() {
    return this.db
      .prepare("SELECT * FROM operations WHERE status = 'pending' ORDER BY created_at, id")
      .all()
      .map(mapOperation);
  }

  appendAudit(event, withinTransaction = true) {
    const insert = () => {
      this.db
        .prepare(
          `INSERT INTO audit_events (
             id, operation_id, event_type, entity_type, entity_id, actor, payload_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          event.operationId ?? null,
          event.eventType,
          event.entityType ?? null,
          event.entityId ?? null,
          event.actor,
          JSON.stringify(event.payload ?? {}),
          now(),
        );
    };

    if (withinTransaction) {
      return this.transaction(insert);
    }
    return insert();
  }
}

export function openRuntime(projectRoot) {
  return new RuntimeStore(projectRoot);
}
