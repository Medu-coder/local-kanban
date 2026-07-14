import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { DomainError } from "./errors.js";

export const DEFAULT_LEASE_DURATION_MS = 30 * 60 * 1000;
const BLOCK_TYPES = new Set([
  "human",
  "dependency",
  "credential",
  "environment",
  "conflict",
  "external",
  "technical",
]);

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

  CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    operational_status TEXT NOT NULL
      CHECK (operational_status IN ('running', 'waiting', 'verifying')),
    outcome TEXT
      CHECK (outcome IS NULL OR outcome IN ('released', 'completed', 'failed', 'abandoned', 'stale')),
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS attempts_story_idx
    ON attempts (story_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
    agent_id TEXT NOT NULL,
    fencing_token INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'released')),
    lease_expires_at TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    renewed_at TEXT NOT NULL,
    released_at TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS claims_story_held_idx
    ON claims (story_id) WHERE status IN ('active', 'stale');

  CREATE INDEX IF NOT EXISTS claims_story_history_idx
    ON claims (story_id, fencing_token DESC);

  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL REFERENCES attempts(id),
    actor TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS checkpoints_latest_idx
    ON checkpoints (story_id, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL REFERENCES attempts(id),
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    owner TEXT NOT NULL,
    action TEXT NOT NULL,
    resume_condition TEXT NOT NULL,
    evidence TEXT,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
  );

  CREATE INDEX IF NOT EXISTS blocks_open_idx
    ON blocks (story_id, status, created_at);

  CREATE TABLE IF NOT EXISTS entity_quarantine (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    details_json TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT,
    PRIMARY KEY (entity_type, entity_id)
  );
`;

function now() {
  return new Date().toISOString();
}

function parseJson(value) {
  return value ? JSON.parse(value) : null;
}

function toTimestamp(value = undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new DomainError("invalid_timestamp", "El timestamp de coordinación no es válido.", {
      details: { value },
      status: 400,
    });
  }
  return date.toISOString();
}

function leaseExpiration(timestamp, durationMs = DEFAULT_LEASE_DURATION_MS) {
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    throw new DomainError("invalid_lease_duration", "La duración del lease debe ser positiva.", {
      details: { durationMs },
      status: 400,
    });
  }
  return new Date(new Date(timestamp).getTime() + durationMs).toISOString();
}

function requireText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new DomainError("coordination_input_invalid", `${field} es obligatorio.`, {
      details: { field },
      status: 400,
    });
  }
  return normalized;
}

function mapAttempt(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    storyId: row.story_id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    operationalStatus: row.operational_status,
    outcome: row.outcome,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    completedAt: row.completed_at,
  };
}

function mapClaim(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    storyId: row.story_id,
    attemptId: row.attempt_id,
    agentId: row.agent_id,
    fencingToken: row.fencing_token,
    status: row.status,
    leaseExpiresAt: row.lease_expires_at,
    claimedAt: row.claimed_at,
    renewedAt: row.renewed_at,
    releasedAt: row.released_at,
  };
}

function mapCheckpoint(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    storyId: row.story_id,
    attemptId: row.attempt_id,
    actor: row.actor,
    summary: row.summary,
    payload: parseJson(row.payload_json) ?? {},
    createdAt: row.created_at,
  };
}

function mapBlock(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    storyId: row.story_id,
    attemptId: row.attempt_id,
    type: row.type,
    description: row.description,
    owner: row.owner,
    action: row.action,
    resumeCondition: row.resume_condition,
    evidence: row.evidence,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
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

  _heldClaim(storyId) {
    return this.db
      .prepare(
        `SELECT * FROM claims
         WHERE story_id = ? AND status IN ('active', 'stale')
         ORDER BY fencing_token DESC LIMIT 1`,
      )
      .get(storyId);
  }

  _assertClaim(input, { allowStale = false } = {}) {
    const storyId = requireText(input.storyId, "storyId");
    const claim = this._heldClaim(storyId);
    if (!claim) {
      throw new DomainError("claim_not_found", "La historia no tiene un claim vigente.", {
        details: { storyId },
        status: 409,
      });
    }
    if (claim.attempt_id !== input.attemptId) {
      throw new DomainError("claim_owned_by_other", "El claim pertenece a otro intento.", {
        details: { storyId, attemptId: claim.attempt_id },
        status: 409,
      });
    }
    if (!Number.isInteger(input.fencingToken) || claim.fencing_token !== input.fencingToken) {
      throw new DomainError("fencing_conflict", "El fencing token ya no es vigente.", {
        details: { storyId, actual: claim.fencing_token, provided: input.fencingToken },
        status: 409,
      });
    }
    if (input.agentId && claim.agent_id !== input.agentId) {
      throw new DomainError("claim_owned_by_other", "El claim pertenece a otro agente.", {
        details: { storyId, agentId: claim.agent_id },
        status: 409,
      });
    }
    if (claim.status === "stale" && !allowStale) {
      throw new DomainError("lease_stale", "El lease ha expirado y requiere reconciliación.", {
        details: { storyId, attemptId: claim.attempt_id },
        status: 409,
      });
    }
    return claim;
  }

  _renewClaimRow(claim, timestamp, durationMs) {
    const expiresAt = leaseExpiration(timestamp, durationMs);
    this.db
      .prepare(
        `UPDATE claims SET lease_expires_at = ?, renewed_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(expiresAt, timestamp, claim.id);
    this.db
      .prepare("UPDATE attempts SET last_activity_at = ? WHERE id = ?")
      .run(timestamp, claim.attempt_id);
    return { ...claim, lease_expires_at: expiresAt, renewed_at: timestamp };
  }

  claimStory(input) {
    const storyId = requireText(input.storyId, "storyId");
    const agentId = requireText(input.agentId, "agentId");
    const timestamp = toTimestamp(input.now);
    const attemptId = input.attemptId ?? randomUUID();
    const claimId = randomUUID();
    const operationalStatus = input.operationalStatus ?? "running";
    if (!["running", "waiting", "verifying"].includes(operationalStatus)) {
      throw new DomainError("operational_status_invalid", "Estado operativo no válido.", {
        details: { operationalStatus },
        status: 400,
      });
    }

    this.markStaleClaims({ now: timestamp });
    return this.transaction(() => {
      const held = this._heldClaim(storyId);
      if (held) {
        if (held.attempt_id === attemptId && held.agent_id === agentId && held.status === "active") {
          return { claim: mapClaim(held), attempt: mapAttempt(this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId)) };
        }
        throw new DomainError(
          held.status === "stale" ? "stale_claim_requires_release" : "story_already_claimed",
          held.status === "stale"
            ? "El claim expirado debe reconciliarse antes de reasignar."
            : "La historia ya está reclamada.",
          { details: { storyId, attemptId: held.attempt_id, agentId: held.agent_id }, status: 409 },
        );
      }

      const fencingToken = Number(
        this.db
          .prepare("SELECT COALESCE(MAX(fencing_token), 0) + 1 AS next_token FROM claims WHERE story_id = ?")
          .get(storyId).next_token,
      );
      const leaseExpiresAt = leaseExpiration(timestamp, input.leaseDurationMs);
      this.db
        .prepare(
          `INSERT INTO attempts (
             id, story_id, agent_id, session_id, operational_status,
             outcome, created_at, last_activity_at, completed_at
           ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
        )
        .run(attemptId, storyId, agentId, input.sessionId ?? null, operationalStatus, timestamp, timestamp);
      this.db
        .prepare(
          `INSERT INTO claims (
             id, story_id, attempt_id, agent_id, fencing_token, status,
             lease_expires_at, claimed_at, renewed_at, released_at
           ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
        )
        .run(claimId, storyId, attemptId, agentId, fencingToken, leaseExpiresAt, timestamp, timestamp);
      this.appendAudit(
        {
          eventType: "claim_acquired",
          entityType: "story",
          entityId: storyId,
          actor: input.actor ?? agentId,
          payload: { attemptId, agentId, fencingToken, leaseExpiresAt },
          createdAt: timestamp,
        },
        false,
      );
      return {
        claim: mapClaim(this.db.prepare("SELECT * FROM claims WHERE id = ?").get(claimId)),
        attempt: mapAttempt(this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attemptId)),
      };
    });
  }

  markStaleClaims(options = {}) {
    const timestamp = toTimestamp(options.now);
    return this.transaction(() => {
      const expired = this.db
        .prepare(
          `SELECT * FROM claims
           WHERE status = 'active' AND lease_expires_at <= ?
           ORDER BY lease_expires_at, id`,
        )
        .all(timestamp);
      for (const claim of expired) {
        this.db.prepare("UPDATE claims SET status = 'stale' WHERE id = ?").run(claim.id);
        this.db
          .prepare(
            `UPDATE attempts SET outcome = 'stale', last_activity_at = ?
             WHERE id = ? AND outcome IS NULL`,
          )
          .run(timestamp, claim.attempt_id);
        this.appendAudit(
          {
            eventType: "lease_stale",
            entityType: "story",
            entityId: claim.story_id,
            actor: options.actor ?? "system",
            payload: { attemptId: claim.attempt_id, fencingToken: claim.fencing_token },
            createdAt: timestamp,
          },
          false,
        );
      }
      return expired.map((claim) => mapClaim({ ...claim, status: "stale" }));
    });
  }

  verifyClaim(input) {
    const timestamp = toTimestamp(input.now);
    this.markStaleClaims({ now: timestamp });
    const claim = this._assertClaim(input, { allowStale: Boolean(input.allowStale) });
    return mapClaim(claim);
  }

  renewClaim(input) {
    const timestamp = toTimestamp(input.now);
    this.markStaleClaims({ now: timestamp });
    return this.transaction(() => {
      const claim = this._assertClaim(input);
      const renewed = this._renewClaimRow(claim, timestamp, input.leaseDurationMs);
      this.appendAudit(
        {
          eventType: "lease_renewed",
          entityType: "story",
          entityId: claim.story_id,
          actor: input.actor ?? claim.agent_id,
          payload: { attemptId: claim.attempt_id, leaseExpiresAt: renewed.lease_expires_at },
          createdAt: timestamp,
        },
        false,
      );
      return mapClaim(renewed);
    });
  }

  releaseClaim(input) {
    const timestamp = toTimestamp(input.now);
    this.markStaleClaims({ now: timestamp });
    return this.transaction(() => {
      const claim = this._assertClaim(input, { allowStale: true });
      const outcome = input.outcome ?? (claim.status === "stale" ? "stale" : "released");
      if (!["released", "completed", "failed", "abandoned", "stale"].includes(outcome)) {
        throw new DomainError("attempt_outcome_invalid", "Resultado de intento no válido.", {
          details: { outcome },
          status: 400,
        });
      }
      this.db
        .prepare("UPDATE claims SET status = 'released', released_at = ? WHERE id = ?")
        .run(timestamp, claim.id);
      this.db
        .prepare(
          `UPDATE attempts SET outcome = ?, last_activity_at = ?, completed_at = ? WHERE id = ?`,
        )
        .run(outcome, timestamp, timestamp, claim.attempt_id);
      this.appendAudit(
        {
          eventType: "claim_released",
          entityType: "story",
          entityId: claim.story_id,
          actor: input.actor ?? claim.agent_id,
          payload: { attemptId: claim.attempt_id, fencingToken: claim.fencing_token, outcome },
          createdAt: timestamp,
        },
        false,
      );
      return { ...mapClaim(claim), status: "released", releasedAt: timestamp, outcome };
    });
  }

  setOperationalStatus(input) {
    const operationalStatus = input.operationalStatus;
    if (!["running", "waiting", "verifying"].includes(operationalStatus)) {
      throw new DomainError("operational_status_invalid", "Estado operativo no válido.", {
        details: { operationalStatus },
        status: 400,
      });
    }
    const timestamp = toTimestamp(input.now);
    this.markStaleClaims({ now: timestamp });
    return this.transaction(() => {
      const claim = this._assertClaim(input);
      this.db
        .prepare("UPDATE attempts SET operational_status = ?, last_activity_at = ? WHERE id = ?")
        .run(operationalStatus, timestamp, claim.attempt_id);
      const renewed = this._renewClaimRow(claim, timestamp, input.leaseDurationMs);
      this.appendAudit(
        {
          eventType: "operational_status_changed",
          entityType: "story",
          entityId: claim.story_id,
          actor: input.actor ?? claim.agent_id,
          payload: { attemptId: claim.attempt_id, operationalStatus },
          createdAt: timestamp,
        },
        false,
      );
      return {
        attempt: mapAttempt(this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(claim.attempt_id)),
        claim: mapClaim(renewed),
      };
    });
  }

  recordCheckpoint(input) {
    const timestamp = toTimestamp(input.now);
    const summary = requireText(input.summary, "summary");
    this.markStaleClaims({ now: timestamp });
    return this.transaction(() => {
      const claim = this._assertClaim(input);
      const checkpointId = input.checkpointId ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO checkpoints (id, story_id, attempt_id, actor, summary, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          checkpointId,
          claim.story_id,
          claim.attempt_id,
          input.actor ?? claim.agent_id,
          summary,
          JSON.stringify(input.payload ?? {}),
          timestamp,
        );
      const renewed = this._renewClaimRow(claim, timestamp, input.leaseDurationMs);
      this.appendAudit(
        {
          eventType: "checkpoint_recorded",
          entityType: "story",
          entityId: claim.story_id,
          actor: input.actor ?? claim.agent_id,
          payload: { checkpointId, attemptId: claim.attempt_id, summary },
          createdAt: timestamp,
        },
        false,
      );
      return {
        checkpoint: mapCheckpoint(this.db.prepare("SELECT * FROM checkpoints WHERE id = ?").get(checkpointId)),
        claim: mapClaim(renewed),
      };
    });
  }

  addBlock(input) {
    const timestamp = toTimestamp(input.now);
    const blockType = requireText(input.type, "type");
    if (!BLOCK_TYPES.has(blockType)) {
      throw new DomainError("block_type_invalid", "Tipo de bloqueo no válido.", {
        details: { type: blockType },
        status: 400,
      });
    }
    this.markStaleClaims({ now: timestamp });
    return this.transaction(() => {
      const claim = this._assertClaim(input);
      const blockId = input.blockId ?? randomUUID();
      this.db
        .prepare(
          `INSERT INTO blocks (
             id, story_id, attempt_id, type, description, owner, action,
             resume_condition, evidence, status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
        )
        .run(
          blockId,
          claim.story_id,
          claim.attempt_id,
          blockType,
          requireText(input.description, "description"),
          requireText(input.owner, "owner"),
          requireText(input.action, "action"),
          requireText(input.resumeCondition, "resumeCondition"),
          input.evidence ? String(input.evidence) : null,
          timestamp,
        );
      this.db
        .prepare("UPDATE attempts SET operational_status = 'waiting', last_activity_at = ? WHERE id = ?")
        .run(timestamp, claim.attempt_id);
      const renewed = this._renewClaimRow(claim, timestamp, input.leaseDurationMs);
      this.appendAudit(
        {
          eventType: "block_opened",
          entityType: "story",
          entityId: claim.story_id,
          actor: input.actor ?? claim.agent_id,
          payload: { blockId, type: blockType, owner: input.owner },
          createdAt: timestamp,
        },
        false,
      );
      return {
        block: mapBlock(this.db.prepare("SELECT * FROM blocks WHERE id = ?").get(blockId)),
        claim: mapClaim(renewed),
      };
    });
  }

  resolveBlock(input) {
    const timestamp = toTimestamp(input.now);
    this.markStaleClaims({ now: timestamp });
    return this.transaction(() => {
      const claim = this._assertClaim(input);
      const block = this.db
        .prepare("SELECT * FROM blocks WHERE id = ? AND story_id = ?")
        .get(input.blockId, claim.story_id);
      if (!block || block.status !== "open") {
        throw new DomainError("block_not_found", "Bloqueo abierto no encontrado.", {
          details: { blockId: input.blockId, storyId: claim.story_id },
          status: 404,
        });
      }
      this.db
        .prepare(
          `UPDATE blocks SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?`,
        )
        .run(timestamp, input.actor ?? claim.agent_id, block.id);
      const remaining = this.db
        .prepare("SELECT COUNT(*) AS count FROM blocks WHERE story_id = ? AND status = 'open'")
        .get(claim.story_id).count;
      if (remaining === 0) {
        this.db
          .prepare("UPDATE attempts SET operational_status = 'running', last_activity_at = ? WHERE id = ?")
          .run(timestamp, claim.attempt_id);
      }
      const renewed = this._renewClaimRow(claim, timestamp, input.leaseDurationMs);
      this.appendAudit(
        {
          eventType: "block_resolved",
          entityType: "story",
          entityId: claim.story_id,
          actor: input.actor ?? claim.agent_id,
          payload: { blockId: block.id },
          createdAt: timestamp,
        },
        false,
      );
      return {
        block: mapBlock(this.db.prepare("SELECT * FROM blocks WHERE id = ?").get(block.id)),
        claim: mapClaim(renewed),
      };
    });
  }

  getCoordinationState(storyId, options = {}) {
    this.markStaleClaims({ now: options.now });
    const claim = this._heldClaim(storyId);
    const attempt = claim
      ? this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(claim.attempt_id)
      : null;
    const checkpoint = this.db
      .prepare(
        `SELECT * FROM checkpoints WHERE story_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(storyId);
    const blocks = this.db
      .prepare(
        `SELECT * FROM blocks WHERE story_id = ? AND status = 'open'
         ORDER BY created_at, id`,
      )
      .all(storyId);
    return {
      operationalStatus: attempt?.operational_status ?? "unclaimed",
      claim: mapClaim(claim),
      attempt: mapAttempt(attempt),
      checkpoint: mapCheckpoint(checkpoint),
      blocks: blocks.map(mapBlock),
    };
  }

  listAuditEvents(options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 1000);
    const rows = options.storyId
      ? this.db
          .prepare(
            `SELECT * FROM audit_events WHERE entity_type = 'story' AND entity_id = ?
             ORDER BY created_at, id LIMIT ?`,
          )
          .all(options.storyId, limit)
      : this.db.prepare("SELECT * FROM audit_events ORDER BY created_at, id LIMIT ?").all(limit);
    return rows.map((row) => ({
      id: row.id,
      operationId: row.operation_id,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actor: row.actor,
      payload: parseJson(row.payload_json) ?? {},
      createdAt: row.created_at,
    }));
  }

  reconcileDocument(input) {
    const entityType = requireText(input.entityType, "entityType");
    const entityId = requireText(input.entityId, "entityId");
    const revision = input.revision;
    const contentHash = requireText(input.contentHash, "contentHash");
    const timestamp = toTimestamp(input.now);
    if (!["story", "epic"].includes(entityType) || !Number.isInteger(revision) || revision < 1) {
      throw new DomainError("reconciliation_input_invalid", "Entidad o revisión no válida.", {
        details: { entityType, entityId, revision },
        status: 400,
      });
    }

    return this.transaction(() => {
      const state = this.db
        .prepare("SELECT * FROM entity_state WHERE entity_type = ? AND entity_id = ?")
        .get(entityType, entityId);
      const heldClaim = entityType === "story" ? this._heldClaim(entityId) : null;
      const safeBootstrap = !state;
      const unchanged = state?.revision === revision && state?.content_hash === contentHash;
      const safeAdvance = state && !state.pending_operation_id && revision === state.revision + 1;

      if (unchanged) {
        return { status: "unchanged", entityType, entityId, revision };
      }

      if ((safeBootstrap || safeAdvance) && !heldClaim) {
        this.db
          .prepare(
            `INSERT INTO entity_state (
               entity_type, entity_id, revision, content_hash, pending_operation_id, updated_at
             ) VALUES (?, ?, ?, ?, NULL, ?)
             ON CONFLICT(entity_type, entity_id) DO UPDATE SET
               revision = excluded.revision,
               content_hash = excluded.content_hash,
               pending_operation_id = NULL,
               updated_at = excluded.updated_at`,
          )
          .run(entityType, entityId, revision, contentHash, timestamp);
        this.db
          .prepare("DELETE FROM entity_quarantine WHERE entity_type = ? AND entity_id = ?")
          .run(entityType, entityId);
        this.appendAudit(
          {
            eventType: safeBootstrap ? "document_indexed" : "manual_edit_imported",
            entityType,
            entityId,
            actor: input.actor ?? "watcher",
            payload: { revision, contentHash },
            createdAt: timestamp,
          },
          false,
        );
        return {
          status: safeBootstrap ? "indexed" : "imported",
          entityType,
          entityId,
          revision,
        };
      }

      const reason = heldClaim
        ? "active_claim"
        : state?.pending_operation_id
          ? "pending_operation"
          : "revision_divergence";
      const details = {
        documentRevision: revision,
        runtimeRevision: state?.revision ?? null,
        attemptId: heldClaim?.attempt_id ?? null,
      };
      this.db
        .prepare(
          `INSERT INTO entity_quarantine (
             entity_type, entity_id, reason, details_json, detected_at, resolved_at, resolved_by
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             reason = excluded.reason,
             details_json = excluded.details_json,
             detected_at = excluded.detected_at,
             resolved_at = NULL,
             resolved_by = NULL`,
        )
        .run(entityType, entityId, reason, JSON.stringify(details), timestamp);
      this.appendAudit(
        {
          eventType: "document_quarantined",
          entityType,
          entityId,
          actor: input.actor ?? "watcher",
          payload: { reason, ...details },
          createdAt: timestamp,
        },
        false,
      );
      return { status: "quarantined", entityType, entityId, reason, details };
    });
  }

  listQuarantines() {
    return this.db
      .prepare(
        `SELECT * FROM entity_quarantine
         WHERE resolved_at IS NULL ORDER BY detected_at, entity_type, entity_id`,
      )
      .all()
      .map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        reason: row.reason,
        details: parseJson(row.details_json) ?? {},
        detectedAt: row.detected_at,
      }));
  }

  quarantineEntity(input) {
    const entityType = requireText(input.entityType, "entityType");
    const entityId = requireText(input.entityId, "entityId");
    const reason = requireText(input.reason, "reason");
    const timestamp = toTimestamp(input.now);
    return this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO entity_quarantine (
             entity_type, entity_id, reason, details_json, detected_at, resolved_at, resolved_by
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
           ON CONFLICT(entity_type, entity_id) DO UPDATE SET
             reason = excluded.reason,
             details_json = excluded.details_json,
             detected_at = excluded.detected_at,
             resolved_at = NULL,
             resolved_by = NULL`,
        )
        .run(entityType, entityId, reason, JSON.stringify(input.details ?? {}), timestamp);
      this.appendAudit(
        {
          eventType: "document_quarantined",
          entityType,
          entityId,
          actor: input.actor ?? "watcher",
          payload: { reason, ...(input.details ?? {}) },
          createdAt: timestamp,
        },
        false,
      );
      return { status: "quarantined", entityType, entityId, reason };
    });
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
          event.createdAt ?? now(),
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
